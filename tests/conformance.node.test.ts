import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runProcessRuntimeConformance } from "../src/testing/conformance.js";
import { nodeConformanceOptions } from "./harness/node.js";

test("Node adapter satisfies shared process conformance", async () => {
  const directory = await mkdtemp(join(resolve("sandbox"), "TEST-process-runtime-node-"));
  try {
    await runProcessRuntimeConformance(nodeConformanceOptions(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
