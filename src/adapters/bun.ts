import type { CompletionCause, Exit, Launch, ProcessAdapter, RunningProcess } from "../contract.js";
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
};

const signalName = (signal: NodeJS.Signals | number | null): string | null => {
  if (signal === null) return null;
  return typeof signal === "string" ? signal : String(signal);
};

const observeExit = (child: BunChild): ExitObservation => {
  let terminal = false;
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
      settle({
        exitCode: child.exitCode,
        signal: signalName(child.signalCode),
      });
    },
    (error: unknown) => {
      if (terminal) return;
      terminal = true;
      reject(processError("launch", "child process observation failed", error));
    },
  );
  return { exited, isTerminal: () => terminal };
};

const waitForTerminal = (observation: ExitObservation, timeoutMs: number): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const settled = observation.exited.then(
    () => true,
    () => true,
  );
  return Promise.race([settled, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<boolean>;
};

const defaultCleanup = (
  child: BunChild,
  cause: CompletionCause,
  observation: ExitObservation,
): Promise<void> =>
  cleanupDirectChild({
    cause,
    isTerminal: observation.isTerminal,
    waitForTerminal: (timeoutMs) => waitForTerminal(observation, timeoutMs),
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
  let iteratorUsed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
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
              return result.done
                ? { done: true, value: undefined }
                : { done: false, value: result.value };
            } catch (error) {
              if (closed) return { done: true, value: undefined };
              throw error;
            }
          },
          async return(): Promise<IteratorResult<Uint8Array>> {
            await close();
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
): RunningProcess => {
  if (!(child.stdout instanceof ReadableStream) || !(child.stderr instanceof ReadableStream)) {
    throw processError("launch", "capture stream was unavailable");
  }
  const stdout = captureStream(child.stdout);
  const stderr = captureStream(child.stderr);
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
          await closeBunCapture(child);
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
        );
        return running;
      } catch (cause) {
        return rollback(cause);
      }
    },
  };
};

const closeBunCapture = async (child: BunChild): Promise<void> => {
  if (child.stdout instanceof ReadableStream) {
    await child.stdout.cancel();
  }
  if (child.stderr instanceof ReadableStream) {
    await child.stderr.cancel();
  }
};
