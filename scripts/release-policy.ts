import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export interface CiRun {
  id: number;
  workflow_id: number;
  run_attempt: number;
  run_started_at: string;
  path: string;
  head_sha: string;
  head_branch: string;
  event: string;
  status: string;
  conclusion: string | null;
  repository: { full_name: string };
}

export interface CiJob {
  name: string;
  run_attempt: number;
  status: string;
  conclusion: string | null;
  head_sha: string;
}

export interface CiArtifact {
  id: number;
  name: string;
  created_at: string;
  expired: boolean;
  digest: string;
  workflow_run: { id: number; head_sha: string; head_branch: string };
}

// This is the complete product CI roster, including every supported OS.
const requiredJobs = [
  "node24-compat",
  "conformance (ubuntu-latest)",
  "conformance (windows-latest)",
  "conformance (macos-latest)",
  "package-artifact",
] as const;

export function assertReleaseCi(
  run: CiRun,
  jobs: readonly CiJob[],
  expected: { repository: string; source: string; workflowId: number },
): void {
  if (!/^[a-f0-9]{40}$/.test(expected.source)
    || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1
    || run.repository.full_name !== expected.repository
    || run.workflow_id !== expected.workflowId
    || run.path !== ".github/workflows/ci.yml"
    || run.head_sha !== expected.source
    || run.head_branch !== "main"
    || run.event !== "push"
    || run.status !== "completed"
    || run.conclusion !== "success") {
    throw new Error("Release requires successful exact-source main push CI");
  }
  for (const name of requiredJobs) {
    const matches = jobs.filter((job) => job.name === name);
    if (matches.length !== 1 || matches[0]?.status !== "completed"
      || matches[0]?.conclusion !== "success" || matches[0]?.head_sha !== expected.source) {
      throw new Error(`Missing successful exact-source CI job: ${name}`);
    }
  }
  if (jobs.some((job) => job.run_attempt !== run.run_attempt || job.head_sha !== expected.source
    || job.status !== "completed" || job.conclusion !== "success")) {
    throw new Error("Every job in the release CI run must succeed");
  }
}

export function assertCiArtifact(artifact: CiArtifact, run: CiRun): void {
  const created = Date.parse(artifact.created_at);
  const started = Date.parse(run.run_started_at);
  if (!Number.isSafeInteger(artifact.id) || artifact.id < 1
    || artifact.name !== "node-or-bun-release-candidate" || artifact.expired
    || artifact.workflow_run.id !== run.id || artifact.workflow_run.head_sha !== run.head_sha
    || artifact.workflow_run.head_branch !== "main"
    || !Number.isFinite(created) || !Number.isFinite(started) || created < started
    || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest)) {
    throw new Error("Release artifact must belong to the successful exact-source CI attempt");
  }
}

function stableVersion(version: string): bigint[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("Automatic releases require a stable package version");
  }
  return version.split(".").map(BigInt);
}

export function registryVersion(status: number, body: unknown): string | null {
  if (status === 404) return null;
  if (status !== 200 || body === null || typeof body !== "object"
    || !("name" in body) || body.name !== "node-or-bun"
    || !("version" in body) || typeof body.version !== "string") {
    throw new Error(`Unable to establish npm package state (HTTP ${status})`);
  }
  stableVersion(body.version);
  return body.version;
}

export function automaticReleaseDecision(desired: string, exact: string | null, latest: string | null): "release" | "skip" {
  const desiredParts = stableVersion(desired);
  if (exact !== null && exact !== desired) throw new Error("npm exact version differs from the requested version");
  if (latest !== null) {
    const latestParts = stableVersion(latest);
    for (let index = 0; index < 3; index += 1) {
      if (latestParts[index]! > desiredParts[index]!) throw new Error("Automatic release refuses to roll latest back");
      if (latestParts[index]! < desiredParts[index]!) return "release";
    }
  }
  return exact === desired && latest === desired ? "skip" : "release";
}

export function releaseManifest(
  identity: { repository: string; source: string },
  metadata: { name: string; version: string },
  file: string,
  bytes: Uint8Array,
) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(identity.repository)
    || !/^[a-f0-9]{40}$/.test(identity.source)
    || metadata.name !== "node-or-bun"
    || !/^\d+\.\d+\.\d+$/.test(metadata.version)
    || file !== `node-or-bun-${metadata.version}.tgz`
    || bytes.length === 0) {
    throw new Error("Invalid node-or-bun release manifest input");
  }
  return {
    schemaVersion: 1,
    repository: identity.repository,
    source: identity.source,
    packages: [{
      name: metadata.name,
      version: metadata.version,
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    }],
  };
}

export function assertRegistryRelease(
  expected: { repository: string; source: string; runId: string; name: string; version: string; file: string },
  original: unknown,
  registry: unknown,
  receipt: unknown,
  originalBytes: Uint8Array,
  registryBytes: Uint8Array,
): void {
  const manifest = releaseManifest(expected, expected, expected.file, originalBytes);
  if (!/^[1-9]\d*$/.test(expected.runId)
    || !isDeepStrictEqual(original, manifest) || !isDeepStrictEqual(registry, manifest)
    || !isDeepStrictEqual(receipt, { ...manifest, complete: true, runId: expected.runId,
      candidateTag: `candidate-run-${expected.runId}` })
    || !Buffer.from(originalBytes).equals(Buffer.from(registryBytes))) {
    throw new Error("Registry archive and complete receipt must match the original source and release run");
  }
}
