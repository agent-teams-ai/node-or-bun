import { resolve } from "node:path";
import type {
  ConformanceAdapterFactory,
  ConformanceOptions,
} from "../../src/testing/conformance.js";
import { createBunProcessAdapter, type BunCleanupHook } from "../../src/adapters/bun.js";

const killAndAwait: BunCleanupHook = async (child) => {
  child.kill("SIGKILL");
  await child.exited;
};

export const createBunAdapterFactory: ConformanceAdapterFactory = (mode) => {
  if (mode === "normal") {
    return createBunProcessAdapter();
  }
  if (mode === "partial-hooks") {
    return createBunProcessAdapter({
      acquire: () => {},
    });
  }
  if (mode === "pre-retain-failure") {
    return createBunProcessAdapter({
      acquire: () => {
        throw new Error("before retain");
      },
      cleanup: async () => {},
    });
  }
  return createBunProcessAdapter({
    acquire: (request, retain) => {
      const child = Bun.spawn([request.command, ...request.args], {
        cwd: request.cwd,
        ...(request.environment === undefined ? {} : { env: { ...request.environment } }),
        stdio: ["ignore", "pipe", "pipe"],
      });
      retain(child);
      if (mode === "setup-failure" || mode === "setup-cleanup-failure") {
        throw new Error("observer setup");
      }
    },
    cleanup:
      mode === "cleanup-failure"
        ? async (child) => {
            await killAndAwait(child, "failed");
            throw new Error("cleanup failed");
          }
        : mode === "setup-cleanup-failure"
          ? async (child) => {
              await killAndAwait(child, "failed");
              throw new Error("setup cleanup failed");
            }
          : killAndAwait,
  });
};

export const bunConformanceOptions = (workingDirectory: string): ConformanceOptions => ({
  adapterFactory: createBunAdapterFactory,
  command: process.execPath,
  fixturePath: resolve("tests/fixtures/process-fixture.ts"),
  workingDirectory,
  supportsSignalExit: process.platform !== "win32",
});
