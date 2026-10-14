import type { CompletionCause, Exit, ProcessAdapter, ProcessRunResult, Request, RunningProcess } from "../contract.js";
import { PROCESS_CLEANUP_STEP_MS } from "../contract.js";
import { ProcessRuntimeError, isProcessRuntimeError, type ProcessErrorCode } from "../errors.js";
import { createProcessExecutor } from "../executor.js";

export type ConformanceAdapterMode =
  | "normal"
  | "setup-failure"
  | "cleanup-failure"
  | "setup-cleanup-failure"
  | "pre-retain-failure"
  | "partial-hooks";

export type ConformanceAdapterFactory = (
  mode: ConformanceAdapterMode,
) => ProcessAdapter;

export type ConformanceOptions = {
  readonly adapterFactory: ConformanceAdapterFactory;
  readonly command: string;
  readonly fixturePath: string;
  readonly workingDirectory: string;
  readonly supportsSignalExit: boolean;
};

const fail = (message: string): never => {
  throw new Error(message);
};

const assert = (condition: unknown, message: string): void => {
  if (!condition) fail(message);
};

const expectError = async (
  code: ProcessErrorCode,
  operation: () => Promise<unknown>,
): Promise<ProcessRuntimeError> => {
  try {
    await operation();
  } catch (error) {
    if (isProcessRuntimeError(error)) {
      assert(error.code === code, `expected ${code}, received ${error.code}`);
      return error;
    }
    throw error;
  }
  return fail(`expected ${code} error`);
};

const request = (
  options: ConformanceOptions,
  mode: string,
  extra: Partial<Request> = {},
): Request => ({
  command: options.command,
  args: [options.fixturePath, mode],
  cwd: options.workingDirectory,
  environment: { PROCESS_RUNTIME_CONFORMANCE: "1" },
  ...extra,
});

const run = async (
  options: ConformanceOptions,
  adapterMode: ConformanceAdapterMode,
  input: Request,
): Promise<ProcessRunResult> => {
  return createProcessExecutor(options.adapterFactory(adapterMode)).run(input);
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

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const syntheticStream = (
  values: readonly Uint8Array[] = [],
  failure?: () => Promise<never>,
): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    for (const value of values) yield value;
    if (failure !== undefined) await failure();
  },
});

const syntheticRunning = (
  exited: Promise<Exit>,
  stdout: AsyncIterable<Uint8Array>,
  stderr: AsyncIterable<Uint8Array>,
  cleanup: (cause: CompletionCause) => Promise<void>,
): RunningProcess => ({
  stdout,
  stderr,
  exited,
  cleanup,
  closeCapture: async () => undefined,
});

const syntheticNeverEndingStream = (): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    await new Promise<never>(() => undefined);
  },
});

const syntheticRun = async (
  running: RunningProcess,
  request: Request,
): Promise<ProcessRunResult> =>
  createProcessExecutor({
    launch: async () => running,
  }).run(request);

const expectSyntheticError = async (
  code: ProcessErrorCode,
  operation: () => Promise<unknown>,
): Promise<ProcessRuntimeError> => expectError(code, operation);

