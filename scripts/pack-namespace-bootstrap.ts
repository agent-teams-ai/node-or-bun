import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");
const staging = resolve(packageRoot, ".worker-tmp/bootstrap-namespace-staging");
const destination = resolve(packageRoot, ".worker-tmp/bootstrap-pack");

const manifest = {
  name: "@agent-teams/process-runtime",
  version: "0.0.0-bootstrap.0",
  description: "Unsupported namespace bootstrap package.",
  license: "MIT",
  repository: {
    type: "git",
    url: "git+https://github.com/agent-teams-ai/process-runtime.git",
  },
  publishConfig: { access: "public" },
};
const readme = `# @agent-teams/process-runtime bootstrap

This package is an unsupported namespace bootstrap placeholder. It was never
approved as a supported release and must not be used as a runtime dependency.
`;

await rm(staging, { force: true, recursive: true });
await mkdir(staging, { recursive: true });
await writeFile(
  resolve(staging, "package.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
await writeFile(resolve(staging, "README.md"), readme, "utf8");
await writeFile(resolve(staging, "LICENSE"), await readFile(resolve(packageRoot, "LICENSE")), "utf8");
await writeFile(resolve(staging, ".npmignore"), ".worker-tmp/\n", "utf8");

const env: NodeJS.ProcessEnv = {
  ...process.env,
  PACK_DESTINATION: destination,
};
delete env.NPM_BIN;

const packed = spawnSync(
  process.execPath,
  [resolve(packageRoot, "scripts/pack.ts")],
  { cwd: staging, env, encoding: "utf8", stdio: "inherit" },
);
if (packed.error !== undefined) {
  throw packed.error;
}
if (packed.status !== 0) {
  process.exitCode = packed.status ?? 1;
} else {
  await rm(staging, { force: true, recursive: true });
}
