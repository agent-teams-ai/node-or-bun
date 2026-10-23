import { spawnSync } from "node:child_process";
import { bunRuntime } from "./bun-runtime.ts";
const result = spawnSync(
  bunRuntime(),
  [
    "test",
    "./dist-tests/tests/conformance.bun.test.js",
    "./dist-tests/tests/native-lifecycle.bun.test.js",
  ],
  { stdio: "inherit" },
);
if (result.error !== undefined) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
