import { jsonRecord, packageIdentity } from "./release-policy.ts";
import { bunRuntime } from "./bun-runtime.ts";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expectedNode = "26.11.1";
const expectedBun = "1.4.3";

if (process.versions.node !== expectedNode) {
  throw new Error(`expected Node ${expectedNode}, received ${process.versions.node}`);
}

const toolchainPackage = packageIdentity(
  JSON.parse(readFileSync(resolve("node_modules/stack-toolchain/package.json"), "utf8")),
);
if (toolchainPackage.name !== "stack-toolchain" || toolchainPackage.version !== "0.1.0") {
  throw new Error("expected exact Stack Toolchain 0.1.0 development dependency");
}

const doctor = spawnSync(
  process.execPath,
  [resolve("node_modules/stack-toolchain/dist/cli.js"), "doctor", "--json"],
  {
    encoding: "utf8",
  },
);
if (doctor.status !== 0) {
  throw new Error(`Stack Toolchain qualification failed: ${doctor.stdout}${doctor.stderr}`);
}

const report = jsonRecord(JSON.parse(doctor.stdout));
if (
  report.status !== "passed" ||
  jsonRecord(jsonRecord(report.details).typescript).available !== true
) {
  throw new Error("Stack Toolchain required compiler is unavailable");
}

const bun = spawnSync(bunRuntime(), ["--version"], { encoding: "utf8" });
if (bun.status !== 0 || (bun.stdout ?? "").trim() !== expectedBun) {
  throw new Error(
    `expected Bun ${expectedBun}, received ${(bun.stdout ?? "").trim() || (bun.stderr ?? bun.error?.message ?? "").trim()}`,
  );
}

process.stdout.write(
  `toolchain verified: Node ${expectedNode}, Stack Toolchain 0.1.0, Bun ${expectedBun}\n`,
);
