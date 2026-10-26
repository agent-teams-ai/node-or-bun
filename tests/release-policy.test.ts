import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertToolchainDoctor, developmentToolchain } from "../scripts/toolchain-policy.ts";
import {
  assertCiArtifact,
  assertRegistryRelease,
  assertReleaseCi,
  automaticReleaseDecision,
  registryVersion,
  jsonRecord,
  releaseManifest,
  type CiArtifact,
  type CiJob,
  type CiRun,
} from "../scripts/release-policy.ts";

const source = "a".repeat(40);
const expected = { repository: "agent-teams-ai/process-runtime", source, workflowId: 12 };
const run: CiRun = {
  id: 34,
  workflow_id: 12,
  path: ".github/workflows/ci.yml",
  head_sha: source,
  run_attempt: 2,
  run_started_at: "2026-10-20T10:00:00Z",
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
  repository: { full_name: expected.repository },
};
const jobs: CiJob[] = [
  "node24-compat",
  "conformance (ubuntu-latest)",
  "conformance (windows-latest)",
  "conformance (macos-latest)",
  "package-artifact",
].map((name) => ({
  name,
  run_attempt: 2,
  head_sha: source,
  status: "completed",
  conclusion: "success",
}));

void test("release rejects unrelated, stale, PR, incomplete or partially green CI", () => {
  assert.doesNotThrow(() => assertReleaseCi(run, jobs, expected));
  for (const changed of [
    { head_sha: "b".repeat(40) },
    { event: "pull_request" },
    { head_branch: "feature" },
    { workflow_id: 99 },
    { repository: { full_name: "other/repo" } },
    { status: "in_progress" },
    { conclusion: "failure" },
  ]) {
    assert.throws(() => assertReleaseCi({ ...run, ...changed }, jobs, expected));
  }
  assert.throws(() => assertReleaseCi(run, jobs.slice(1), expected));
  assert.throws(() => assertReleaseCi(run, [...jobs, jobs[0]!], expected));
  assert.throws(() =>
    assertReleaseCi(
      run,
      jobs.map((job, index) => (index === 0 ? { ...job, conclusion: "skipped" } : job)),
      expected,
    ),
  );
  assert.throws(() =>
    assertReleaseCi(
      run,
      jobs.map((job, index) => (index === 0 ? { ...job, head_sha: "b".repeat(40) } : job)),
      expected,
    ),
  );
  assert.throws(() =>
    assertReleaseCi(
      run,
      jobs.map((job, index) => (index === 0 ? { ...job, run_attempt: 1 } : job)),
      expected,
    ),
  );
});

void test("release rejects stale attempt artifacts, expired artifacts and wrong-source archives", () => {
  const artifact: CiArtifact = {
    id: 56,
    name: "node-or-bun-release-candidate",
    created_at: "2026-10-20T10:01:00Z",
    expired: false,
    digest: `sha256:${"a".repeat(64)}`,
    workflow_run: { id: run.id, head_sha: source, head_branch: "main" },
  };
  assert.doesNotThrow(() => assertCiArtifact(artifact, run));
  for (const changed of [
    { created_at: "2026-10-20T09:59:00Z" },
    { created_at: "invalid" },
    { expired: true },
    { workflow_run: { ...artifact.workflow_run, head_sha: "b".repeat(40) } },
    { workflow_run: { ...artifact.workflow_run, id: 99 } },
    { digest: "sha256:bad" },
  ]) {
    assert.throws(() => assertCiArtifact({ ...artifact, ...changed }, run));
  }
});

void test("a queued docs commit still releases its unpublished source version without rolling latest back", () => {
  // The immediate parent may have the same version after the release commit's CI became stale.
  assert.equal(automaticReleaseDecision("0.2.2", null, "0.2.1"), "release");
  assert.equal(automaticReleaseDecision("0.2.2", "0.2.2", "0.2.1"), "release");
  assert.equal(automaticReleaseDecision("0.2.2", "0.2.2", "0.2.2"), "skip");
  assert.equal(automaticReleaseDecision("0.2.2", "0.2.2", null), "release");
  assert.throws(() => automaticReleaseDecision("0.2.2", "0.2.2", "0.2.3"), /roll latest back/);
  assert.throws(() => automaticReleaseDecision("0.2.2", null, "0.3.0"), /roll latest back/);
  assert.throws(() => automaticReleaseDecision("0.2.2", "0.2.1", "0.2.1"));
});

