import type { createProcessExecutor as Executor } from "../src/executor.js";
import type { createNodeProcessAdapter as Adapter } from "../src/adapters/node.js";
import assert from "node:assert/strict";

const [major, minor] = process.versions.node.split(".").map((value) => Number(value));
assert.equal(major, 24, `Node 24 runtime required, received ${process.versions.node}`);
assert.ok(
  minor !== undefined && minor >= 18,
  `Node 24.18+ required, received ${process.versions.node}`,
);

function isExecutor(value: unknown): value is typeof Executor {
  return typeof value === "function";
}
function isAdapter(value: unknown): value is typeof Adapter {
  return typeof value === "function";
}
const root: unknown = await import(new URL("../dist/index.js", import.meta.url).href);
const node: unknown = await import(new URL("../dist/adapters/node.js", import.meta.url).href);
if (
  typeof root !== "object" ||
  root === null ||
  !("createProcessExecutor" in root) ||
  !isExecutor(root.createProcessExecutor)
) {
  throw new Error("Missing executor export");
}
if (
  typeof node !== "object" ||
  node === null ||
  !("createNodeProcessAdapter" in node) ||
  !isAdapter(node.createNodeProcessAdapter)
) {
  throw new Error("Missing Node adapter export");
}
const result = await root.createProcessExecutor(node.createNodeProcessAdapter()).run({
  command: process.execPath,
  args: ["-e", "process.stdout.write('node24-ok'); process.stderr.write('node24-err')"],
  cwd: process.cwd(),
  environment: { PROCESS_RUNTIME_NODE24: "1" },
});
assert.equal(result.exitCode, 0);
assert.equal(result.signal, null);
assert.equal(result.stdout, "node24-ok");
assert.equal(result.stderr, "node24-err");
process.stdout.write(`Node ${process.versions.node} import and process behavior verified\n`);
