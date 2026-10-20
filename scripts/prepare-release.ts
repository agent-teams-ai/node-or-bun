import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertCiArtifact, assertReleaseCi, automaticReleaseDecision, registryVersion, releaseManifest, type CiArtifact, type CiJob, type CiRun } from "./release-policy.ts";

const repository = process.env.GITHUB_REPOSITORY ?? "";
const source = process.env.GITHUB_SHA ?? "";
const output = process.env.GITHUB_OUTPUT;
if (!output || process.env.GITHUB_REF !== "refs/heads/main"
  || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
  || !/^[a-f0-9]{40}$/.test(source)) {
  throw new Error("Release preparation requires the trusted main Actions context");
}
const api = <T>(path: string): T => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" })) as T;
const metadata = JSON.parse(await readFile("package.json", "utf8")) as { name: string; version: string };
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as {
  workflow_run?: { id: number; head_sha: string };
};
if (process.env.GITHUB_EVENT_NAME === "workflow_run") {
  if (event.workflow_run?.head_sha !== source) throw new Error("Stale CI source is not releasable");
} else if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
  throw new Error("Unsupported release trigger");
}
const workflow = api<{ id: number }>(`repos/${repository}/actions/workflows/ci.yml`);
const runId = event.workflow_run?.id ?? api<{ workflow_runs: CiRun[] }>(
  `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${source}&branch=main&event=push&per_page=1`,
).workflow_runs[0]?.id;
if (!runId) throw new Error("No exact-source main push CI run exists");
const run = api<CiRun>(`repos/${repository}/actions/runs/${runId}`);
const jobs: CiJob[] = [];
for (let page = 1; ; page += 1) {
  const batch = api<{ jobs: CiJob[] }>(`repos/${repository}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`).jobs;
  jobs.push(...batch);
  if (batch.length < 100) break;
}
assertReleaseCi(run, jobs, { repository, source, workflowId: workflow.id });
const attempt = api<CiRun>(`repos/${repository}/actions/runs/${runId}/attempts/${run.run_attempt}`);
assertReleaseCi(attempt, jobs, { repository, source, workflowId: workflow.id });
if (process.env.GITHUB_EVENT_NAME === "workflow_run") {
  if (metadata.name !== "node-or-bun") throw new Error("Unsupported release package");
  const readRegistry = async (selector: string): Promise<string | null> => {
    const response = await fetch(`https://registry.npmjs.org/node-or-bun/${encodeURIComponent(selector)}`, {
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    return registryVersion(response.status, response.status === 200 ? await response.json() : null);
  };
  const [exact, latest] = await Promise.all([readRegistry(metadata.version), readRegistry("latest")]);
  if (automaticReleaseDecision(metadata.version, exact, latest) === "skip") {
    await appendFile(output, "release=false\n");
    process.stdout.write("The source version is already published as latest; automatic release skipped\n");
    process.exit(0);
  }
}
const artifacts: CiArtifact[] = [];
for (let page = 1; ; page += 1) {
  const batch = api<{ artifacts: CiArtifact[] }>(`repos/${repository}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`).artifacts;
  artifacts.push(...batch.filter((artifact) => artifact.name === "node-or-bun-release-candidate"));
  if (batch.length < 100) break;
}
const artifact = artifacts[0];
if (artifacts.length !== 1 || !artifact) throw new Error("CI must retain one unambiguous release artifact");
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
if (archives.length !== 1 || file === undefined) throw new Error("CI must retain exactly one package archive");
const archive = resolve(downloaded, file);
const packed = JSON.parse(execFileSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" })) as { name: string; version: string };
if (packed.name !== metadata.name || packed.version !== metadata.version) throw new Error("CI archive identity differs from source");
const manifest = releaseManifest({ repository, source }, metadata, file, await readFile(archive));
await mkdir(".worker-tmp/release", { recursive: true });
await copyFile(archive, resolve(".worker-tmp/release", file));
await writeFile(".worker-tmp/release/release.json", `${JSON.stringify(manifest, null, 2)}\n`);
const current = api<CiRun>(`repos/${repository}/actions/runs/${runId}`);
assertReleaseCi(current, jobs, { repository, source, workflowId: workflow.id });
process.stdout.write(`Retained CI run ${runId}, attempt ${run.run_attempt}, artifact ${artifact.id}, ${artifact.digest}\n`);
await appendFile(output, `release=true\nci-run=${runId}\narchive=${file}\n`);
