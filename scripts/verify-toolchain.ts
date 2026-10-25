import { assertToolchainDoctor, developmentToolchain } from "./toolchain-policy.ts";
import { bunRuntime } from "./bun-runtime.ts";
import { spawnSync } from "node:child_process";

const expectedNode = "26.11.1";
const expectedBun = "1.4.3";

if (process.versions.node !== expectedNode) {
  throw new Error(`expected Node ${expectedNode}, received ${process.versions.node}`);
}

// The root development manifest owns the release; public Stack metadata/doctor bind it.
const toolchain = developmentToolchain(process.cwd());

const doctor = spawnSync(process.execPath, [toolchain.cli, "doctor", "--json"], {
  encoding: "utf8",
});
if (doctor.status !== 0) {
  throw new Error(`Stack Toolchain qualification failed: ${doctor.stdout}${doctor.stderr}`);
}

assertToolchainDoctor(JSON.parse(doctor.stdout), toolchain);

const bun = spawnSync(bunRuntime(), ["--version"], { encoding: "utf8" });
if (bun.status !== 0 || (bun.stdout ?? "").trim() !== expectedBun) {
  throw new Error(
    `expected Bun ${expectedBun}, received ${(bun.stdout ?? "").trim() || (bun.stderr ?? bun.error?.message ?? "").trim()}`,
  );
}

process.stdout.write(
  `toolchain verified: Node ${expectedNode}, Stack Toolchain ${toolchain.version}, Bun ${expectedBun}\n`,
);
