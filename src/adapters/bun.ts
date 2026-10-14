import type { CompletionCause, Exit, Launch, ProcessAdapter, RunningProcess } from "../contract.js";
import { PROCESS_CLEANUP_STEP_MS } from "../contract.js";
import { ProcessRuntimeError, processError } from "../errors.js";
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
  if (signal === null) return null;
  return typeof signal === "string" ? signal : String(signal);
};

const observeExit = (child: BunChild): ExitObservation => {
  let terminal = false;
  let terminalResolve!: () => void;
  const terminalProof = new Promise<void>((resolve) => {
    terminalResolve = resolve;
  });
  let settle!: (value: Exit) => void;
  let reject!: (reason: unknown) => void;
  const exited = new Promise<Exit>((resolve, rejectPromise) => {
    settle = resolve;
    reject = rejectPromise;
  });
  void exited.catch(() => undefined);
  void child.exited.then(
    () => {
      if (terminal) return;
      terminal = true;
      terminalResolve();
      settle({
        exitCode: child.exitCode,
        signal: signalName(child.signalCode),
      });
    },
    (error: unknown) => {
      // Bun documents `exited` as resolving when the process exits; a rejection
      // is an observation error and is not accepted as terminal proof.
      reject(processError("launch", "child process observation failed", error));
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
        if (timer !== undefined) clearTimeout(timer);
      }) as Promise<boolean>;
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
    if (released) return;
    reader.releaseLock();
    released = true;
  };
  const close = (): Promise<void> => {
    if (closed && released) return Promise.resolve();
    closePromise ??= (async () => {
      closed = true;
      const cancellation = Promise.resolve().then(() => reader.cancel());
      // A pending read may make the first release attempt illegal. Try both
      // immediately and after cancellation settles, retaining the final error.
      let releaseFailure: unknown;
      try {
        release();
      } catch (error) {
        releaseFailure = error;
      }
      try {
        await cancellation;
      } finally {
        try {
          release();
          releaseFailure = undefined;
        } catch (error) {
          releaseFailure ??= error;
        }
      }
      if (releaseFailure !== undefined) throw releaseFailure;
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
            if (closed) return { done: true, value: undefined };
            try {
              const result = await reader.read();
              if (result.done) {
                closed = true;
                release();
                return { done: true, value: undefined };
              }
              return { done: false, value: result.value };
            } catch (error) {
              if (closed) return { done: true, value: undefined };
              throw error;
            }
          },
          async return(): Promise<IteratorResult<Uint8Array>> {
            // Do not replace an abnormal read cause with a later close error.
            // The executor observes this same idempotent close after cleanup.
            void close().catch(() => undefined);
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
      closePromise ??= Promise.all([stdout.close(), stderr.close()]).then(() => undefined);
      return closePromise;
    },
  };
};

const defaultAcquire = (request: Launch, retain: BunRetain): void => {
  const environment: Record<string, string> =
    request.environment === undefined
      ? Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        )
      : { ...request.environment };
  const child = Bun.spawn([request.command, ...request.args], {
    cwd: request.cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  retain(child);
};

export const createBunProcessAdapter = (
  options: BunProcessAdapterOptions = {},
): ProcessAdapter => {
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
        let cleanupFailure: unknown;
        try {
          await (customCleanup ?? ((target, cause) => defaultCleanup(target, cause, observed)))(child, "failed");
        } catch (error) {
          cleanupFailure = error;
        }
        try {
          await closeBunCaptureWithin(child, captureOwners);
        } catch (error) {
          cleanupFailure ??= error;
        }
        if (cleanupFailure !== undefined) {
          throw new ProcessRuntimeError("cleanup", "process setup cleanup failed", {
            cause: cleanupFailure,
            initiatingError: cause,
            incompleteCustody: true,
          });
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
  const operations: Promise<unknown>[] = captureOwners.map((capture) =>
    Promise.resolve().then(() => capture.close()),
  );
  for (const stream of [child.stdout, child.stderr]) {
    if (!(stream instanceof ReadableStream) || stream.locked) continue;
    operations.push(Promise.resolve().then(() => stream.cancel()));
  }
  const settled = await Promise.all(
    operations.map((operation) =>
      operation.then(
        () => undefined,
        (error: unknown) => error,
      ),
    ),
  );
  const errors = settled.filter((error): error is unknown => error !== undefined);
  if (errors.length > 0) {
    throw errors.length === 1 ? errors[0] : new AggregateError(errors, "native capture closure failed");
  }
};

const closeBunCaptureWithin = async (
  child: BunChild,
  captureOwners: readonly StreamCapture[] = [],
): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(processError("cleanup", "native capture close or reader settlement timed out")),
      PROCESS_CLEANUP_STEP_MS,
    );
  });
  try {
    await Promise.race([closeBunCapture(child, captureOwners), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};