const runArbitrationCases = async (): Promise<void> => {
  const baseRequest: Request = {
    command: "synthetic",
    args: [],
    cwd: ".",
  };

  // Detects: cancellation must not hide an independently observed numeric exit.
  {
    const controller = new AbortController();
    const exit = deferred<Exit>();
    const running = syntheticRunning(
      exit.promise,
      syntheticStream(),
      syntheticStream(),
      async () => {
        exit.resolve({ exitCode: 17, signal: null });
      },
    );
    const resultPromise = syntheticRun(running, {
      ...baseRequest,
      signal: controller.signal,
    });
    controller.abort();
    const result = await resultPromise;
    assert(result.exitCode === 17, "cancel plus numeric exit did not return the observed Exit fact");
  }

  // Detects: cancellation must not hide a later capture failure.
  {
    const controller = new AbortController();
    const exit = deferred<Exit>();
    const running = syntheticRunning(
      exit.promise,
      syntheticStream([], async () => {
        await delay(5);
        throw new Error("late capture failure");
      }),
      syntheticStream(),
      async () => {
        exit.resolve({ exitCode: 0, signal: null });
      },
    );
    const resultPromise = syntheticRun(running, {
      ...baseRequest,
      signal: controller.signal,
    });
    controller.abort();
    const error = await expectSyntheticError("stream", () => resultPromise);
    assert(error.message.includes("stdout capture failed"), "cancel plus capture failure lost its capture reason");
  }

  // Detects: cancellation must not hide a later strict UTF-8 decode failure.
  {
    const controller = new AbortController();
    const exit = deferred<Exit>();
    const running = syntheticRunning(
      exit.promise,
      syntheticStream([new Uint8Array([0xff])]),
      syntheticStream(),
      async () => {
        exit.resolve({ exitCode: 0, signal: null });
      },
    );
    const resultPromise = syntheticRun(running, {
      ...baseRequest,
      signal: controller.signal,
      strictUtf8: true,
    });
    controller.abort();
    await expectSyntheticError("invalid-output", () => resultPromise);
  }

  // Detects: an abnormal read settlement must finish through native close, but
  // successful routine cleanup must preserve the stream's initiating reason.
  {
    let cleanupRequested = false;
    let closeRequested = false;
    const running: RunningProcess = {
      stdout: syntheticStream([], async () => {
        throw new Error("early native read failure");
      }),
      stderr: syntheticStream(),
      exited: Promise.resolve({ exitCode: 0, signal: null }),
      cleanup: async () => {
        cleanupRequested = true;
      },
      closeCapture: async () => {
        closeRequested = true;
      },
    };
    const error = await expectSyntheticError("stream", () => syntheticRun(running, baseRequest));
    assert(error.message.includes("stdout capture failed"), "abnormal capture lost its initiating reason");
    assert(
      error.cause instanceof Error && error.cause.message === "early native read failure",
      "abnormal capture lost the native read cause",
    );
    assert(cleanupRequested, "abnormal capture skipped owned cleanup");
    assert(closeRequested, "abnormal capture skipped idempotent native close");
    assert(!error.incompleteCustody, "successful abnormal-error cleanup claimed incomplete custody");
  }

  // Detects: an independently pending capture remains subject to the EOF
  // deadline even after the other capture has already failed.
  {
    let pendingSettled: ((result: IteratorResult<Uint8Array>) => void) | undefined;
    let closeRequested = false;
    const running: RunningProcess = {
      stdout: syntheticStream([], async () => {
        throw new Error("independent stdout read failure");
      }),
      stderr: {
        [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
          return {
            next: () =>
              new Promise<IteratorResult<Uint8Array>>((resolve) => {
                pendingSettled = resolve;
              }),
          };
        },
      },
      exited: Promise.resolve({ exitCode: 0, signal: null }),
      cleanup: async () => undefined,
      closeCapture: async () => {
        closeRequested = true;
        pendingSettled?.({ done: true, value: undefined });
      },
    };
    const started = Date.now();
    const error = await expectSyntheticError("cleanup", () => syntheticRun(running, baseRequest));
    assert(closeRequested, "mixed capture failure skipped forced native closure");
    assert(error.incompleteCustody, "mixed pending capture claimed release");
    assert(
      error.initiatingError instanceof Error &&
        error.initiatingError.message === "stdout capture failed",
      "mixed pending capture lost its initiating stream error",
    );
    assert(
      error.cause instanceof Error && error.cause.message === "capture EOF deadline elapsed",
      "mixed pending capture lost the EOF-deadline cause",
    );
    assert(Date.now() - started >= PROCESS_CLEANUP_STEP_MS, "mixed pending capture bypassed the EOF deadline");
  }

  // Detects: rejected undefined is an explicit cleanup/close failure and is
  // retained in aggregation instead of being mistaken for successful closure.
  {
    const running: RunningProcess = {
      stdout: syntheticStream([], async () => {
        throw undefined;
      }),
      stderr: syntheticStream(),
      exited: Promise.resolve({ exitCode: 0, signal: null }),
      cleanup: async () => {
        throw undefined;
      },
      closeCapture: async () => {
        throw undefined;
      },
    };
    const error = await expectSyntheticError("cleanup", () => syntheticRun(running, baseRequest));
    assert(error.incompleteCustody, "undefined cleanup rejection claimed release");
    assert(
      error.initiatingError instanceof Error &&
        error.initiatingError.message === "stdout capture failed",
      "undefined cleanup rejection lost its initiating stream error",
    );
    const aggregate = error.cause;
    if (!(aggregate instanceof AggregateError)) {
      throw new Error("undefined cleanup rejection was not retained in aggregation");
    }
    if (aggregate.errors.length !== 2 || aggregate.errors[0] !== undefined) {
      throw new Error("undefined cleanup rejection was not retained in aggregation");
    }
    const closeFailure = aggregate.errors[1];
    assert(
      closeFailure instanceof Error &&
        Object.hasOwn(closeFailure, "cause") &&
        closeFailure.cause === undefined,
      "undefined close rejection lost its explicit cause status",
    );
  }

  // Detects: timeout remains the initiating result after late capture failure.
  {
    const exit = deferred<Exit>();
    const running = syntheticRunning(
      exit.promise,
      syntheticStream([], async () => {
        await delay(25);
        throw new Error("late timeout capture failure");
      }),
      syntheticStream(),
      async () => {
        exit.resolve({ exitCode: 0, signal: null });
      },
    );
    await expectSyntheticError("timeout", () =>
      syntheticRun(running, {
        ...baseRequest,
        timeoutMs: 5,
      }),
    );
  }

  // Detects: cleanup failure during setup rollback supersedes timeout and keeps
  // the initiating setup failure plus incomplete-custody fact.
  {
    const adapter: ProcessAdapter = {
      launch: async () => {
        await delay(20);
        throw new ProcessRuntimeError("cleanup", "setup cleanup failed", {
          cause: new Error("cleanup hook failed"),
          initiatingError: new Error("observer setup failed"),
          incompleteCustody: true,
        });
      },
    };
    const error = await expectSyntheticError("cleanup", () =>
      createProcessExecutor(adapter).run({
        ...baseRequest,
        timeoutMs: 5,
      }),
    );
    assert(error.incompleteCustody, "setup cleanup failure lost incomplete custody");
    assert(
      error.initiatingError instanceof Error &&
        error.initiatingError.message === "observer setup failed",
      "setup cleanup failure lost its initiating setup error",
    );
  }
};

