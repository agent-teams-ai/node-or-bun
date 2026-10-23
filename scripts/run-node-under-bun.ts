import { bunRuntime } from "./bun-runtime.ts";
import { spawnSync } from "node:child_process";

const expectedBun = "1.4.3";
if (process.versions.bun !== undefined) {
  throw new Error("run-node-under-bun must launch Bun from a verified Node executable");
}

const bun = bunRuntime();
const version = spawnSync(bun, ["--version"], { encoding: "utf8" });
if (version.status !== 0 || version.stdout.trim() !== expectedBun) {
  throw new Error(
    `expected Bun ${expectedBun}, received ${version.stdout.trim() || version.stderr.trim()}`,
  );
}

const tested = spawnSync(
  bun,
  [
    "test",
    "dist-tests/tests/conformance.node.test.js",
    "dist-tests/tests/native-lifecycle.node.test.js",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, NODE_EXECUTABLE: process.execPath },
  },
);
if (tested.status !== 0) {
  process.exit(tested.status ?? 1);
}
process.stdout.write("Node adapter suites passed inside Bun with an explicit Node executable\n");
