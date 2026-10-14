import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createBunProcessAdapter } from "../src/adapters/bun.js";
import { createProcessExecutor } from "../src/executor.js";

// Detects: normal EOF must release both retained Bun reader locks.
test("Bun adapter releases native readers after normal EOF", async () => {
  const directory = await mkdtemp(join(resolve("sandbox"), "TEST-process-runtime-bun-eof-"));
  let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    const adapter = createBunProcessAdapter({
      acquire: (request, retain) => {
        child = Bun.spawn([request.command, ...request.args], {
          cwd: request.cwd,
          env: { ...request.environment },
          stdio: ["ignore", "pipe", "pipe"],
        });
        retain(child);
      },
      cleanup: async (target, cause) => {
        if (cause !== "exited") target.kill("SIGKILL");
      },
    });
    const result = await createProcessExecutor(adapter).run({
      command: process.execPath,
      args: ["-e", "process.stdout.write('eof'); process.stderr.write('err')"],
      cwd: directory,
      environment: {},
    });
    assert.equal(result.stdout, "eof");
    assert.equal(result.stderr, "err");
    assert.ok(child);
    assert.equal(child.stdout.locked, false);
    assert.equal(child.stderr.locked, false);
  } finally {
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await rm(directory, { recursive: true, force: true });
  }
});

// Detects: a later injected reader setup fault must retain the exact child and
// first reader, release that reader, attempt both capture owners, confirm
// physical terminal cleanup, and finish within the native-close budget.
test(
  "Bun rollback bounds a partially acquired capture pair",
  { timeout: 2_500 },
  async () => {
    const directory = await mkdtemp(join(resolve("sandbox"), "TEST-process-runtime-bun-partial-"));
    let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
    let retainCount = 0;
    let cleanupCount = 0;
    let terminalObservations = 0;
    let firstReaderCreated = false;
    let firstReaderReleased = false;
    let firstReaderCancelRequested = false;
    let secondReaderAttempts = 0;
    let secondStreamCancelRequested = false;
    const injectedFault = new Error("second reader setup failed");
    const pendingReader = {
      read: () => new Promise<never>(() => undefined),
      cancel: () => {
        firstReaderCancelRequested = true;
        return new Promise<never>(() => undefined);
      },
      releaseLock: () => {
        firstReaderReleased = true;
      },
    };
    const firstCapture = new ReadableStream<Uint8Array>();
    Object.defineProperty(firstCapture, "getReader", {
      value: () => {
        firstReaderCreated = true;
        return pendingReader;
      },
    });
    const brokenSecondCapture = new ReadableStream<Uint8Array>();
    Object.defineProperty(brokenSecondCapture, "getReader", {
      value: () => {
        secondReaderAttempts += 1;
        throw injectedFault;
      },
    });
    Object.defineProperty(brokenSecondCapture, "cancel", {
      value: () => {
        secondStreamCancelRequested = true;
        return Promise.resolve();
      },
    });

    try {
      const adapter = createBunProcessAdapter({
        acquire: (request, retain) => {
          child = Bun.spawn([request.command, ...request.args], {
            cwd: request.cwd,
            env: { ...request.environment },
            stdio: ["ignore", "pipe", "pipe"],
          });
          retainCount += 1;
          retain(child);
          Object.defineProperty(child, "stdout", { value: firstCapture, configurable: true });
          Object.defineProperty(child, "stderr", { value: brokenSecondCapture, configurable: true });
        },
        cleanup: async (target) => {
          cleanupCount += 1;
          target.kill("SIGKILL");
          await target.exited;
          terminalObservations += 1;
        },
      });
      await assert.rejects(
        createProcessExecutor(adapter).run({
          command: process.execPath,
          args: ["-e", "setTimeout(() => {}, 1000)"],
          cwd: directory,
          environment: {},
        }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "cleanup");
          assert.equal((error as { incompleteCustody?: boolean }).incompleteCustody, true);
          assert.equal((error as { initiatingError?: unknown }).initiatingError, injectedFault);
          const closeCause = (error as { cause?: { code?: string; message?: string } }).cause;
          assert.equal(closeCause?.code, "cleanup");
          assert.match(closeCause?.message ?? "", /timed out/);
          return true;
        },
      );
      assert.ok(child, "injected second-reader fault lost the retained child");
      assert.equal(retainCount, 1);
      assert.equal(firstReaderCreated, true);
      assert.equal(secondReaderAttempts, 1);
      assert.equal(firstReaderCancelRequested, true);
      assert.equal(firstReaderReleased, true);
      assert.equal(secondStreamCancelRequested, true);
      assert.equal(cleanupCount, 1);
      assert.equal(terminalObservations, 1);
      assert.ok(child.exitCode !== null || child.signalCode !== null);
      await child.exited;
    } finally {
      if (child !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
