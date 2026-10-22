import type { CompletionCause, Exit, Launch, ProcessAdapter, RunningProcess } from "../contract.js";
import { PROCESS_CLEANUP_STEP_MS } from "../contract.js";
import { ProcessRuntimeError, processError } from "../errors.js";
import {
  rejectedReasons,
  settleOperation,
  settleWithin,
  withCause,
} from "../internal/settlement.js";
import { cleanupDirectChild } from "../internal/termination.js";

type BunChild = Bun.Subprocess<"ignore", "pipe", "pipe">;

export type BunRetain = (child: BunChild) => void;
export type BunAcquireHook = (request: Launch, retain: BunRetain) => void;
export type BunCleanupHook = (child: BunChild, cause: CompletionCause) => Promise<void>;

export type BunProcessAdapterOptions = {
  readonly acquire?: BunAcquireHook;
  readonly cleanup?: BunCleanupHook;
};

type ExitObservation = {
  readonly exited: Promise<Exit>;
  readonly isTerminal: () => boolean;
  readonly waitForTerminal: (timeoutMs: number) => Promise<boolean>;
};

const signalName = (signal: NodeJS.Signals | number | null): string | null => {
  if (signal === null) {
    return null;
  }
  return typeof signal === "string" ? signal : String(signal);
};

const observeExit = (child: BunChild): ExitObservation => {
  let terminal = false;
  let terminalResolve!: () => void;
  const terminalProof = new Promise<void>((resolve) => {
    terminalResolve = resolve;
  });
  let settle!: (value: Exit) => void;
  let rejectExit!: (reason: unknown) => void;
  const exited = new Promise<Exit>((resolve, reject) => {
    settle = resolve;
    rejectExit = reject;
  });
  void exited.catch(() => {});
  void child.exited.then(
    () => {
      if (terminal) {
        return false;
      }
      terminal = true;
      terminalResolve();
      settle({
        exitCode: child.exitCode,
        signal: signalName(child.signalCode),
      });
      return true;
    },
    (error: unknown) => {
      // Bun documents `exited` as resolving when the process exits; a rejection
      // is an observation error and is not accepted as terminal proof.
      rejectExit(processError("launch", "child process observation failed", error));
    },
  );
  return {
    exited,
    isTerminal: () => terminal,
    waitForTerminal: (timeoutMs: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      });
      const settled = terminalProof.then(() => true);
      return Promise.race([settled, timeout]).finally(() => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      });
    },
  };
};

const defaultCleanup = (
  child: BunChild,
  cause: CompletionCause,
  observation: ExitObservation,
): Promise<void> =>
  cleanupDirectChild({
    cause,
    isTerminal: observation.isTerminal,
    waitForTerminal: observation.waitForTerminal,
    terminate: (signal) => {
      child.kill(signal);
    },
  });

type StreamCapture = {
  readonly stream: AsyncIterable<Uint8Array>;
  readonly close: () => Promise<void>;
};

const captureStream = (native: ReadableStream<Uint8Array>): StreamCapture => {
  const reader = native.getReader();
  let closed = false;
  let released = false;
  let iteratorUsed = false;
  let closePromise: Promise<void> | undefined;
  const release = (): void => {
    if (released) {
      return;
    }
    reader.releaseLock();
    released = true;
  };
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      if (closed && released) {
        return;
      }
      closed = true;
      // Cancellation must run while this reader is still attached. Release is
      // attempted immediately and again after cancellation settles.
      const cancellation = settleOperation(() => reader.cancel());
      const firstRelease = settleOperation(release);
      const cancellationSettlement = await cancellation;
      const releases = [await firstRelease, await settleOperation(release)];
      const failures = rejectedReasons([cancellationSettlement, ...releases]);
      if (failures.length === 1) {
        throw failures[0];
      }
      if (failures.length > 1) {
        throw new AggregateError(failures, "native reader closure failed");
      }
    })();
    return closePromise;
  };
  return {
    stream: {
      [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        if (iteratorUsed) {
          throw processError("stream", "capture stream has one consumer");
        }
        iteratorUsed = true;
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            if (closed) {
              return { done: true, value: undefined };
            }
            try {
              const result = await reader.read();
              if (result.done) {
                closed = true;
                release();
                return { done: true, value: undefined };
              }
              return { done: false, value: result.value };
            } catch (error) {
              if (closed) {
                return { done: true, value: undefined };
              }
              throw error;
            }
          },
          async return(): Promise<IteratorResult<Uint8Array>> {
            // Do not replace an abnormal read cause with a later close error.
            // The executor observes this same idempotent close after cleanup.
            void close().catch(() => {});
            return { done: true, value: undefined };
          },
        };
      },
    },
    close,
  };
};