void test("registry errors and malformed metadata cannot be interpreted as package absence", () => {
  assert.equal(registryVersion(404, null), null);
  assert.equal(registryVersion(200, { name: "node-or-bun", version: "0.2.2" }), "0.2.2");
  for (const status of [401, 403, 429, 500, 503]) {
    assert.throws(() => registryVersion(status, null));
  }
  assert.throws(() => registryVersion(200, { name: "other", version: "0.2.2" }));
  assert.throws(() => registryVersion(200, { name: "node-or-bun", version: "unexpected" }));
});

void test("release manifest binds archive bytes and rejects wrong package or unsafe paths", () => {
  const identity = { repository: expected.repository, source };
  const metadata = { name: "node-or-bun", version: "0.2.1" };
  const bytes = Buffer.from("abc");
  const manifest = releaseManifest(identity, metadata, "node-or-bun-0.2.1.tgz", bytes);
  assert.equal(
    manifest.packages[0]!.sha256,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    manifest.packages[0]!.integrity,
    "sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==",
  );
  assert.deepEqual(Object.keys(manifest.packages[0]!), [
    "name",
    "version",
    "file",
    "sha256",
    "integrity",
  ]);
  for (const file of [
    "/tmp/node-or-bun-0.2.1.tgz",
    "../node-or-bun-0.2.1.tgz",
    "node-or-bun-0.2.0.tgz",
  ]) {
    assert.throws(() => releaseManifest(identity, metadata, file, bytes));
  }
  assert.throws(() =>
    releaseManifest(
      identity,
      { ...metadata, name: "@agent-teams-ai/process-runtime" },
      "node-or-bun-0.2.1.tgz",
      bytes,
    ),
  );
  assert.throws(() =>
    releaseManifest({ ...identity, source: "main" }, metadata, "node-or-bun-0.2.1.tgz", bytes),
  );
});

void test("qualification rejects incomplete, cross-run, cross-source and mismatched original/registry evidence", () => {
  const qualification = {
    repository: "agent-teams-ai/process-runtime",
    source,
    runId: "123",
    name: "node-or-bun",
    version: "0.2.1",
    file: "node-or-bun-0.2.1.tgz",
  };
  const bytes = Buffer.from("original archive");
  const manifest = releaseManifest(qualification, qualification, qualification.file, bytes);
  const receipt = { ...manifest, complete: true, runId: "123", candidateTag: "candidate-run-123" };
  assert.doesNotThrow(() =>
    assertRegistryRelease(qualification, manifest, manifest, receipt, bytes, bytes),
  );
  for (const changed of [
    { complete: false },
    { runId: "124" },
    { candidateTag: "candidate-run-124" },
    { source: "b".repeat(40) },
    { packages: [] },
  ]) {
    assert.throws(() =>
      assertRegistryRelease(
        qualification,
        manifest,
        manifest,
        { ...receipt, ...changed },
        bytes,
        bytes,
      ),
    );
  }
  assert.throws(() =>
    assertRegistryRelease(
      qualification,
      manifest,
      { ...manifest, source: "b".repeat(40) },
      receipt,
      bytes,
      bytes,
    ),
  );
  assert.throws(() =>
    assertRegistryRelease(
      qualification,
      manifest,
      manifest,
      receipt,
      Buffer.from("altered original"),
      bytes,
    ),
  );
  assert.throws(() =>
    assertRegistryRelease(
      qualification,
      manifest,
      manifest,
      receipt,
      bytes,
      Buffer.from("altered registry"),
    ),
  );
});

