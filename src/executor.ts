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
import { ProcessRuntimeError, isProcessRuntimeError, processError } from "./errors.js";
import { decodeCapture, drainCapture } from "./internal/capture.js";
import { snapshotRequest } from "./internal/input.js";

type FailureState = {
  readonly error: ProcessRuntimeError;
  readonly cause: CompletionCause;
};

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const wait = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

const errorFrom = (value: unknown, code: "launch" | "stream" | "cleanup", message: string): ProcessRuntimeError =>
  value instanceof ProcessRuntimeError ? value : processError(code, message, value);

const cleanupError = (
  cause: unknown,
  initiatingError: unknown,
): ProcessRuntimeError =>
  new ProcessRuntimeError("cleanup", "process cleanup did not complete", {
    cause,
    initiatingError,
    incompleteCustody: true,
  });

export const createProcessExecutor = (adapter: ProcessAdapter): ProcessExecutor => {
  if (adapter === null || typeof adapter !== "object" || typeof adapter.launch !== "function") {
    throw processError("invalid-input", "adapter must expose launch(request)");
  }

  return {
    run: async (request: Request): Promise<ProcessRunResult> => {
      const snapshot = snapshotRequest(request);
      const failure = deferred<FailureState>();
      let failureState: FailureState | undefined;
      let completionFailure: FailureState | undefined;
      let exitState: Exit | undefined;
      let completionStarted = false;
      let abnormalCapture = false;

      const beginFailure = (error: ProcessRuntimeError, cause: CompletionCause): void => {
        const state = { error, cause };
        failureState ??= state;
        if (cause === "failed") {
          completionFailure ??= state;
        }
        failure.resolve(failureState);
      };

      if (snapshot.signal !== undefined && Boolean(snapshot.signal.aborted)) {
        throw processError("cancelled", "process request was already cancelled");
      }

      const onAbort = (): void => {
        if (!completionStarted) {
          beginFailure(processError("cancelled", "process request was cancelled"), "cancelled");
        }
      };
      snapshot.signal?.addEventListener("abort", onAbort, { once: true });
      const timer =
        snapshot.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              if (!completionStarted) {
                beginFailure(processError("timeout", "process deadline elapsed"), "timeout");
              }
            }, snapshot.timeoutMs);

      if (snapshot.signal !== undefined && Boolean(snapshot.signal.aborted)) {
        if (timer !== undefined) clearTimeout(timer);
        snapshot.signal.removeEventListener("abort", onAbort);
        throw processError("cancelled", "process request was already cancelled");
      }

      let running: RunningProcess;
      try {
        running = await adapter.launch(snapshot.launch);
      } catch (cause) {
        if (timer !== undefined) clearTimeout(timer);
        snapshot.signal?.removeEventListener("abort", onAbort);
        // A cleanup-coded rollback result is authoritative even if cancellation
        // or a deadline was observed while acquisition was being unwound.
        if (isProcessRuntimeError(cause) && cause.code === "cleanup") {
          throw cause;
        }
        if (failureState !== undefined) {
          throw failureState.error;
        }
        throw errorFrom(cause, "launch", "process launch failed");
      }

      const stdoutRead = drainCapture(running.stdout, (cause) => {
        beginFailure(errorFrom(cause, "stream", "stdout capture failed"), "failed");
      }).then((capture) => {
        if (!capture.normalEof) abnormalCapture = true;
        return capture;
      });
      const stderrRead = drainCapture(running.stderr, (cause) => {
        beginFailure(errorFrom(cause, "stream", "stderr capture failed"), "failed");
      }).then((capture) => {
        if (!capture.normalEof) abnormalCapture = true;
        return capture;
      });
      const captures = Promise.all([stdoutRead, stderrRead]);

      const exitObservation = running.exited.then(
        (exit) => {
          exitState = exit;
          return { kind: "exit" as const };
        },
        (cause) => {
          beginFailure(errorFrom(cause, "stream", "process observation failed"), "failed");
          return { kind: "failure" as const };
        },
      );

      const failureObservation = failure.promise.then(() => ({ kind: "failure" as const }));
      const firstObservation = await Promise.race([exitObservation, failureObservation]);
      completionStarted = true;

      // Normal completion removes request controls before owned cleanup. Timeout
      // and cancellation keep their initiating state through the cleanup window.
      if (firstObservation.kind === "exit" && failureState === undefined) {
        if (timer !== undefined) clearTimeout(timer);
        snapshot.signal?.removeEventListener("abort", onAbort);
      }

      const closeAndSettleCapture = async (): Promise<void> => {
        const initiallySettled = await wait(captures, PROCESS_CLEANUP_STEP_MS);
        if (initiallySettled !== undefined) {
          if (initiallySettled.every((capture) => capture.normalEof)) return;
        }
        const forcedAfterEofDeadline = initiallySettled === undefined && !abnormalCapture;
        let closeFailure: unknown;
        const close = (async () => {
          try {
            await running.closeCapture();
          } catch (cause) {
            closeFailure = cause;
          }
        })();
        const settled = await wait(
          Promise.all([close, captures]).then(() => true).catch((cause) => {
            closeFailure ??= cause;
            return true;
          }),
          PROCESS_CLEANUP_STEP_MS,
        );
        if (settled === undefined) {
          throw cleanupError(
            closeFailure ?? new Error("native capture close or reader settlement remained open"),
            failureState?.error,
          );
        }
        if (closeFailure !== undefined) {
          throw cleanupError(closeFailure, failureState?.error);
        }
        if (forcedAfterEofDeadline) {
          throw cleanupError(new Error("capture EOF deadline elapsed"), failureState?.error);
        }
        // Successful routine close after an abnormal read settlement preserves
        // that stream's initiating failure instead of inventing cleanup failure.
      };

      const runCleanup = async (cause: CompletionCause): Promise<void> => {
        let cleanupFailure: unknown;
        try {
          await running.cleanup(cause);
        } catch (error) {
          cleanupFailure = error;
        }
        try {
          await closeAndSettleCapture();
        } catch (error) {
          if (cleanupFailure === undefined) {
            throw error;
          }
          throw cleanupError(
            new AggregateError([cleanupFailure, error], "cleanup and capture closure both failed"),
            failureState?.error,
          );
        }
        if (cleanupFailure !== undefined) {
          throw cleanupError(cleanupFailure, failureState?.error);
        }
      };

      try {
        await runCleanup(failureState?.cause ?? (firstObservation.kind === "exit" ? "exited" : "failed"));
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        snapshot.signal?.removeEventListener("abort", onAbort);
      }

      const [stdoutCapture, stderrCapture] = await captures;
      const decode = (): ProcessRunResult => {
        const stdout = decodeCapture(stdoutCapture.bytes, snapshot.strictUtf8, "stdout");
        const stderr = decodeCapture(stderrCapture.bytes, snapshot.strictUtf8, "stderr");
        if (exitState === undefined) {
          throw processError("stream", "process exited without an observed result");
        }
        return { ...exitState, stdout, stderr };
      };

      // Timeout is a fixed initiating result: late observations do not replace
      // it. Capture/completion failure keeps its own reason when it started first.
      if (failureState?.cause === "timeout" || failureState?.cause === "failed") {
        throw failureState.error;
      }

      if (failureState?.cause === "cancelled") {
        // Cleanup owns physical termination; collect its terminal observation
        // before applying the fixed post-cancellation precedence.
        await exitObservation;
        // Foundation precedence after cancellation: decode failure, then a
        // recorded completion/capture failure, then independently observed
        // numeric nonzero. A cancellation-induced signal alone stays cancelled.
        try {
          const result = decode();
          if (completionFailure !== undefined) {
            throw completionFailure.error;
          }
          if (result.exitCode !== null && result.exitCode !== undefined && result.exitCode !== 0) {
            return result;
          }
        } catch (cause) {
          if (isProcessRuntimeError(cause)) {
            throw cause;
          }
          throw errorFrom(cause, "stream", "captured output could not be decoded");
        }
        throw failureState.error;
      }

      try {
        return decode();
      } catch (cause) {
        if (isProcessRuntimeError(cause)) {
          throw cause;
        }
        throw errorFrom(cause, "stream", "captured output could not be decoded");
      }
    },
  };
};