export const runProcessRuntimeConformance = async (
  options: ConformanceOptions,
): Promise<void> => {
  await runArbitrationCases();

  const exact = await run(options, "normal", {
    ...request(options, "echo", { args: [options.fixturePath, "echo", "one", "two"] }),
    environment: { EXACT: "yes" },
  });
  assert(exact.stdout.includes('"argv":["echo","one","two"]'), "argv was not passed exactly");
  assert(exact.stdout.includes(`"cwd":${JSON.stringify(options.workingDirectory)}`), "cwd was not passed");
  assert(exact.stdout.includes('"EXACT":"yes"'), "exact environment was not passed");
  assert(!exact.stdout.includes("INHERITED"), "supplied environment silently merged");

  const mutableArgs = [options.fixturePath, "echo", "snapshot"];
  const mutableEnvironment: Record<string, string> = { EXACT: "snapshot" };
  Object.defineProperty(mutableEnvironment, "__proto__", {
    value: "snapshot",
    enumerable: true,
    writable: true,
    configurable: true,
  });
  let snapshotWasFrozen = false;
  let snapshotOwnProto = false;
  const adapter = options.adapterFactory("normal");
  const snapshotRun = createProcessExecutor({
    launch: async (launch) => {
      snapshotWasFrozen =
        Object.isFrozen(launch) &&
        Object.isFrozen(launch.args) &&
        Object.isFrozen(launch.environment);
      snapshotOwnProto =
        launch.environment !== undefined &&
        Object.hasOwn(launch.environment, "__proto__") &&
        launch.environment["__proto__"] === "snapshot";
      return adapter.launch(launch);
    },
  }).run({
    command: options.command,
    args: mutableArgs,
    cwd: options.workingDirectory,
    environment: mutableEnvironment,
  });
  mutableArgs[2] = "mutated";
  mutableEnvironment.EXACT = "mutated";
  Object.defineProperty(mutableEnvironment, "__proto__", {
    value: "mutated",
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const snapshot = await snapshotRun;
  assert(snapshotWasFrozen, "request snapshot was not frozen");
  assert(snapshot.stdout.includes('"argv":["echo","snapshot"]'), "args changed after run entry");
  assert(snapshot.stdout.includes('"EXACT":"snapshot"'), "environment changed after run entry");
  assert(snapshotOwnProto, "own __proto__ environment key was not preserved");

  const concurrent = await run(options, "normal", request(options, "concurrent"));
  assert(concurrent.stdout === "out-0out-1out-2", "concurrent stdout was reordered or truncated");
  assert(concurrent.stderr === "err-0err-1err-2", "concurrent stderr was reordered or truncated");

  const numeric = await run(options, "normal", request(options, "exit", { args: [options.fixturePath, "exit", "7"] }));
  assert(numeric.exitCode === 7 && numeric.signal === null, "numeric exit facts changed");

  const signal = await run(options, "normal", request(options, "signal"));
  if (options.supportsSignalExit) {
    assert(signal.exitCode === null && signal.signal !== null, "signal exit facts were not preserved");
  }

  const split = await run(options, "normal", request(options, "split-utf8"));
  assert(split.stdout === "AéB", "split UTF-8 bytes were decoded too early");

  const exactLimit = await run(options, "normal", request(options, "limit"));
  assert(new TextEncoder().encode(exactLimit.stdout).byteLength === 4 * 1024 * 1024, "4 MiB capture limit rejected valid output");

  const invalidReplacement = await run(options, "normal", request(options, "invalid-utf8"));
  assert(invalidReplacement.stdout === "\uFFFD", "default UTF-8 replacement was not explicit");
  await expectError("invalid-output", () =>
    run(options, "normal", {
      ...request(options, "invalid-utf8"),
      strictUtf8: true,
    }),
  );

  await expectError("output-limit", () => run(options, "normal", request(options, "overflow")));
  await expectError("invalid-input", async () => {
    options.adapterFactory("partial-hooks");
  });
  await expectError("invalid-input", async () =>
    run(options, "normal", {
      ...request(options, "echo"),
      command: "",
    }),
  );
  await expectError("invalid-input", async () =>
    run(options, "normal", {
      ...request(options, "echo"),
      timeoutMs: 0,
    }),
  );
  // Detects: sparse argv holes must reject before any adapter launch.
  {
    const adapter = options.adapterFactory("normal");
    let launchCount = 0;
    const sparseArgs: string[] = new Array<string>(1);
    await expectError("invalid-input", () =>
      createProcessExecutor({
        launch: async (launch) => {
          launchCount += 1;
          return adapter.launch(launch);
        },
      }).run({
        command: options.command,
        args: sparseArgs,
        cwd: options.workingDirectory,
      }),
    );
    assert(launchCount === 0, "sparse argv reached adapter.launch");
  }
  await expectError("launch", () =>
    run(options, "normal", {
      ...request(options, "touch"),
      command: `missing-process-runtime-${Date.now()}`,
    }),
  );

  const marker = `${options.workingDirectory}/pre-abort-marker`;
  const controller = new AbortController();
  controller.abort();
  await expectError("cancelled", () =>
    run(options, "normal", {
      ...request(options, "touch", { args: [options.fixturePath, "touch", marker] }),
      signal: controller.signal,
    }),
  );
  try {
    const { readFile } = await import("node:fs/promises");
    await readFile(marker);
    fail("pre-abort request created effects");
  } catch (error) {
    assert((error as { code?: string }).code === "ENOENT", "pre-abort marker unexpectedly exists");
  }

  const activeAbort = new AbortController();
  const activeRun = run(options, "normal", {
    ...request(options, "slow"),
    signal: activeAbort.signal,
    timeoutMs: 2_000,
  });
  setTimeout(() => activeAbort.abort(), 25);
  await expectError("cancelled", () => activeRun);

  await expectError("timeout", () =>
    run(options, "normal", {
      ...request(options, "slow"),
      timeoutMs: 25,
    }),
  );

  await expectError("launch", () =>
    run(options, "setup-failure", request(options, "slow")),
  );

  // Detects: rollback cleanup failure must win over setup failure and retain
  // the initiating setup error plus incomplete-custody fact.
  const setupCleanupFailure = await expectError("cleanup", () =>
    run(options, "setup-cleanup-failure", request(options, "slow")),
  );
  assert(setupCleanupFailure.incompleteCustody, "setup cleanup failure lost incomplete custody");
  assert(
    setupCleanupFailure.initiatingError instanceof Error &&
      setupCleanupFailure.initiatingError.message === "observer setup",
    `setup cleanup failure lost its initiating setup error: ${String(setupCleanupFailure.initiatingError)}`,
  );
  await expectError("launch", () =>
    run(options, "pre-retain-failure", request(options, "slow")),
  );

  const cleanupFailure = await expectError("cleanup", () =>
    run(options, "cleanup-failure", {
      ...request(options, "slow"),
      timeoutMs: 25,
    }),
  );
  assert(cleanupFailure.incompleteCustody, "cleanup failure did not retain incomplete custody");
  assert(
    isProcessRuntimeError(cleanupFailure.initiatingError) &&
      cleanupFailure.initiatingError.code === "timeout",
    "cleanup failure did not retain timeout as its initiating problem",
  );

  // Detects: forced closure after the EOF deadline is cleanup failure and
  // retains close-requested, cause and incomplete-custody facts. A descendant
  // inheriting stdio is not a portable retained-pipe oracle:
  // Windows/libuv may honestly deliver EOF when the launched child exits.
  // This deterministic pair instead remains open past both cleanup bounds and
  // proves that an unclosed reader is never converted into success.
  {
    let closeRequested = false;
    const running: RunningProcess = {
      stdout: syntheticNeverEndingStream(),
      stderr: syntheticNeverEndingStream(),
      exited: Promise.resolve({ exitCode: 0, signal: null }),
      cleanup: async () => undefined,
      closeCapture: async () => {
        closeRequested = true;
        throw new Error("synthetic native close failed");
      },
    };
    const error = await expectSyntheticError("cleanup", () =>
      syntheticRun(running, {
        command: "synthetic",
        args: [],
        cwd: ".",
      }),
    );
    assert(closeRequested, "unclosed capture did not reach native close");
    assert(error.incompleteCustody, "unclosed capture claimed release");
    assert(
      error.cause instanceof Error && error.cause.message === "synthetic native close failed",
      "unclosed capture lost the native close failure",
    );
  }

  await expectError("timeout", () =>
    run(options, "normal", {
      ...request(options, "late-overflow"),
      timeoutMs: 25,
    }),
  );
};
