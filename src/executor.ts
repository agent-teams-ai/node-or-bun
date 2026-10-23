import type {
  CompletionCause,
  Exit,
  ProcessAdapter,
  ProcessExecutor,
  ProcessRunResult,
  Request,
  RunningProcess,
} from "./contract.js";
import { PROCESS_CLEANUP_STEP_MS } from "./contract.js";
import {
  ProcessRuntimeError,
  isProcessRuntimeError,
  processError,
  type ProcessCapturedOutput,
  type ProcessErrorCode,
  type ProcessInitiatingCause,
} from "./errors.js";
import { classifyProcessOutcome, type InitiatingFailure } from "./internal/classification.js";
import { decodeCapture, drainCapture, type CaptureRead } from "./internal/capture.js";
import { snapshotRequest } from "./internal/input.js";
import {
  rejectedReasons,
  settleOperation,
  type Settlement,
  withCause,
} from "./internal/settlement.js";

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

const deferred = <T>(): Deferred<T> => {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
};

type WaitResult<T> =
  | { readonly status: "settled"; readonly value: T }
  | { readonly status: "timeout" };

const wait = async <T>(promise: Promise<T>, timeoutMs: number): Promise<WaitResult<T>> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<WaitResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
  });
  try {
    return await Promise.race([
      promise.then((value) => ({ status: "settled" as const, value })),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

const captureError = (value: unknown, streamName: "stdout" | "stderr"): ProcessRuntimeError => {
  const code =
    isProcessRuntimeError(value) && value.code === "output-limit" ? "output-limit" : "stream";
  return new ProcessRuntimeError(
    code,
    code === "output-limit" ? "captured output exceeded 4 MiB" : `${streamName} capture failed`,
    { cause: value },
  );
};

const initiatingCause = (
  cause: CompletionCause | "capture" | "observation",
): ProcessInitiatingCause => {
  switch (cause) {
    case "timeout":
      return "timeout";
    case "cancelled":
      return "cancellation";
    case "capture":
      return "capture";
    case "observation":
    case "failed":
      return "observation";
    case "exited":
      return "exit";
    default:
      throw new Error("unknown completion cause");
  }
};

export const createProcessExecutor = (adapter: ProcessAdapter): ProcessExecutor => {
  if (adapter === null || typeof adapter !== "object" || typeof adapter.launch !== "function") {
    throw processError("invalid-input", "adapter must expose launch(request)");
  }

  return {
    run: async (request: Request): Promise<ProcessRunResult> => {
      const snapshot = snapshotRequest(request);
      const failure = deferred<InitiatingFailure>();
      let initiatingFailure: InitiatingFailure | undefined;
      let observedExit: Exit | null = null;
      let completionRequestedBeforeExitObservation = false;
      let lateFailureCodes: ProcessErrorCode[] = [];
      let captureReads: readonly [CaptureRead, CaptureRead] | undefined;
      let outputBounded = false;

      const addLateFailureCode = (code: ProcessErrorCode): void => {
        if (!lateFailureCodes.includes(code)) {
          lateFailureCodes = [...lateFailureCodes, code];
        }
      };

      const beginFailure = (
        error: ProcessRuntimeError,
        cause: CompletionCause | "capture" | "observation",
      ): void => {
        if (initiatingFailure !== undefined) {
          if (cause === "capture") {
            addLateFailureCode(error.code);
          }
          return;
        }
        const state: InitiatingFailure = {
          cause: initiatingCause(cause),
          code: error.code,
          error,
        };
        initiatingFailure = state;
        completionRequestedBeforeExitObservation = observedExit === null;
        failure.resolve(state);
      };

      if (snapshot.signal !== undefined && snapshot.signal.aborted) {
        throw new ProcessRuntimeError("cancelled", "process request was already cancelled", {
          initiatingError: snapshot.signal.reason,
          facts: {
            initiatingCause: "cancellation",
            completionRequestedBeforeExitObservation: true,
          },
        });
      }

      const onAbort = (): void => {
        if (observedExit === null && initiatingFailure === undefined) {
          beginFailure(
            processError("cancelled", "process request was cancelled", snapshot.signal?.reason),
            "cancelled",
          );
        }
      };
      snapshot.signal?.addEventListener("abort", onAbort, { once: true });
      const timer =
        snapshot.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              if (observedExit === null && initiatingFailure === undefined) {
                beginFailure(processError("timeout", "process deadline elapsed"), "timeout");
              }
            }, snapshot.timeoutMs);

      if (snapshot.signal !== undefined && snapshot.signal.aborted) {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        snapshot.signal.removeEventListener("abort", onAbort);
        throw new ProcessRuntimeError("cancelled", "process request was already cancelled", {
          initiatingError: snapshot.signal.reason,
          facts: {
            initiatingCause: "cancellation",
            completionRequestedBeforeExitObservation: true,
          },
        });
      }

      let running: RunningProcess;
      try {
        running = await adapter.launch(snapshot.launch);
      } catch (cause) {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        snapshot.signal?.removeEventListener("abort", onAbort);
        if (isProcessRuntimeError(cause) && cause.code === "cleanup") {
          throw new ProcessRuntimeError("cleanup", "process cleanup did not complete", {
            cause: cause.cause,
            initiatingError: cause.initiatingError,
            facts: {
              ...cause.facts,
              initiatingCause: cause.facts.initiatingCause ?? "launch",
              incompleteCustody: true,
            },
          });
        }
        if (initiatingFailure !== undefined) {
          throw new ProcessRuntimeError(initiatingFailure.code, initiatingFailure.error.message, {
            cause: initiatingFailure.error.cause,
            initiatingError: initiatingFailure.error,
            facts: {
              initiatingCause: initiatingFailure.cause,
              completionRequestedBeforeExitObservation,
              lateFailureCodes,
            },
          });
        }
        if (isProcessRuntimeError(cause)) {
          throw cause;
        }
        throw new ProcessRuntimeError("launch", "process launch failed", {
          cause,
          initiatingError: cause,
          facts: { initiatingCause: "launch" },
        });
      }

      const stdoutRead = drainCapture(running.stdout, (cause) => {
        beginFailure(captureError(cause, "stdout"), "capture");
      });
      const stderrRead = drainCapture(running.stderr, (cause) => {
        beginFailure(captureError(cause, "stderr"), "capture");
      });
      outputBounded = true;
      // Invariant assertion: the 4 MiB capture limits are in force for this
      // run; the fact does not report whether truncation occurred (review-v2
      // R11 disposition, documented invariant).
      // Contract: drainCapture reports failures through beginFailure and its
      // promise never rejects, so this chain cannot reject (review-v2 R17
      // disposition, documented non-rejecting drain contract).
      const captures = Promise.all([stdoutRead, stderrRead]).then((value) => {
        captureReads = value;
        return value;
      });

      const exitObservation = running.exited.then(
        (exit) => {
          observedExit = exit;
          return { kind: "exit" as const };
        },
        (cause) => {
          beginFailure(
            new ProcessRuntimeError("stream", "process observation failed", { cause }),
            "observation",
          );
          return { kind: "failure" as const };
        },
      );
      const failureObservation = failure.promise.then(() => ({ kind: "failure" as const }));
      const firstObservation = await Promise.race([exitObservation, failureObservation]);

      if (firstObservation.kind === "exit" && initiatingFailure === undefined) {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        snapshot.signal?.removeEventListener("abort", onAbort);
      }

      const closeAndSettleCapture = async (): Promise<void> => {
        const initiallySettled = await wait(captures, PROCESS_CLEANUP_STEP_MS);
        if (
          initiallySettled.status === "settled" &&
          initiallySettled.value.every((capture) => capture.normalEof)
        ) {
          return;
        }
        const forcedAfterEofDeadline = initiallySettled.status === "timeout";
        let closeSettlement: Settlement<void> | undefined;
        const close = settleOperation(() => running.closeCapture()).then((settlement) => {
          closeSettlement = settlement;
          return settlement;
        });
        const settled = await wait(
          Promise.all([close, settleOperation(() => captures)]).then(() => true),
          PROCESS_CLEANUP_STEP_MS,
        );
        const closeFailure =
          closeSettlement !== undefined && closeSettlement.status === "rejected"
            ? closeSettlement
            : undefined;
        if (settled.status === "timeout") {
          throw closeFailure === undefined
            ? new Error("native capture close or reader settlement remained open")
            : closeFailure.reason;
        }
        if (closeFailure !== undefined) {
          throw closeFailure.reason === undefined
            ? withCause(new Error("native capture closure failed"), closeFailure.reason)
            : closeFailure.reason;
        }
        if (forcedAfterEofDeadline) {
          throw new Error("capture EOF deadline elapsed");
        }
      };

      let cleanupFailure: { readonly reason: unknown } | undefined;
      const cleanupSettlement = await settleOperation(() =>
        running.cleanup(
          initiatingFailure?.cause === "timeout"
            ? "timeout"
            : initiatingFailure?.cause === "cancellation"
              ? "cancelled"
              : firstObservation.kind === "exit"
                ? "exited"
                : "failed",
        ),
      );
      const closeSettlement = await settleOperation(() => closeAndSettleCapture());
      const failures = rejectedReasons([cleanupSettlement, closeSettlement]);
      if (failures.length > 0) {
        cleanupFailure = {
          reason:
            failures.length === 1
              ? failures[0]
              : new AggregateError(failures, "cleanup and capture closure both failed"),
        };
      }

      if (timer !== undefined) {
        clearTimeout(timer);
      }
      snapshot.signal?.removeEventListener("abort", onAbort);
      await wait(exitObservation, PROCESS_CLEANUP_STEP_MS);

      let decodeFailure: ProcessRuntimeError | undefined;
      let output: ProcessCapturedOutput | null = null;
      let stdout = "";
      let stderr = "";
      if (captureReads !== undefined) {
        try {
          stdout = decodeCapture(captureReads[0].bytes, snapshot.strictUtf8, "stdout");
          stderr = decodeCapture(captureReads[1].bytes, snapshot.strictUtf8, "stderr");
          output = { stdout, stderr };
        } catch (cause) {
          decodeFailure = new ProcessRuntimeError(
            "invalid-output",
            "captured output was not valid UTF-8",
            { cause },
          );
          addLateFailureCode("invalid-output");
        }
      }

      const outcome = classifyProcessOutcome({
        initiatingFailure,
        cleanupFailure,
        decodeFailure,
        lateFailureCodes,
        observedExit,
        completionRequestedBeforeExitObservation,
        outputBounded,
        output,
      });
      if (outcome.kind === "error") {
        throw outcome.error;
      }
      const finalExit = observedExit as Exit | null;
      if (finalExit === null) {
        throw new ProcessRuntimeError("stream", "process exited without an observed result", {
          facts: outcome.facts,
          output,
        });
      }
      return {
        ...finalExit,
        stdout,
        stderr,
        facts: outcome.facts,
      };
    },
  };
};
