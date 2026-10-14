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
import { ProcessRuntimeError, processError } from "./errors.js";
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
      let exitState: Exit | undefined;
      let completionStarted = false;

      const beginFailure = (error: ProcessRuntimeError, cause: CompletionCause): void => {
        if (failureState !== undefined) {
          return;
        }
        failureState = { error, cause };
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
        if (failureState !== undefined) {
          throw failureState.error;
        }
        throw errorFrom(cause, "launch", "process launch failed");
      }

      const stdoutRead = drainCapture(running.stdout, (cause) => {
        beginFailure(errorFrom(cause, "stream", "stdout capture failed"), "failed");
      });
      const stderrRead = drainCapture(running.stderr, (cause) => {
        beginFailure(errorFrom(cause, "stream", "stderr capture failed"), "failed");
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

      const closeAndSettleCapture = async (): Promise<void> => {
        if ((await wait(captures, PROCESS_CLEANUP_STEP_MS)) !== undefined) {
          return;
        }
        let closeFailure: unknown;
        const close = (async () => {
          try {
            await running.closeCapture();
          } catch (cause) {
            closeFailure = cause;
          }
        })();
        const settled = await wait(
          Promise.all([close, captures]).then(() => true),
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
        throw cleanupError(new Error("capture EOF was not observed normally"), failureState?.error);
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
      let stdout: string;
      let stderr: string;
      try {
        stdout = decodeCapture(stdoutCapture.bytes, snapshot.strictUtf8, "stdout");
        stderr = decodeCapture(stderrCapture.bytes, snapshot.strictUtf8, "stderr");
      } catch (cause) {
        if (failureState !== undefined) {
          throw failureState.error;
        }
        throw errorFrom(cause, "stream", "captured output could not be decoded");
      }
      if (failureState !== undefined) {
        throw failureState.error;
      }
      if (exitState === undefined) {
        throw processError("stream", "process exited without an observed result");
      }
      return { ...exitState, stdout, stderr };
    },
  };
};
