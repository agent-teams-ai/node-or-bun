import { test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcessRuntimeConformance } from "../src/testing/conformance.js";
import { bunConformanceOptions } from "./harness/bun.js";

test("Bun adapter satisfies shared process conformance", async () => {
  const directory = await mkdtemp(join(resolve("sandbox"), "TEST-process-runtime-bun-"));
  try {
    await runProcessRuntimeConformance(bunConformanceOptions(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