void test("release decoders reject malformed external JSON before policy evaluation", async () => {
  const { ciRun, ciJobs, ciArtifacts, packageIdentity } =
    await import("../scripts/release-policy.ts");
  assert.throws(() => packageIdentity({ name: "node-or-bun", version: 1 }));
  assert.throws(() => ciRun({ id: "123" }));
  assert.throws(() => ciJobs({ jobs: [] }));
  assert.throws(() => ciArtifacts([{ id: 1, workflow_run: null }]));
});

void test("npm pack receipt requires one archive record and a safe filename", async () => {
  const { packedFilename } = await import("../scripts/release-policy.ts");
  assert.equal(packedFilename([{ filename: "node-or-bun-0.2.3.tgz" }]), "node-or-bun-0.2.3.tgz");
  for (const invalid of [
    { filename: "package.tgz" },
    [],
    [{ filename: "a.tgz" }, { filename: "b.tgz" }],
    [{ filename: "../outside.tgz" }],
  ]) {
    assert.throws(() => packedFilename(invalid));
  }
});

const toolPins = {
  schemaVersion: 1,
  typescript: "7.0.2",
  oxlint: "1.83.0",
  "oxlint-tsgolint": "7.0.2001",
  oxfmt: "0.74.0",
};
function writeJson(filename: string, value: unknown): void {
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, JSON.stringify(value));
}
function toolchainFixture(
  action: (root: string, packageRoot: string, parent: string) => void,
): void {
  const parent = mkdtempSync(join(tmpdir(), "node-or-bun-toolchain-"));
  const root = join(parent, "consumer");
  const packageRoot = join(root, "node_modules/stack-toolchain");
  try {
    writeJson(join(root, "package.json"), { devDependencies: { "stack-toolchain": "0.1.0" } });
    writeJson(join(packageRoot, "package.json"), {
      name: "stack-toolchain",
      version: "0.1.0",
      exports: {
        "./package.json": "./package.json",
        "./toolchain-manifest.json": "./toolchain-manifest.json",
      },
      bin: { "stack-toolchain": "cli.js" },
    });
    writeJson(join(packageRoot, "toolchain-manifest.json"), toolPins);
    writeFileSync(join(packageRoot, "cli.js"), "// metadata fixture; never executed\n");
    action(root, packageRoot, parent);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}
function doctorReport(version: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    command: "doctor",
    status: "passed",
    exitCode: 0,
    details: {
      schemaVersion: 1,
      packageVersion: version,
      findings: [],
      ...Object.fromEntries(
        Object.entries(toolPins)
          .filter(([key]) => key !== "schemaVersion")
          .map(([key, pin]) => [
            key,
            { available: true, expectedVersion: pin, installedVersion: pin, resolvedVersion: pin },
          ]),
      ),
    },
  };
}

void test("development Stack follows a matching exact root pin without qualifying a future engine", () => {
  toolchainFixture((root, packageRoot) => {
    for (const version of ["0.1.0", "0.2.0"]) {
      writeJson(join(root, "package.json"), { devDependencies: { "stack-toolchain": version } });
      const metadata = jsonRecord(
        JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")),
      );
      writeJson(join(packageRoot, "package.json"), { ...metadata, version });
      const toolchain = developmentToolchain(root);
      assert.equal(toolchain.version, version);
      // Pure metadata/doctor-shape fixture: no CLI or hypothetical engine executes.
      assert.doesNotThrow(() => assertToolchainDoctor(doctorReport(version), toolchain));
    }
  });
});