const createRunning = (
  child: BunChild,
  observation: ExitObservation,
  cleanupHook: BunCleanupHook,
  captureOwners: StreamCapture[],
): RunningProcess => {
  if (!(child.stdout instanceof ReadableStream) || !(child.stderr instanceof ReadableStream)) {
    throw processError("launch", "capture stream was unavailable");
  }
  const stdout = captureStream(child.stdout);
  captureOwners.push(stdout);
  const stderr = captureStream(child.stderr);
  captureOwners.push(stderr);
  let cleanupPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  return {
    stdout: stdout.stream,
    stderr: stderr.stream,
    exited: observation.exited,
    cleanup: (cause) => {
      cleanupPromise ??= (async () => {
        await cleanupHook(child, cause);
      })();
      return cleanupPromise;
    },
    closeCapture: () => {
      closePromise ??= (async () => {
        await Promise.all([stdout.close(), stderr.close()]);
      })();
      return closePromise;
    },
  };
};

const defaultAcquire = (request: Launch, retain: BunRetain): void => {
  const environment: Record<string, string> =
    request.environment === undefined
      ? Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        )
      : { ...request.environment };
  const child = Bun.spawn([request.command, ...request.args], {
    cwd: request.cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  retain(child);
};

export const createBunProcessAdapter = (options: BunProcessAdapterOptions = {}): ProcessAdapter => {
  const hasAcquire = options.acquire !== undefined;
  const hasCleanup = options.cleanup !== undefined;
  if (hasAcquire !== hasCleanup) {
    throw processError("invalid-input", "acquire and cleanup hooks must be provided together");
  }
  const acquire = options.acquire ?? defaultAcquire;
  const customCleanup = options.cleanup;

  return {
    launch: async (request: Launch): Promise<RunningProcess> => {
      let retainedChild: BunChild | undefined;
      let retainCount = 0;
      let observation: ExitObservation | undefined;
      const captureOwners: StreamCapture[] = [];
      const retain = (child: BunChild): void => {
        retainCount += 1;
        if (retainCount !== 1 || !(child instanceof Object)) {
          throw processError("invalid-input", "retain must be called exactly once with one child");
        }
        retainedChild = child;
        observation = observeExit(child);
      };

      const rollback = async (cause: unknown): Promise<never> => {
        const child = retainedChild;
        if (child === undefined) {
          throw processError("launch", "process setup failed", cause);
        }
        const observed = observation ?? observeExit(child);
        const cleanupSettlement = await settleOperation(() =>
          (
            customCleanup ??
            ((target, cleanupCause) => defaultCleanup(target, cleanupCause, observed))
          )(child, "failed"),
        );
        const closeSettlement = await settleOperation(() =>
          closeBunCaptureWithin(child, captureOwners),
        );
        const failures = rejectedReasons([cleanupSettlement, closeSettlement]);
        if (failures.length > 0) {
          const cleanupCause =
            failures.length === 1
              ? failures[0]
              : new AggregateError(failures, "cleanup and capture closure both failed");
          throw withCause(
            new ProcessRuntimeError("cleanup", "process setup cleanup failed", {
              cause: cleanupCause,
              initiatingError: cause,
              incompleteCustody: true,
            }),
            cleanupCause,
          );
        }
        throw processError("launch", "process setup failed", cause);
      };

      try {
        acquire(request, retain);
      } catch (cause) {
        return rollback(cause);
      }
      if (retainedChild === undefined || observation === undefined) {
        return rollback(new Error("acquire did not retain one child"));
      }
      let running: RunningProcess;
      try {
        const observed = observation ?? observeExit(retainedChild);
        running = createRunning(
          retainedChild,
          observed,
          customCleanup ?? ((child, cause) => defaultCleanup(child, cause, observed)),
          captureOwners,
        );
        return running;
      } catch (cause) {
        return rollback(cause);
      }
    },
  };
};

const closeBunCapture = async (
  child: BunChild,
  captureOwners: readonly StreamCapture[] = [],
): Promise<void> => {
  const operations: (() => Promise<void>)[] = captureOwners.map((capture) => () => capture.close());
  for (const stream of [child.stdout, child.stderr]) {
    if (!(stream instanceof ReadableStream) || stream.locked) {
      continue;
    }
    operations.push(async () => {
      await stream.cancel();
    });
  }
  const settled = await Promise.all(
    operations.map((operation) => settleWithin(operation, PROCESS_CLEANUP_STEP_MS)),
  );
  const failures = settled.flatMap((settlement): unknown[] => {
    if (settlement.status === "rejected") {
      return [settlement.reason];
    }
    if (settlement.status === "timeout") {
      return [processError("cleanup", "native capture close or reader settlement timed out")];
    }
    return [];
  });
  if (failures.length > 0) {
    throw failures.length === 1
      ? failures[0]
      : new AggregateError(failures, "native capture closure failed");
  }
};

const closeBunCaptureWithin = async (
  child: BunChild,
  captureOwners: readonly StreamCapture[] = [],
): Promise<void> => {
  await closeBunCapture(child, captureOwners);
};
