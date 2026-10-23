import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import type { CompletionCause, Exit, Launch, ProcessAdapter, RunningProcess } from "../contract.js";
import { PROCESS_CLEANUP_STEP_MS } from "../contract.js";
import { ProcessRuntimeError, processError } from "../errors.js";
import { rejectedReasons, settleOperation, withCause } from "../internal/settlement.js";
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
  readonly hasPid: () => boolean;
  readonly waitForTerminal: (timeoutMs: number) => Promise<boolean>;
};

const streamOrThrow = (stream: Readable | null, name: string): Readable => {
  if (stream === null) {
    throw processError("launch", `${name} capture stream was unavailable`);
  }
  return stream;
};

const observeExit = (child: ChildProcess): ExitObservation => {
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
  const onExit = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
    if (terminal) {
      return;
    }
    terminal = true;
    terminalResolve();
    settle({ exitCode, signal: signal === null ? null : signal });
  };
  const onError = (error: Error): void => {
    // ChildProcess errors may be emitted while a live child remains. They are
    // observation failures, not proof that the process reached a terminal state.
    if (terminal) {
      return;
    }
    rejectExit(processError("launch", "child process observation failed", error));
  };
  child.once("exit", onExit);
  child.on("error", onError);
  return {
    exited,
    isTerminal: () => terminal,
    hasPid: () => child.pid !== undefined,
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
  child: ChildProcess,
  cause: CompletionCause,
  observation: ExitObservation,
): Promise<void> => {
  if (!observation.hasPid()) {
    return Promise.reject(processError("cleanup", "child process was never spawned"));
  }
  return cleanupDirectChild({
    cause,
    isTerminal: observation.isTerminal,
    waitForTerminal: observation.waitForTerminal,
    terminate: (signal) => {
      if (!child.kill(signal) && !observation.isTerminal()) {
        throw processError("cleanup", `child process rejected ${signal}`);
      }
    },
  });
};

const closeNodeCapture = async (child: ChildProcess): Promise<void> => {
  const streams = [child.stdout, child.stderr].filter(
    (stream): stream is Readable => stream !== null,
  );
  await Promise.all(
    streams.map(
      (stream) =>
        new Promise<void>((resolve, reject) => {
          if (stream.closed) {
            resolve();
            return;
          }
          let settled = false;
          const onClose = (): void => {
            if (settled) {
              return;
            }
            settled = true;
            resolve();
          };
          const onError = (error: Error): void => {
            if (settled) {
              return;
            }
            settled = true;
            reject(error);
          };
          stream.once("close", onClose);
          // Keep the listener attached after the first failure so repeated
          // native stream errors cannot become unhandled EventEmitter errors.
          stream.on("error", onError);
          stream.destroy();
        }),
    ),
  );
};

const closeNodeCaptureWithin = async (child: ChildProcess): Promise<void> => {
  const close = closeNodeCapture(child);
  close.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(processError("cleanup", "native capture closure timed out")),
      PROCESS_CLEANUP_STEP_MS,
    );
  });
  try {
    await Promise.race([close, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
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
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
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
        const cleanupSettlement = await settleOperation(async () => {
          if (customCleanup !== undefined) {
            await customCleanup(child, "failed");
          } else if (observed.hasPid()) {
            await defaultCleanup(child, "failed", observed);
          }
        });
        const closeSettlement = await settleOperation(() => closeNodeCaptureWithin(child));
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
        );
        await new Promise<void>((resolve, reject) => {
          const onSpawn = (): void => {
            retainedChild?.off("error", onError);
            resolve();
          };
          const onError = (error: Error): void => {
            retainedChild?.off("spawn", onSpawn);
            reject(error);
          };
          retainedChild?.once("spawn", onSpawn);
          retainedChild?.once("error", onError);
        });
        return running;
      } catch (cause) {
        return rollback(cause);
      }
    },
  };
};
