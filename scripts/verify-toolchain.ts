import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const expectedNode = "26.11.1";
const expectedTypeScript = "7.0.2";
const expectedBun = "1.4.3";

if (process.versions.node !== expectedNode) {
  throw new Error(`expected Node ${expectedNode}, received ${process.versions.node}`);
}

const tsc = spawnSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "--version"], {
  encoding: "utf8",
});
if (tsc.status !== 0 || tsc.stdout.trim() !== `Version ${expectedTypeScript}`) {
  throw new Error(`expected TypeScript ${expectedTypeScript}, received ${tsc.stdout.trim() || tsc.stderr.trim()}`);
}

const bun = spawnSync(process.env.BUN_BIN ?? "bun", ["--version"], { encoding: "utf8" });
if (bun.status !== 0 || bun.stdout.trim() !== expectedBun) {
  throw new Error(`expected Bun ${expectedBun}, received ${bun.stdout.trim() || bun.stderr.trim()}`);
}

process.stdout.write(`toolchain verified: Node ${expectedNode}, TypeScript ${expectedTypeScript}, Bun ${expectedBun}\n`);
