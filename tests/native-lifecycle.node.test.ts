import { spawnSync, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Launch } from "../src/contract.js";
import { createProcessExecutor } from "../src/executor.js";
import {
  createNodeProcessAdapter,
  type NodeAcquireHook,
  type NodeCleanupHook,
} from "../src/adapters/node.js";

const nodeExecutable = process.env.NODE_EXECUTABLE ?? process.execPath;

const launchRequest = (directory: string): Launch => ({
  command: nodeExecutable,
  args: ["-e", "setTimeout(() => {}, 1000)"],
  cwd: directory,
  environment: {},
});

const killAndAwait: NodeCleanupHook = async (child) => {
  child.kill("SIGKILL");
  await once(child, "exit");
};

const replaceCapture = (
  child: ReturnType<typeof spawn>,
  stdout: Readable,
  stderr: Readable,
): void => {
  Object.defineProperty(child, "stdout", { value: stdout, configurable: true });
  Object.defineProperty(child, "stderr", { value: stderr, configurable: true });
};

// Detects: normal EOF must settle and release both native Node readers.
void test("Node adapter releases native readers after normal EOF", async () => {
  const directory = await mkdtemp(join(resolve("sandbox"), "TEST-process-runtime-node-eof-"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const adapter = createNodeProcessAdapter({
      acquire: (request, retain) => {
        child = spawn(request.command, [...request.args], {
          cwd: request.cwd,
          env: request.environment,
          stdio: ["ignore", "pipe", "pipe"],
        });
        retain(child);
      },
      cleanup: async (target, cause) => {
        if (cause !== "exited") {
          target.kill("SIGKILL");
        }
      },
    });
    const result = await createProcessExecutor(adapter).run({
      command: nodeExecutable,
      args: ["-e", "process.stdout.write('eof'); process.stderr.write('err')"],
      cwd: directory,
      environment: {},
    });
    assert.equal(result.stdout, "eof");
    assert.equal(result.stderr, "err");
    assert.equal(child?.stdout?.readableEnded, true);
    assert.equal(child?.stderr?.readableEnded, true);
  } finally {
    if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await rm(directory, { recursive: true, force: true });
  }
});

// Detects: `destroyed` is a close request, not proof that the native stream
// emitted its physical `close` event.
void test("Node adapter waits for physical close after destroy", async () => {
  const directory = await mkdtemp(join(resolve("sandbox"), "TEST-process-runtime-node-close-"));
  const stdout = delayedClose(40);
  const stderr = delayedClose(40);
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const acquire: NodeAcquireHook = (request, retain) => {
      child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: request.environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
      retain(child);
      replaceCapture(child, stdout, stderr);
      throw new Error("observer setup failed");
    };
    const adapter = createNodeProcessAdapter({ acquire, cleanup: killAndAwait });
    await assert.rejects(adapter.launch(launchRequest(directory)), (error: unknown) => {
      assert.equal(errorField(error, "code"), "launch");
      return true;
    });
    assert.equal(stdout.destroyed, true);
    assert.equal(stdout.closed, true);
    assert.equal(stderr.destroyed, true);
    assert.equal(stderr.closed, true);
  } finally {
    if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await rm(directory, { recursive: true, force: true });
  }
});

