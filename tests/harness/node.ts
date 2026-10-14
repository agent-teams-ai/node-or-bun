import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { ConformanceAdapterFactory, ConformanceOptions } from "../../src/testing/conformance.js";
import { createNodeProcessAdapter, type NodeCleanupHook } from "../../src/adapters/node.js";

const killAndAwait: NodeCleanupHook = async (child) => {
  child.kill("SIGKILL");
  await new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
};

export const createNodeAdapterFactory: ConformanceAdapterFactory = (mode) => {
  if (mode === "normal") return createNodeProcessAdapter();
  if (mode === "partial-hooks") {
    return createNodeProcessAdapter({
      acquire: () => undefined,
    });
  }
  if (mode === "pre-retain-failure") {
    return createNodeProcessAdapter({
      acquire: () => {
        throw new Error("before retain");
      },
      cleanup: async () => undefined,
    });
  }
  return createNodeProcessAdapter({
    acquire: (request, retain) => {
      const child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: request.environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
      retain(child);
      if (mode === "setup-failure") throw new Error("observer setup");
    },
    cleanup: mode === "cleanup-failure"
      ? async (child) => {
          await killAndAwait(child, "failed");
          throw new Error("cleanup failed");
        }
      : killAndAwait,
  });
};

export const nodeConformanceOptions = (workingDirectory: string): ConformanceOptions => ({
  adapterFactory: createNodeAdapterFactory,
  command: process.execPath,
  fixturePath: resolve("tests/fixtures/process-fixture.ts"),
  workingDirectory,
  supportsSignalExit: process.platform !== "win32",
});
