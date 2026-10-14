import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createProcessExecutor } from "../src/executor.js";
import { createNodeProcessAdapter } from "../src/adapters/node.js";

// Detects: normal EOF must settle and release both native Node readers.
test("Node adapter releases native readers after normal EOF", async () => {
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
    assert.equal(child?.stdout?.readableEnded, true);
    assert.equal(child?.stderr?.readableEnded, true);
  } finally {
    if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await rm(directory, { recursive: true, force: true });
  }
});