// Detects: setup rollback has the same finite native closure bound as normal
// cleanup and retains incomplete-custody metadata when close never settles.
void test(
  "Node setup rollback times out an unclosed native reader",
  { timeout: 2_500 },
  async () => {
    const directory = await mkdtemp(
      join(resolve("sandbox"), "TEST-process-runtime-node-rollback-"),
    );
    const stdout = neverClose();
    const stderr = neverClose();
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const acquire: NodeAcquireHook = (request, retain) => {
        child = spawn(request.command, [...request.args], {
          cwd: request.cwd,
          env: request.environment,
          stdio: ["ignore", "pipe", "pipe"],
        });
        retain(child);
        replaceCapture(child, stdout, stderr);
        throw new Error("observer setup failed");
      };
      const adapter = createNodeProcessAdapter({ acquire, cleanup: killAndAwait });
      await assert.rejects(adapter.launch(launchRequest(directory)), (error: unknown) => {
        assert.equal(errorField(error, "code"), "cleanup");
        assert.equal(errorField(error, "incompleteCustody"), true);
        assert.equal(
          errorField(errorField(error, "initiatingError"), "message"),
          "observer setup failed",
        );
        return true;
      });
      assert.equal(stdout.destroyed, true);
      assert.equal(stdout.closed, false);
      assert.equal(stderr.destroyed, true);
      assert.equal(stderr.closed, false);
    } finally {
      if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);

// Detects: repeated ChildProcess control errors are absorbed while the child
// remains live and cannot be mistaken for physical terminal observation.
void test("Node observation distinguishes repeated live errors from exit", async () => {
  const directory = await mkdtemp(join(resolve("sandbox"), "TEST-process-runtime-node-errors-"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const acquire: NodeAcquireHook = (request, retain) => {
      child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: request.environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
      retain(child);
    };
    const adapter = createNodeProcessAdapter({ acquire, cleanup: killAndAwait });
    const running = await adapter.launch(launchRequest(directory));
    const observation = running.exited.then(
      () => ({ kind: "exit" as const }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );
    await Promise.resolve();
    assert.ok(child !== undefined);
    child.emit("error", new Error("first live control error"));
    child.emit("error", new Error("second live control error"));
    const observed = await observation;
    assert.equal(observed.kind, "error");
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
    await running.cleanup("failed");
    await running.closeCapture();
  } finally {
    if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await rm(directory, { recursive: true, force: true });
  }
});

// Detects: the Node API adapter executing inside Bun can use a narrow managed
// acquisition/cleanup pair and observe POSIX terminal cleanup. Windows Job
// Object qualification remains a native Foundation gate.
void test(
  "Node managed hooks confirm POSIX terminal cleanup",
  { skip: process.platform === "win32" },
  async () => {
    const directory = await mkdtemp(join(resolve("sandbox"), "TEST-process-runtime-node-managed-"));
    let child: ReturnType<typeof spawn> | undefined;
    let cleanupCount = 0;
    let terminalObservations = 0;

    const signalGroup = (target: ReturnType<typeof spawn>, signal: NodeJS.Signals): void => {
      if (target.pid === undefined) {
        return;
      }
      try {
        process.kill(-target.pid, signal);
      } catch (error) {
        if (errorField(error, "code") !== "ESRCH") {
          throw error;
        }
      }
    };
    const managedCleanup: NodeCleanupHook = async (target) => {
      cleanupCount += 1;
      signalGroup(target, "SIGTERM");
      if (await waitForTerminal(target, 1_000)) {
        terminalObservations += 1;
        return;
      }
      signalGroup(target, "SIGKILL");
      if (await waitForTerminal(target, 1_000)) {
        terminalObservations += 1;
        return;
      }
      throw new Error("managed terminal confirmation timed out");
    };
    try {
      const adapter = createNodeProcessAdapter({
        acquire: (request, retain) => {
          child = spawn(request.command, [...request.args], {
            cwd: request.cwd,
            env: request.environment,
            stdio: ["ignore", "pipe", "pipe"],
            detached: true,
            windowsHide: true,
          });
          retain(child);
        },
        cleanup: managedCleanup,
      });
      const controller = new AbortController();
      const cancelled = createProcessExecutor(adapter).run({
        ...launchRequest(directory),
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 25);
      await assert.rejects(cancelled, (error: unknown) => {
        assert.equal(errorField(error, "code"), "cancelled");
        return true;
      });
      assert.ok(child);
      assert.equal(cleanupCount, 1);
      assert.equal(terminalObservations, 1);
      assert.ok(child.exitCode !== null || child.signalCode !== null);
    } finally {
      if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);

function errorField(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? Reflect.get(value, key)
    : undefined;
}

const delayedClose = (delayMs: number): Readable =>
  new Readable({
    read: () => {},
    destroy(error, callback) {
      setTimeout(() => callback(error), delayMs);
    },
  });

const neverClose = (): Readable =>
  new Readable({
    read: () => {},
    destroy: (_error, _callback) => {},
  });

const waitForTerminal = async (
  target: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<boolean> => {
  if (target.exitCode !== null || target.signalCode !== null) {
    return true;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((_resolve) => {
    timer = setTimeout(() => _resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([once(target, "exit").then(() => true), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

void test("Bun runtime rejects invalid explicit path and version and ignores npm bin shadow", async (context) => {
  const { bunRuntime } = await import("../scripts/bun-runtime.js");
  const originalBin = process.env.BUN_BIN;
  const originalPath = process.env.PATH;
  const directory = await mkdtemp(join(resolve("sandbox"), "TEST-bun-resolution-"));
  try {
    process.env.BUN_BIN = join(directory, "missing");
    assert.throws(() => bunRuntime(), /Bun 1.4.3 runtime unavailable/u);
    process.env.BUN_BIN = process.env.NODE_EXECUTABLE ?? process.execPath;
    assert.throws(() => bunRuntime(), /Bun 1.4.3 runtime unavailable/u);
    if (originalBin === undefined) {
      delete process.env.BUN_BIN;
    } else {
      process.env.BUN_BIN = originalBin;
    }
    await context.test("qualified Bun executable shadow is ignored", async (shadowContext) => {
      let qualifiedBun: string;
      try {
        qualifiedBun = bunRuntime();
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.startsWith("Bun 1.4.3 runtime unavailable") ||
          process.versions.node.split(".")[0] !== "24" ||
          process.versions.bun !== undefined ||
          originalBin !== undefined
        ) {
          throw error;
        }
        shadowContext.skip("This runtime-only job does not install a qualified Bun runtime");
        return;
      }
      delete process.env.BUN_BIN;
      const shadowDirectory = join(directory, "node_modules", ".bin");
      await mkdir(shadowDirectory, { recursive: true });
      const shadow = join(shadowDirectory, process.platform === "win32" ? "bun.exe" : "bun");
      await copyFile(qualifiedBun, shadow);
      assert.equal(spawnSync(shadow, ["--version"], { encoding: "utf8" }).stdout.trim(), "1.4.3");
      process.env.PATH = shadowDirectory;
      assert.throws(() => bunRuntime(), /Bun 1.4.3 runtime unavailable/u);
    });
  } finally {
    if (originalBin === undefined) {
      delete process.env.BUN_BIN;
    } else {
      process.env.BUN_BIN = originalBin;
    }
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
