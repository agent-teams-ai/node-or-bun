import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assertCiArtifact, assertRegistryRelease, assertReleaseCi, automaticReleaseDecision, registryVersion, releaseManifest, type CiArtifact, type CiJob, type CiRun } from "../scripts/release-policy.ts";

const source = "a".repeat(40);
const expected = { repository: "agent-teams-ai/process-runtime", source, workflowId: 12 };
const run: CiRun = { id: 34, workflow_id: 12, path: ".github/workflows/ci.yml", head_sha: source,
  run_attempt: 2, run_started_at: "2026-10-20T10:00:00Z",
  head_branch: "main", event: "push", status: "completed", conclusion: "success", repository: { full_name: expected.repository } };
const jobs: CiJob[] = ["node24-compat", "conformance (ubuntu-latest)", "conformance (windows-latest)",
  "conformance (macos-latest)", "package-artifact"].map((name) => ({ name, run_attempt: 2, head_sha: source, status: "completed", conclusion: "success" }));

test("release rejects unrelated, stale, PR, incomplete or partially green CI", () => {
  assert.doesNotThrow(() => assertReleaseCi(run, jobs, expected));
  for (const changed of [{ head_sha: "b".repeat(40) }, { event: "pull_request" }, { head_branch: "feature" },
    { workflow_id: 99 }, { repository: { full_name: "other/repo" } }, { status: "in_progress" }, { conclusion: "failure" }]) {
    assert.throws(() => assertReleaseCi({ ...run, ...changed }, jobs, expected));
  }
  assert.throws(() => assertReleaseCi(run, jobs.slice(1), expected));
  assert.throws(() => assertReleaseCi(run, [...jobs, jobs[0]!], expected));
  assert.throws(() => assertReleaseCi(run, jobs.map((job, index) => index === 0 ? { ...job, conclusion: "skipped" } : job), expected));
  assert.throws(() => assertReleaseCi(run, jobs.map((job, index) => index === 0 ? { ...job, head_sha: "b".repeat(40) } : job), expected));
  assert.throws(() => assertReleaseCi(run, jobs.map((job, index) => index === 0 ? { ...job, run_attempt: 1 } : job), expected));
});

test("release rejects stale attempt artifacts, expired artifacts and wrong-source archives", () => {
  const artifact: CiArtifact = { id: 56, name: "node-or-bun-release-candidate", created_at: "2026-10-20T10:01:00Z",
    expired: false, digest: `sha256:${"a".repeat(64)}`, workflow_run: { id: run.id, head_sha: source, head_branch: "main" } };
  assert.doesNotThrow(() => assertCiArtifact(artifact, run));
  for (const changed of [{ created_at: "2026-10-20T09:59:00Z" }, { created_at: "invalid" }, { expired: true },
    { workflow_run: { ...artifact.workflow_run, head_sha: "b".repeat(40) } }, { workflow_run: { ...artifact.workflow_run, id: 99 } },
    { digest: "sha256:bad" }]) {
    assert.throws(() => assertCiArtifact({ ...artifact, ...changed }, run));
  }
});

test("a queued docs commit still releases its unpublished source version without rolling latest back", () => {
  // The immediate parent may have the same version after the release commit's CI became stale.
  assert.equal(automaticReleaseDecision("0.2.2", null, "0.2.1"), "release");
  assert.equal(automaticReleaseDecision("0.2.2", "0.2.2", "0.2.1"), "release");
  assert.equal(automaticReleaseDecision("0.2.2", "0.2.2", "0.2.2"), "skip");
  assert.equal(automaticReleaseDecision("0.2.2", "0.2.2", null), "release");
  assert.throws(() => automaticReleaseDecision("0.2.2", "0.2.2", "0.2.3"), /roll latest back/);
  assert.throws(() => automaticReleaseDecision("0.2.2", null, "0.3.0"), /roll latest back/);
  assert.throws(() => automaticReleaseDecision("0.2.2", "0.2.1", "0.2.1"));
});

test("registry errors and malformed metadata cannot be interpreted as package absence", () => {
  assert.equal(registryVersion(404, null), null);
  assert.equal(registryVersion(200, { name: "node-or-bun", version: "0.2.2" }), "0.2.2");
  for (const status of [401, 403, 429, 500, 503]) assert.throws(() => registryVersion(status, null));
  assert.throws(() => registryVersion(200, { name: "other", version: "0.2.2" }));
  assert.throws(() => registryVersion(200, { name: "node-or-bun", version: "unexpected" }));
});

test("release manifest binds archive bytes and rejects wrong package or unsafe paths", () => {
  const identity = { repository: expected.repository, source };
  const metadata = { name: "node-or-bun", version: "0.2.1" };
  const bytes = Buffer.from("abc");
  const manifest = releaseManifest(identity, metadata, "node-or-bun-0.2.1.tgz", bytes);
  assert.equal(manifest.packages[0]!.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(manifest.packages[0]!.integrity, "sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==");
  assert.deepEqual(Object.keys(manifest.packages[0]!), ["name", "version", "file", "sha256", "integrity"]);
  for (const file of ["/tmp/node-or-bun-0.2.1.tgz", "../node-or-bun-0.2.1.tgz", "node-or-bun-0.2.0.tgz"]) {
    assert.throws(() => releaseManifest(identity, metadata, file, bytes));
  }
  assert.throws(() => releaseManifest(identity, { ...metadata, name: "@agent-teams-ai/process-runtime" }, "node-or-bun-0.2.1.tgz", bytes));
  assert.throws(() => releaseManifest({ ...identity, source: "main" }, metadata, "node-or-bun-0.2.1.tgz", bytes));
});

test("qualification rejects incomplete, cross-run, cross-source and mismatched original/registry evidence", () => {
  const expected = { repository: "agent-teams-ai/process-runtime", source, runId: "123", name: "node-or-bun", version: "0.2.1", file: "node-or-bun-0.2.1.tgz" };
  const bytes = Buffer.from("original archive");
  const manifest = releaseManifest(expected, expected, expected.file, bytes);
  const receipt = { ...manifest, complete: true, runId: "123", candidateTag: "candidate-run-123" };
  assert.doesNotThrow(() => assertRegistryRelease(expected, manifest, manifest, receipt, bytes, bytes));
  for (const changed of [{ complete: false }, { runId: "124" }, { candidateTag: "candidate-run-124" },
    { source: "b".repeat(40) }, { packages: [] }]) {
    assert.throws(() => assertRegistryRelease(expected, manifest, manifest, { ...receipt, ...changed }, bytes, bytes));
  }
  assert.throws(() => assertRegistryRelease(expected, manifest, { ...manifest, source: "b".repeat(40) }, receipt, bytes, bytes));
  assert.throws(() => assertRegistryRelease(expected, manifest, manifest, receipt, Buffer.from("altered original"), bytes));
  assert.throws(() => assertRegistryRelease(expected, manifest, manifest, receipt, bytes, Buffer.from("altered registry")));
});