void test("development Stack rejects noncanonical, duplicate and mismatched declarations", () => {
  toolchainFixture((root, packageRoot) => {
    for (const pin of [
      undefined,
      "^0.1.0",
      "latest",
      "npm:stack-toolchain@0.1.0",
      "file:../stack",
      "git+https://example.invalid/stack.git",
      "workspace:*",
      "0.1.0-rc.1",
      "01.1.0",
      "0.1.0+build",
    ]) {
      writeJson(join(root, "package.json"), { devDependencies: { "stack-toolchain": pin } });
      assert.throws(() => developmentToolchain(root), /canonical stable exact/);
    }
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      writeJson(join(root, "package.json"), {
        devDependencies: { "stack-toolchain": "0.1.0" },
        [section]: { "stack-toolchain": "0.1.0" },
      });
      assert.throws(() => developmentToolchain(root), /canonical stable exact/);
    }
    writeJson(join(root, "package.json"), { devDependencies: { "stack-toolchain": "0.1.0" } });
    const metadata = jsonRecord(
      JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")),
    );
    for (const changed of [{ name: "other" }, { version: "0.0.9" }]) {
      writeJson(join(packageRoot, "package.json"), { ...metadata, ...changed });
      assert.throws(() => developmentToolchain(root), /Installed Stack identity/);
    }
    writeJson(join(packageRoot, "package.json"), metadata);
    writeJson(join(packageRoot, "toolchain-manifest.json"), { ...toolPins, schemaVersion: 2 });
    assert.throws(() => developmentToolchain(root), /manifest schema/);
  });
});

void test("development Stack refuses ancestor, escaped package and escaped public CLI resolution", () => {
  toolchainFixture((root, _packageRoot, parent) => {
    renameSync(join(root, "node_modules"), join(parent, "node_modules"));
    assert.throws(() => developmentToolchain(root), /outside its local owner/);
  });
  toolchainFixture((root, packageRoot, parent) => {
    const outside = join(parent, "outside-stack");
    renameSync(packageRoot, outside);
    symlinkSync(outside, packageRoot, "junction");
    assert.throws(() => developmentToolchain(root), /outside its local owner/);
  });
  toolchainFixture((root, packageRoot) => {
    writeFileSync(join(root, "node_modules/outside-cli.js"), "// never executed\n");
    const metadata = jsonRecord(
      JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")),
    );
    writeJson(join(packageRoot, "package.json"), {
      ...metadata,
      bin: { "stack-toolchain": "../outside-cli.js" },
    });
    assert.throws(() => developmentToolchain(root), /outside its local owner/);
  });
  toolchainFixture((root, packageRoot, parent) => {
    const outside = join(parent, "outside-manifest");
    writeJson(join(outside, "toolchain-manifest.json"), toolPins);
    symlinkSync(outside, join(packageRoot, "borrowed"), "junction");
    const metadata = jsonRecord(
      JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")),
    );
    writeJson(join(packageRoot, "package.json"), {
      ...metadata,
      exports: {
        "./package.json": "./package.json",
        "./toolchain-manifest.json": "./borrowed/toolchain-manifest.json",
      },
    });
    assert.throws(() => developmentToolchain(root), /outside its local owner/);
  });
});

void test("development Stack refuses malformed doctor identity and required companion observations", () => {
  toolchainFixture((root) => {
    const toolchain = developmentToolchain(root);
    for (const changed of [
      { schemaVersion: 2 },
      { command: "lint" },
      { status: "failed" },
      { exitCode: 1 },
    ]) {
      assert.throws(() =>
        assertToolchainDoctor({ ...doctorReport(toolchain.version), ...changed }, toolchain),
      );
    }
    for (const changed of [
      { schemaVersion: 2 },
      { packageVersion: "0.0.9" },
      { findings: [{ severity: "error" }] },
    ]) {
      const report = doctorReport(toolchain.version);
      assert.throws(() =>
        assertToolchainDoctor(
          { ...report, details: { ...jsonRecord(report.details), ...changed } },
          toolchain,
        ),
      );
    }
    for (const name of ["typescript", "oxlint", "oxlint-tsgolint", "oxfmt"]) {
      for (const changed of [{ available: false }, { resolvedVersion: "0.0.9" }]) {
        const report = doctorReport(toolchain.version);
        const details = jsonRecord(report.details);
        assert.throws(() =>
          assertToolchainDoctor(
            {
              ...report,
              details: { ...details, [name]: { ...jsonRecord(details[name]), ...changed } },
            },
            toolchain,
          ),
        );
      }
    }
  });
});
