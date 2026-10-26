import { strict as assert } from "node:assert";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { checkReleaseCandidate } from "@agent-teams/release-checks";
import { releaseCandidateConformanceCases } from "@agent-teams/release-checks/conformance";
import {
  assertReleasePassed,
  captureRelease,
  checkReleaseTree,
  readReleaseGitTree,
  readReleaseWorkingTree,
  releaseCommand,
  releaseNpmEntrypoint,
  versionRelease,
  type PreparedRelease,
} from "../scripts/release-candidate.ts";
import { qualifyReleasePr } from "../scripts/release-pr.ts";
import { jsonRecord } from "../scripts/release-policy.ts";

const repository = resolve(import.meta.dirname, "..");
const readJson = (path: string): Record<string, unknown> =>
  jsonRecord(JSON.parse(readFileSync(path, "utf8")));
const writeJson = (path: string, value: unknown): void =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const git = (root: string, ...args: string[]): string =>
  releaseCommand("git", args, root).toString("utf8").trim();
const metadataIntent = '---\n"node-or-bun": patch\n---\n\nUpdate development release tooling.\n';

function fixture(
  t: TestContext,
  release = true,
): { root: string; directory: string; source: string } {
  const directory = mkdtempSync(join(tmpdir(), "TEST-node-or-bun-fixture-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "repo");
  mkdirSync(join(root, ".changeset"), { recursive: true });
  const metadata = { ...readJson(join(repository, "package.json")), version: "0.2.2" };
  const lock = readJson(join(repository, "package-lock.json"));
  const packages = jsonRecord(lock.packages);
  writeJson(join(root, "package.json"), metadata);
  writeJson(join(root, "package-lock.json"), {
    ...lock,
    version: "0.2.2",
    packages: { ...packages, "": { ...jsonRecord(packages[""]), version: "0.2.2" } },
  });
  cpSync(join(repository, ".changeset/config.json"), join(root, ".changeset/config.json"));
  writeFileSync(join(root, ".gitignore"), "node_modules/\n.cache/\n");
  writeFileSync(
    join(root, ".npmrc"),
    `cache=${join(repository, ".cache/npm").replaceAll("\\", "/")}\nupdate-notifier=false\n`,
  );
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## 0.2.2\n\n- Previous release.\n");
  writeFileSync(join(root, "source.ts"), "export const unchanged = true;\n");
  writeFileSync(join(root, ".changeset/housekeeping.md"), "---\n---\n\nMaintenance only.\n");
  if (release) {
    writeFileSync(join(root, ".changeset/metadata.md"), metadataIntent);
  }
  // npm must own the accepted lock after relocating a disposable archive fixture;
  // its file: resolution can differ from the runner before any version operation.
  releaseCommand(
    process.execPath,
    [
      releaseNpmEntrypoint(),
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    root,
  );
  git(root, "init", "-b", "main");
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "user.name", "iliya");
  git(root, "config", "user.email", "iliyazelenkog@gmail.com");
  git(root, "remote", "add", "origin", "https://github.com/agent-teams-ai/node-or-bun.git");
  git(root, "add", "--all");
  git(root, "commit", "-m", "test: accepted release fixture");
  cpSync(join(repository, "node_modules"), join(root, "node_modules"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  return { root, directory, source: git(root, "rev-parse", "HEAD") };
}

const prepare = (source: { root: string; source: string }): PreparedRelease =>
  captureRelease(source.root, source.source, releaseNpmEntrypoint());
const inspect = (prepared: PreparedRelease): void =>
  assertReleasePassed(
    checkReleaseTree(
      prepared,
      readReleaseWorkingTree(prepared.custody.root),
      "observed-test-candidate",
    ),
  );

for (const scenario of releaseCandidateConformanceCases) {
  void test(`installed common conformance: ${scenario.id}`, () => {
    const report = checkReleaseCandidate(scenario.input);
    assert.equal(report.outcome, scenario.expected.outcome);
    assert.deepEqual(
      [...new Set(report.diagnostics.map((diagnostic) => diagnostic.code))].toSorted(),
      [...scenario.expected.diagnosticCodes].toSorted(),
    );
    assert.deepEqual(report.packageChanges, scenario.expected.packageChanges);
  });
}

void test("actual Changesets v3 generates the public root patch, consumes empty intent, then npm synchronizes only root lock versions", (t) => {
  const source = fixture(t);
  const prepared = prepare(source);
  assert.equal(prepared.expected.binding.source.identity, source.source);
  assert.deepEqual(prepared.expected.plan.releases, [
    {
      packageName: "node-or-bun",
      manifestPath: "package.json",
      type: "patch",
      oldVersion: "0.2.2",
      newVersion: "0.2.3",
      intentIds: ["metadata"],
    },
  ]);
  assert.deepEqual(prepared.expected.intents.map((intent) => intent.id).toSorted(), [
    "housekeeping",
    "metadata",
  ]);
  assert.equal(prepared.expected.packages[0]?.classification, "public");
  assert.equal(prepared.expected.packages[0]?.versioning, "versioned");
  // The action may change the branch name at this same processed source commit.
  git(source.root, "switch", "-c", "changeset-release/main");
  const result = versionRelease(prepared);
  assert.equal(result.changed, true);
  assert.deepEqual(result.report.packageChanges, [
    {
      packageName: "node-or-bun",
      manifestPath: "package.json",
      oldVersion: "0.2.2",
      newVersion: "0.2.3",
    },
  ]);
  assert.equal(readJson(join(source.root, "package.json")).version, "0.2.3");
  const lock = readJson(join(source.root, "package-lock.json"));
  assert.equal(lock.version, "0.2.3");
  assert.equal(jsonRecord(jsonRecord(lock.packages)[""]).version, "0.2.3");
  assert.equal(existsSync(join(source.root, ".changeset/metadata.md")), false);
  assert.equal(existsSync(join(source.root, ".changeset/housekeeping.md")), false);
  assert.match(
    readFileSync(join(source.root, "CHANGELOG.md"), "utf8"),
    /## 0\.2\.3\n[\s\S]*Update development release tooling\./,
  );
});

void test("an actual empty-only official plan performs no versioning and retains its intent", (t) => {
  const source = fixture(t, false);
  const prepared = prepare(source);
  assert.deepEqual(prepared.expected.plan, { releases: [], consumptions: [] });
  assert.equal(prepared.expected.intents.length, 1);
  const result = versionRelease(prepared);
  assert.equal(result.changed, false);
  assert.deepEqual(result.tree, prepared.source);
  assert.equal(existsSync(join(source.root, ".changeset/housekeeping.md")), true);
});

void test("the actual pinned reader excludes source documentation from intents while whole-tree checks protect its bytes", (t) => {
  const source = fixture(t);
  const documentation = [
    ".changeset/rEaDmE.md",
    ".changeset/AGENTS.md",
    ".changeset/CLAUDE.md",
    ".changeset/GEMINI.md",
    ".changeset/.hidden.md",
    ".changeset/uppercase.MD",
    ".changeset/docs/nested.md",
    ".changeset/pre/README.md",
  ];
  for (const path of documentation) {
    mkdirSync(dirname(join(source.root, path)), { recursive: true });
    writeFileSync(
      join(source.root, path),
      `# Accepted source documentation\n\nPreserve ${path}.\n`,
    );
  }
  git(source.root, "add", "--force", "--", ...documentation);
  git(source.root, "commit", "-m", "test: admit documentation beside actual intents");
  const prepared = captureRelease(
    source.root,
    git(source.root, "rev-parse", "HEAD"),
    releaseNpmEntrypoint(),
  );
  assert.deepEqual(prepared.expected.intents.map((intent) => intent.id).toSorted(), [
    "housekeeping",
    "metadata",
  ]);
  assert.equal(versionRelease(prepared).changed, true);
  for (const path of documentation) {
    const original = `# Accepted source documentation\n\nPreserve ${path}.\n`;
    assert.equal(readFileSync(join(source.root, path), "utf8"), original, path);
    try {
      writeFileSync(join(source.root, path), `${original}\nUnapproved generated edit.\n`);
      assert.throws(() => inspect(prepared), /diff.unexpected/, path);
    } finally {
      writeFileSync(join(source.root, path), original);
    }
  }
  inspect(prepared);
});

void test("independent whole-tree observation rejects manifest, lock, intent, history, mode and unlisted-output tampering", (t) => {
  const source = fixture(t);
  const prepared = prepare(source);
  versionRelease(prepared);
  const mutate = (path: string, change: (value: string) => string, expected: RegExp): void => {
    const file = join(source.root, path);
    const original = existsSync(file) ? readFileSync(file) : undefined;
    try {
      writeFileSync(file, change(original?.toString("utf8") ?? ""));
      assert.throws(() => inspect(prepared), expected, path);
    } finally {
      if (original) {
        writeFileSync(file, original);
      } else {
        rmSync(file);
      }
    }
  };
  mutate(
    "package.json",
    (value) => JSON.stringify({ ...JSON.parse(value), version: "0.2.4" }),
    /plan.version-mismatch/,
  );
  mutate(
    "package.json",
    (value) => JSON.stringify({ ...JSON.parse(value), private: true }),
    /manifest.content-changed/,
  );
  mutate(
    "package.json",
    (value) => JSON.stringify({ ...JSON.parse(value), scripts: { build: "unsafe replacement" } }),
    /manifest.content-changed/,
  );
  mutate(
    "package-lock.json",
    (value) => JSON.stringify({ ...JSON.parse(value), version: "0.2.2" }),
    /two matching root version fields/,
  );
  mutate(
    "package-lock.json",
    (value) => {
      const lock = jsonRecord(JSON.parse(value));
      const packages = jsonRecord(lock.packages);
      return JSON.stringify({
        ...lock,
        packages: {
          ...packages,
          "node_modules/@changesets/cli": {
            ...jsonRecord(packages["node_modules/@changesets/cli"]),
            integrity: "sha512-altered",
          },
        },
      });
    },
    /two matching root version fields/,
  );
  mutate(
    "CHANGELOG.md",
    (value) => value.replace("Previous release.", "Altered history."),
    /preserve its existing history/,
  );
  mutate(".changeset/metadata.md", () => metadataIntent, /intent.consumption/);
  mutate("source.ts", () => "export const unrelated = true;\n", /diff.unexpected/);
  mutate("generated.txt", () => "unlisted generation\n", /diff.unexpected/);
  mutate("__proto__", () => "unlisted prototype-named file\n", /diff.unexpected/);
  mutate(".changeset/new-intent.md", () => metadataIntent, /diff.unexpected/);
  mkdirSync(join(source.root, "dist"));
  try {
    mutate("dist/unlisted.js", () => "ignored generated output\n", /diff.unexpected/);
  } finally {
    rmSync(join(source.root, "dist"), { recursive: true });
  }
  if (process.platform === "win32") {
    git(source.root, "update-index", "--chmod=+x", "package.json");
    try {
      assert.throws(() => inspect(prepared), /diff.unexpected/);
    } finally {
      git(source.root, "update-index", "--chmod=-x", "package.json");
    }
  } else {
    chmodSync(join(source.root, "package.json"), 0o755);
    try {
      assert.throws(() => inspect(prepared), /diff.unexpected/);
    } finally {
      chmodSync(join(source.root, "package.json"), 0o644);
    }
  }
  inspect(prepared);
});

void test("working and committed Git trees retain and reject tampering of an actual __proto__ file", (t) => {
  const source = fixture(t);
  const original = "Accepted source with an ordinary file named __proto__.\n";
  writeFileSync(join(source.root, "__proto__"), original);
  git(source.root, "add", "__proto__");
  git(source.root, "commit", "-m", "test: retain prototype-named source file");
  const base = git(source.root, "rev-parse", "HEAD");
  for (const tree of [readReleaseGitTree(source.root, base), readReleaseWorkingTree(source.root)]) {
    assert.equal(Object.hasOwn(tree, "__proto__"), true);
    assert.equal(Buffer.from(tree["__proto__"]!.data, "base64").toString("utf8"), original);
  }
  const prepared = captureRelease(source.root, base, releaseNpmEntrypoint());
  versionRelease(prepared);
  writeFileSync(join(source.root, "__proto__"), "Unapproved source replacement.\n");
  assert.throws(() => inspect(prepared), /diff.unexpected/);
  git(source.root, "add", "--all");
  const tree = git(source.root, "write-tree");
  // Create a real candidate commit without moving the bound execution HEAD.
  const candidate = git(
    source.root,
    "commit-tree",
    tree,
    "-p",
    base,
    "-m",
    "test: unapproved candidate source",
  );
  assert.throws(
    () =>
      assertReleasePassed(
        checkReleaseTree(prepared, readReleaseGitTree(source.root, candidate), candidate),
      ),
    /diff.unexpected/,
  );
});

void test("versioning rejects source, config, engine, HEAD and Git-directory changes after planning", (t) => {
  const source = fixture(t);
  const prepared = prepare(source);
  for (const path of [
    "source.ts",
    ".changeset/config.json",
    ".changeset/metadata.md",
    "package.json",
  ]) {
    const absolute = join(source.root, path);
    const original = readFileSync(absolute);
    try {
      writeFileSync(absolute, `${original.toString("utf8")}\n`);
      assert.throws(() => versionRelease(prepared), /Source inputs changed/);
    } finally {
      writeFileSync(absolute, original);
    }
  }
  const originalCli = readFileSync(prepared.custody.cli);
  try {
    writeFileSync(prepared.custody.cli, `${originalCli.toString("utf8")}\n`);
    assert.throws(() => versionRelease(prepared), /engine installation changed/);
  } finally {
    writeFileSync(prepared.custody.cli, originalCli);
  }
  git(source.root, "commit", "--allow-empty", "-m", "test: substituted processed source");
  try {
    assert.throws(() => versionRelease(prepared), /custody changed/);
  } finally {
    git(source.root, "reset", "--hard", source.source);
  }
  const moved = join(source.directory, "moved-git");
  renameSync(join(source.root, ".git"), moved);
  writeFileSync(join(source.root, ".git"), `gitdir: ${moved}\n`);
  try {
    assert.throws(() => versionRelease(prepared), /custody changed/);
  } finally {
    rmSync(join(source.root, ".git"));
    renameSync(moved, join(source.root, ".git"));
  }
  assert.equal(readJson(join(source.root, "package.json")).version, "0.2.2");
});

void test("foreign physical roots are rejected and PATH/npm environment cannot replace the captured CLI", (t) => {
  const source = fixture(t);
  const prepared = prepare(source);
  const moved = join(source.directory, "moved-source");
  renameSync(source.root, moved);
  symlinkSync(moved, source.root, process.platform === "win32" ? "junction" : "dir");
  try {
    assert.throws(() => versionRelease(prepared), /custody changed/);
  } finally {
    rmSync(source.root);
    renameSync(moved, source.root);
  }
  const fake = join(source.directory, "fake-bin");
  mkdirSync(fake);
  writeFileSync(join(fake, "changeset"), "#!/bin/sh\nexit 91\n", { mode: 0o755 });
  writeFileSync(join(fake, "changeset.cmd"), "@exit /b 91\r\n");
  const originalPath = process.env.PATH;
  const originalNpm = process.env.npm_execpath;
  process.env.PATH = `${fake}${process.platform === "win32" ? ";" : ":"}${originalPath ?? ""}`;
  process.env.npm_execpath = join(fake, "npm-cli.js");
  try {
    assert.equal(versionRelease(prepared).changed, true);
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalNpm === undefined) {
      delete process.env.npm_execpath;
    } else {
      process.env.npm_execpath = originalNpm;
    }
  }
});

void test("release PR replay derives the exact version and changelog from its independent current base", (t) => {
  const source = fixture(t);
  const npm = releaseNpmEntrypoint();
  const prepared = prepare(source);
  git(source.root, "switch", "-c", "changeset-release/main");
  versionRelease(prepared);
  git(source.root, "add", "--all");
  git(source.root, "commit", "-m", "chore(release): version package");
  const head = git(source.root, "rev-parse", "HEAD");
  assert.doesNotThrow(() => qualifyReleasePr(source.root, source.source, head, npm));
  writeFileSync(
    join(source.root, "CHANGELOG.md"),
    readFileSync(join(source.root, "CHANGELOG.md"), "utf8").replace(
      "### Patch Changes",
      "### Patch Changes\n\nUnapproved extra text.",
    ),
  );
  git(source.root, "add", "CHANGELOG.md");
  git(source.root, "commit", "-m", "test: tamper generated release text");
  assert.throws(
    () => qualifyReleasePr(source.root, source.source, git(source.root, "rev-parse", "HEAD"), npm),
    /independently replayed/,
  );
  git(source.root, "switch", "main");
  writeFileSync(join(source.root, "source.ts"), "export const currentBase = true;\n");
  git(source.root, "add", "source.ts");
  git(source.root, "commit", "-m", "test: current accepted source advances");
  assert.throws(() =>
    qualifyReleasePr(source.root, git(source.root, "rev-parse", "HEAD"), head, npm),
  );
});

void test("the genuinely generated 0.2.3 archive is the default installed Node, Bun and Node-in-Bun qualification input", (t) => {
  const source = fixture(t);
  for (const path of ["src", "tsconfig.base.json", "tsconfig.build.json", "README.md", "LICENSE"]) {
    cpSync(join(repository, path), join(source.root, path), { recursive: true });
  }
  mkdirSync(join(source.root, "sandbox"));
  git(source.root, "add", "--all");
  git(source.root, "commit", "-m", "test: admit actual product source for archive qualification");
  const prepared = captureRelease(
    source.root,
    git(source.root, "rev-parse", "HEAD"),
    releaseNpmEntrypoint(),
  );
  versionRelease(prepared);
  releaseCommand(process.execPath, [releaseNpmEntrypoint(), "run", "build"], source.root);
  releaseCommand(process.execPath, [join(repository, "scripts/pack.ts")], source.root);
  assert.equal(existsSync(join(source.root, ".worker-tmp/pack/node-or-bun-0.2.2.tgz")), false);
  assert.equal(existsSync(join(source.root, ".worker-tmp/pack/node-or-bun-0.2.3.tgz")), true);
  const output = releaseCommand(
    process.execPath,
    [join(repository, "scripts/qualify-installed-consumer.ts")],
    source.root,
  ).toString("utf8");
  assert.match(output, /installed consumer qualification passed: node, bun/);
});
