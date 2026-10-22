import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import {
  jsonNumber,
  ciRun,
  ciJobs,
  ciArtifacts,
  jsonRecord,
  packageIdentity,
  assertCiArtifact,
  assertReleaseCi,
  automaticReleaseDecision,
  registryVersion,
  releaseManifest,
  type CiArtifact,
  type CiJob,
} from "./release-policy.ts";

const repository = process.env.GITHUB_REPOSITORY ?? "";
const source = process.env.GITHUB_SHA ?? "";
const output = process.env.GITHUB_OUTPUT;
if (
  !output ||
  process.env.GITHUB_REF !== "refs/heads/main" ||
  !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
  !/^[a-f0-9]{40}$/.test(source)
) {
  throw new Error("Release preparation requires the trusted main Actions context");
}
const api = (path: string): unknown =>
  JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" }));
const metadata = packageIdentity(JSON.parse(await readFile("package.json", "utf8")));
const event = jsonRecord(JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH ?? "", "utf8")));
const workflowRun = event.workflow_run === undefined ? undefined : jsonRecord(event.workflow_run);
if (process.env.GITHUB_EVENT_NAME === "workflow_run") {
  if (workflowRun?.head_sha !== source) {
    throw new Error("Stale CI source is not releasable");
  }
} else if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
  throw new Error("Unsupported release trigger");
}
const workflow = jsonRecord(api(`repos/${repository}/actions/workflows/ci.yml`));
const runId =
  workflowRun?.id ??
  jsonRecord(
    api(
      `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${source}&branch=main&event=push&per_page=1`,
    ),
  ).workflow_runs;
const selected = Array.isArray(runId) ? ciRun(runId[0]).id : runId;
if (typeof selected !== "number") {
  throw new Error("No exact-source main push CI run exists");
}
const run = ciRun(api(`repos/${repository}/actions/runs/${selected}`));
const jobs: CiJob[] = [];
for (let page = 1; ; page += 1) {
  const batch = jsonRecord(
    api(
      `repos/${repository}/actions/runs/${selected}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`,
    ),
  ).jobs;
  jobs.push(...ciJobs(batch));
  if (ciJobs(batch).length < 100) {
    break;
  }
}
assertReleaseCi(run, jobs, { repository, source, workflowId: jsonNumber(workflow.id) });
const attempt = ciRun(
  api(`repos/${repository}/actions/runs/${selected}/attempts/${run.run_attempt}`),
);
assertReleaseCi(attempt, jobs, { repository, source, workflowId: jsonNumber(workflow.id) });
if (process.env.GITHUB_EVENT_NAME === "workflow_run") {
  if (metadata.name !== "node-or-bun") {
    throw new Error("Unsupported release package");
  }
  const [exact, latest] = await Promise.all([
    readRegistry(metadata.version),
    readRegistry("latest"),
  ]);
  if (automaticReleaseDecision(metadata.version, exact, latest) === "skip") {
    await appendFile(output, "release=false\n");
    process.stdout.write(
      "The source version is already published as latest; automatic release skipped\n",
    );
    process.exit(0);
  }
}
const artifacts: CiArtifact[] = [];
for (let page = 1; ; page += 1) {
  const batch = jsonRecord(
    api(`repos/${repository}/actions/runs/${selected}/artifacts?per_page=100&page=${page}`),
  ).artifacts;
  artifacts.push(
    ...ciArtifacts(batch).filter((artifact) => artifact.name === "node-or-bun-release-candidate"),
  );
  if (ciArtifacts(batch).length < 100) {
    break;
  }
}
const artifact = artifacts[0];
if (artifacts.length !== 1 || !artifact) {
  throw new Error("CI must retain one unambiguous release artifact");
}
assertCiArtifact(artifact, attempt);
await mkdir(".worker-tmp", { recursive: true });
const downloaded = await mkdtemp(resolve(".worker-tmp/ci-release-"));
const zip = execFileSync("gh", ["api", `repos/${repository}/actions/artifacts/${artifact.id}/zip`]);
if (`sha256:${createHash("sha256").update(zip).digest("hex")}` !== artifact.digest) {
  throw new Error("Downloaded CI artifact digest differs from the selected artifact ID");
}
await writeFile(`${downloaded}.zip`, zip);
execFileSync("unzip", ["-q", `${downloaded}.zip`, "-d", downloaded]);
const archives = (await readdir(downloaded)).filter((file) => file.endsWith(".tgz"));
const file = archives[0];
if (archives.length !== 1 || file === undefined) {
  throw new Error("CI must retain exactly one package archive");
}
const archive = resolve(downloaded, file);
const packed = packageIdentity(
  JSON.parse(execFileSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" })),
);
if (packed.name !== metadata.name || packed.version !== metadata.version) {
  throw new Error("CI archive identity differs from source");
}
const manifest = releaseManifest({ repository, source }, metadata, file, await readFile(archive));
await mkdir(".worker-tmp/release", { recursive: true });
await copyFile(archive, resolve(".worker-tmp/release", file));
await writeFile(".worker-tmp/release/release.json", `${JSON.stringify(manifest, null, 2)}\n`);
const current = ciRun(api(`repos/${repository}/actions/runs/${selected}`));
assertReleaseCi(current, jobs, { repository, source, workflowId: jsonNumber(workflow.id) });
process.stdout.write(
  `Retained CI run ${selected}, attempt ${run.run_attempt}, artifact ${artifact.id}, ${artifact.digest}\n`,
);
await appendFile(output, `release=true\nci-run=${selected}\narchive=${file}\n`);

async function readRegistry(selector: string): Promise<string | null> {
  const response = await fetch(
    `https://registry.npmjs.org/node-or-bun/${encodeURIComponent(selector)}`,
    {
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    },
  );
  return registryVersion(response.status, response.status === 200 ? await response.json() : null);
}
