import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import type { CompletionCause, Exit, Launch, ProcessAdapter, RunningProcess } from "../contract.js";
import { ProcessRuntimeError, processError } from "../errors.js";
import { cleanupDirectChild } from "../internal/termination.js";

export type NodeRetain = (child: ChildProcess) => void;
export type NodeAcquireHook = (request: Launch, retain: NodeRetain) => void;
export type NodeCleanupHook = (child: ChildProcess, cause: CompletionCause) => Promise<void>;

export type NodeProcessAdapterOptions = {
  readonly acquire?: NodeAcquireHook;
  readonly cleanup?: NodeCleanupHook;
};

type ExitObservation = {
  readonly exited: Promise<Exit>;
  readonly isTerminal: () => boolean;
};

const streamOrThrow = (stream: Readable | null, name: string): Readable => {
  if (stream === null) {
    throw processError("launch", `${name} capture stream was unavailable`);
  }
  return stream;
};

const observeExit = (child: ChildProcess): ExitObservation => {
  let terminal = false;
  let settle!: (value: Exit) => void;
  let reject!: (reason: unknown) => void;
  const exited = new Promise<Exit>((resolve, rejectPromise) => {
    settle = resolve;
    reject = rejectPromise;
  });
  void exited.catch(() => undefined);
  const onExit = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
    if (terminal) return;
    terminal = true;
    settle({ exitCode, signal: signal === null ? null : String(signal) });
  };
  const onError = (error: Error): void => {
    if (terminal) return;
    terminal = true;
    reject(processError("launch", "child process observation failed", error));
  };
  child.once("exit", onExit);
  child.once("error", onError);
  return {
    exited,
    isTerminal: () => terminal,
  };
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
  child: ChildProcess,
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

const closeNodeCapture = async (child: ChildProcess): Promise<void> => {
  for (const stream of [child.stdout, child.stderr]) {
    if (stream !== null && !stream.destroyed) {
      stream.destroy();
    }
  }
};

const createRunning = (
  child: ChildProcess,
  observation: ExitObservation,
  cleanupHook: NodeCleanupHook,
): RunningProcess => {
  const stdout = streamOrThrow(child.stdout, "stdout");
  const stderr = streamOrThrow(child.stderr, "stderr");
  let cleanupPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  return {
    stdout,
    stderr,
    exited: observation.exited,
    cleanup: (cause) => {
      cleanupPromise ??= (async () => {
        await cleanupHook(child, cause);
      })();
      return cleanupPromise;
    },
    closeCapture: () => {
      closePromise ??= closeNodeCapture(child);
      return closePromise;
    },
  };
};

const defaultAcquire = (request: Launch, retain: NodeRetain): void => {
  const environment: Record<string, string> =
    request.environment === undefined
      ? Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        )
      : { ...request.environment };
  const child = spawn(request.command, [...request.args], {
    cwd: request.cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  retain(child);
};

export const createNodeProcessAdapter = (
  options: NodeProcessAdapterOptions = {},
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
      let retainedChild: ChildProcess | undefined;
      let retainCount = 0;
      let observation: ExitObservation | undefined;
      const retain = (child: ChildProcess): void => {
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
          await closeNodeCapture(child);
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
        await new Promise<void>((resolve, reject) => {
          retainedChild?.once("spawn", resolve);
          retainedChild?.once("error", reject);
        });
        return running;
      } catch (cause) {
        return rollback(cause);
      }
    },
  };
};
