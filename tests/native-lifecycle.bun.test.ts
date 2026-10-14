import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createProcessExecutor } from "../src/executor.js";
import { createBunProcessAdapter } from "../src/adapters/bun.js";

// Detects: a later Bun capture setup failure must not lose the first retained
// reader or leave its lock held during rollback.
test("Bun adapter closes a partially acquired capture pair", async () => {
  const directory = await mkdtemp(join(resolve("sandbox"), "TEST-process-runtime-bun-partial-"));
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
        const brokenStderr = new ReadableStream<Uint8Array>();
        Object.defineProperty(brokenStderr, "getReader", {
          value: () => {
            throw new Error("second reader setup failed");
          },
        });
        Object.defineProperty(child, "stderr", { value: brokenStderr, configurable: true });
      },
      cleanup: async (target) => {
        target.kill("SIGKILL");
        await target.exited;
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
        assert.equal((error as { code?: string }).code, "launch");
        return true;
      },
    );
    assert.equal(child?.exitCode !== null || child?.signalCode !== null, true);
  } finally {
    if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await rm(directory, { recursive: true, force: true });
  }
});
