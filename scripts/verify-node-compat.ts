import assert from "node:assert/strict";
import type { createProcessExecutor as CreateProcessExecutor } from "../src/executor.js";
import type { createNodeProcessAdapter as CreateNodeProcessAdapter } from "../src/adapters/node.js";

type RootModule = { readonly createProcessExecutor: typeof CreateProcessExecutor };
type NodeModule = { readonly createNodeProcessAdapter: typeof CreateNodeProcessAdapter };

const [major, minor] = process.versions.node.split(".").map((value) => Number(value));
assert.equal(major, 24, `Node 24 runtime required, received ${process.versions.node}`);
assert.ok(minor !== undefined && minor >= 18, `Node 24.18+ required, received ${process.versions.node}`);

const root = (await import(new URL("../dist/index.js", import.meta.url).href)) as RootModule;
const node = (await import(new URL("../dist/adapters/node.js", import.meta.url).href)) as NodeModule;
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
