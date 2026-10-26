import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  checkReleaseCandidate,
  type CheckReport,
  type ExpectedInputs,
  type FileChange,
  type FileLeaf,
  type InputBinding,
  type Json,
  type JsonRecord,
  type LeafShape,
  type ManifestSnapshot,
  type ObservedCandidate,
  type PermittedChange,
  type PlannedRelease,
  type ReleaseIntent,
  type WorkspacePackage,
} from "@agent-teams/release-checks";

export const releaseRepository = "agent-teams-ai/node-or-bun";
const lockArguments = [
  "install",
  "--package-lock-only",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
] as const;
const repositoryUrl = `https://github.com/${releaseRepository}.git`;
type Entry = Readonly<{ file: FileLeaf; data: string }>;
export type ReleaseTree = Readonly<Record<string, Entry>>;
type Custody = Readonly<{
  root: string;
  rootIdentity: string;
  gitDirectory: string;
  commonDirectory: string;
  head: string;
  node: string;
  nodeDigest: string;
  cli: string;
  npm: string;
}>;
export type PreparedRelease = Readonly<{
  expected: ExpectedInputs;
  source: ReleaseTree;
  rawPlan: JsonRecord;
  custody: Custody;
}>;

const ordered = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const digest = (value: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const identity = (value: unknown): string => digest(JSON.stringify(value));
const sha = (value: string): string => {
  if (!/^[a-f0-9]{40}$/.test(value)) {
    throw new Error("Release source must be an exact Git commit");
  }
  return value;
};
function isJson(value: unknown): value is Json {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every(isJson)) ||
    isJsonRecord(value)
  );
}
function isJsonRecord(value: unknown): value is JsonRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isJson)
  );
}
const record = (value: unknown, description: string): JsonRecord => {
  if (!isJsonRecord(value)) {
    throw new Error(`Invalid ${description}`);
  }
  return value;
};
const array = (value: unknown, description: string): readonly unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${description}`);
  }
  return value;
};
const string = (value: unknown, description: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${description}`);
  }
  return value;
};
const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) {
      freeze(item);
    }
    Object.freeze(value);
  }
  return value;
};

export function releaseCommand(command: string, args: readonly string[], cwd: string): Buffer {
  return execFileSync(command, [...args], {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", npm_config_update_notifier: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}
const git = (root: string, args: readonly string[]): string =>
  releaseCommand("git", args, root).toString("utf8").trim();
const content = (tree: ReleaseTree, path: string): string => {
  const entry = tree[path];
  if (!entry || entry.file.type !== "file") {
    throw new Error(`Missing regular release input: ${path}`);
  }
  return Buffer.from(entry.data, "base64").toString("utf8");
};
const json = (tree: ReleaseTree, path: string): JsonRecord =>
  record(JSON.parse(content(tree, path)), path);
const entry = (bytes: Buffer, mode: string): Entry => {
  if (mode !== "100644" && mode !== "100755" && mode !== "120000" && mode !== "160000") {
    throw new Error(`Unsupported Git mode: ${mode}`);
  }
  const shape: LeafShape =
    mode === "120000"
      ? ({ type: "symlink", mode } as const)
      : mode === "160000"
        ? ({ type: "gitlink", mode } as const)
        : { type: "file" as const, mode };
  return { file: { ...shape, digest: digest(bytes) }, data: bytes.toString("base64") };
};

function emptyTree(): Record<string, Entry> {
  const tree: Record<string, Entry> = {};
  Object.setPrototypeOf(tree, null);
  return tree;
}

export function readReleaseGitTree(root: string, revision: string): ReleaseTree {
  const tree = emptyTree();
  for (const line of releaseCommand("git", ["ls-tree", "-rz", "--full-tree", sha(revision)], root)
    .toString("utf8")
    .split("\0")) {
    if (!line) {
      continue;
    }
    const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40})\t(.+)$/.exec(line);
    if (!match) {
      throw new Error("Unsupported Git tree entry");
    }
    const mode = match[1]!;
    const type = match[2]!;
    const object = match[3]!;
    const path = match[4]!;
    tree[path] = entry(
      type === "commit"
        ? Buffer.from(object)
        : releaseCommand("git", ["cat-file", "blob", object], root),
      mode,
    );
  }
  return tree;
}

export function readReleaseWorkingTree(root: string): ReleaseTree {
  const tree = emptyTree();
  const indexModes = new Map(
    git(root, ["ls-files", "--stage", "-z"])
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf("\t");
        return [line.slice(tab + 1), line.slice(0, 6)];
      }),
  );
  const walk = (directory: string): void => {
    for (const name of readdirSync(join(root, directory)).toSorted(ordered)) {
      const path = directory ? `${directory}/${name}` : name;
      // These are the installed execution environment and npm's configured cache,
      // not candidate source. Ignored build outputs elsewhere remain observable.
      if ([".git", "node_modules", ".cache/npm", ".cache/npm-logs"].includes(path)) {
        if (
          [...indexModes.keys()].some(
            (tracked) => tracked === path || tracked.startsWith(`${path}/`),
          )
        ) {
          throw new Error(`Execution infrastructure must not be tracked: ${path}`);
        }
        continue;
      }
      const stat = lstatSync(join(root, path));
      if (stat.isSymbolicLink()) {
        tree[path] = entry(Buffer.from(readlinkSync(join(root, path))), "120000");
      } else if (stat.isDirectory()) {
        walk(path);
      } else if (stat.isFile()) {
        tree[path] = entry(
          readFileSync(join(root, path)),
          process.platform === "win32"
            ? (indexModes.get(path) ?? "100644")
            : stat.mode & 0o111
              ? "100755"
              : "100644",
        );
      } else {
        throw new Error(`Unsupported release tree entry: ${path}`);
      }
    }
  };
  walk("");
  return tree;
}
const treeIdentity = (tree: ReleaseTree): string =>
  identity(
    Object.keys(tree)
      .toSorted(ordered)
      .map((path) => [path, tree[path]!.file]),
  );

function installedPackage(from: string, name: string): string {
  const resolver = createRequire(join(from, "package.json"));
  for (const directory of resolver.resolve.paths(name) ?? []) {
    const manifest = join(directory, name, "package.json");
    if (existsSync(manifest)) {
      const root = realpathSync(dirname(manifest));
      if (JSON.parse(readFileSync(manifest, "utf8")).name !== name) {
        throw new Error(`Substituted installation: ${name}`);
      }
      return root;
    }
  }
  throw new Error(`Missing installed release engine dependency: ${name}`);
}

function installationDigest(root: string): string {
  const seen = new Map<string, unknown>();
  const visit = (directory: string): void => {
    if (seen.has(directory)) {
      return;
    }
    const metadata = record(
      JSON.parse(readFileSync(join(directory, "package.json"), "utf8")),
      "installed package",
    );
    const files: [string, string][] = [];
    const walk = (path: string): void => {
      for (const name of readdirSync(join(directory, path)).toSorted(ordered)) {
        const child = path ? `${path}/${name}` : name;
        const stat = lstatSync(join(directory, child));
        if (stat.isSymbolicLink()) {
          files.push([child, digest(readlinkSync(join(directory, child)))]);
        } else if (stat.isDirectory()) {
          walk(child);
        } else if (stat.isFile()) {
          files.push([child, digest(readFileSync(join(directory, child)))]);
        } else {
          throw new Error("Unsupported engine installation entry");
        }
      }
    };
    walk("");
    seen.set(directory, { name: metadata.name, version: metadata.version, files });
    for (const name of Object.keys(
      record(metadata.dependencies ?? {}, "engine dependencies"),
    ).toSorted(ordered)) {
      visit(installedPackage(directory, name));
    }
  };
  visit(root);
  return identity(
    [...seen.values()].toSorted((left, right) =>
      ordered(JSON.stringify(left), JSON.stringify(right)),
    ),
  );
}

function custody(rootInput: string, npmInput: string): Custody {
  const root = realpathSync(rootInput);
  // Git and Node may spell the same Windows directory differently. Compare
  // filesystem objects, without folding case on case-sensitive filesystems.
  const rootStat = statSync(root, { bigint: true });
  const gitRootStat = statSync(realpathSync(git(root, ["rev-parse", "--show-toplevel"])), {
    bigint: true,
  });
  if (
    !rootStat.isDirectory() ||
    !gitRootStat.isDirectory() ||
    rootStat.ino === 0n ||
    rootStat.dev !== gitRootStat.dev ||
    rootStat.ino !== gitRootStat.ino
  ) {
    throw new Error("Release must run at the actual repository root");
  }
  const origin = git(root, ["remote", "get-url", "origin"]);
  if (
    ![
      repositoryUrl,
      `https://github.com/${releaseRepository}`,
      `git@github.com:${releaseRepository}.git`,
    ].includes(origin)
  ) {
    throw new Error("Release repository origin is not the admitted node-or-bun repository");
  }
  const cliRoot = installedPackage(root, "@changesets/cli");
  if (relative(root, cliRoot).replaceAll("\\", "/") !== "node_modules/@changesets/cli") {
    throw new Error("Changesets must be installed inside the bound source root");
  }
  const npm = realpathSync(npmInput);
  if (basename(npm) !== "npm-cli.js" || basename(dirname(npm)) !== "bin") {
    throw new Error("Use the captured npm CLI entrypoint");
  }
  return {
    root,
    rootIdentity: `${rootStat.dev}:${rootStat.ino}`,
    gitDirectory: realpathSync(git(root, ["rev-parse", "--absolute-git-dir"])),
    commonDirectory: realpathSync(resolve(root, git(root, ["rev-parse", "--git-common-dir"]))),
    head: sha(git(root, ["rev-parse", "HEAD"])),
    node: realpathSync(process.execPath),
    nodeDigest: digest(readFileSync(process.execPath)),
    cli: realpathSync(join(cliRoot, "bin.js")),
    npm,
  };
}

function engineBinding(actual: Custody): InputBinding["engine"] {
  if (
    process.versions.node !== "26.11.1" ||
    JSON.parse(readFileSync(join(dirname(actual.cli), "package.json"), "utf8")).version !==
      "3.0.2" ||
    releaseCommand(actual.node, [actual.npm, "--version"], actual.root).toString("utf8").trim() !==
      "11.20.0"
  ) {
    throw new Error("Release generation requires Node 26.11.1, Changesets 3.0.2 and npm 11.20.0");
  }
  return {
    name: "@changesets/cli",
    version: "3.0.2",
    digest: identity({
      changesets: installationDigest(dirname(actual.cli)),
      npm: installationDigest(dirname(dirname(actual.npm))),
    }),
  };
}

const manifest = (tree: ReleaseTree, path: string): ManifestSnapshot => ({
  file: tree[path]!.file,
  semantic: json(tree, path),
});
function inventory(tree: ReleaseTree): readonly WorkspacePackage[] {
  const paths = Object.keys(tree)
    .filter((path) => basename(path) === "package.json")
    .toSorted(ordered);
  if (!isDeepStrictEqual(paths, ["package.json"])) {
    throw new Error("This release Host admits exactly the public root package");
  }
  const before = manifest(tree, "package.json");
  if (
    before.semantic.name !== "node-or-bun" ||
    before.semantic.private === true ||
    "workspaces" in before.semantic ||
    typeof before.semantic.version !== "string"
  ) {
    throw new Error("Unsupported root package identity or version eligibility");
  }
  return [
    {
      name: "node-or-bun",
      root: ".",
      manifestPath: "package.json",
      classification: "public",
      versioning: "versioned",
      before,
    },
  ];
}

function isChangesetIntent(path: string): boolean {
  // Pinned @changesets/read 1.0.1 enumerates these two directories and applies
  // these basename rules. Prerelease identities remain outside this Host's scope.
  const name = /^\.changeset\/(?:pre\/)?([^/]+)$/.exec(path)?.[1];
  return (
    name !== undefined &&
    !name.startsWith(".") &&
    name.endsWith(".md") &&
    !/^README\.md$/i.test(name) &&
    !["AGENTS.md", "CLAUDE.md", "GEMINI.md"].includes(name)
  );
}

function normalizePlan(
  raw: JsonRecord,
  tree: ReleaseTree,
): Pick<ExpectedInputs, "intents" | "plan" | "permittedChanges"> {
  if (raw.preState !== undefined && raw.preState !== null) {
    throw new Error("Prerelease mode is outside this single-package route");
  }
  const intents: ReleaseIntent[] = array(raw.changesets, "official intent inventory").map(
    (value) => {
      const intent = record(value, "official intent");
      const id = string(intent.id, "intent identity");
      if (!/^[A-Za-z0-9_-]+$/.test(id) || id === "README") {
        throw new Error("Unsafe intent identity");
      }
      const path = `.changeset/${id}.md`;
      return {
        id,
        path,
        digest: tree[path]?.file.digest ?? "missing",
        participation: "pending",
        requests: array(intent.releases, "intent requests").map((requestInput) => {
          const request = record(requestInput, "intent request");
          const requestType = request.type;
          if (requestType !== "patch" && requestType !== "minor" && requestType !== "major") {
            throw new Error("Unsupported intent release type");
          }
          return {
            packageName: string(request.name, "requested package"),
            type: requestType,
          };
        }),
      };
    },
  );
  const paths = Object.keys(tree).filter(isChangesetIntent).toSorted(ordered);
  if (!isDeepStrictEqual(paths, intents.map((intent) => intent.path).toSorted(ordered))) {
    throw new Error("Official plan omitted a source intent");
  }
  const releases: PlannedRelease[] = array(raw.releases, "official releases").map((value) => {
    const release = record(value, "official release");
    const releaseType = release.type;
    if (
      releaseType !== "patch" &&
      releaseType !== "minor" &&
      releaseType !== "major" &&
      releaseType !== "none"
    ) {
      throw new Error("Unsupported official release type");
    }
    return {
      packageName: string(release.name, "planned package"),
      manifestPath: "package.json",
      type: releaseType,
      oldVersion:
        release.oldVersion === undefined ? null : string(release.oldVersion, "old version"),
      newVersion:
        release.newVersion === undefined ? null : string(release.newVersion, "new version"),
      intentIds: array(release.changesets, "direct intent links").map((intentId) =>
        string(intentId, "direct intent link"),
      ),
    };
  });
  const hasRelease = releases.some((release) => release.oldVersion !== release.newVersion);
  const consumptions = hasRelease
    ? intents.map((intent) => ({ intentId: intent.id, effect: { kind: "remove" as const } }))
    : [];
  const permit = (
    path: string,
    classification: string,
    authority: string,
    deleted = false,
  ): PermittedChange => ({
    path,
    classification,
    kind: deleted ? "deleted" : tree[path] ? "modified" : "added",
    before: tree[path] ? { type: "file", mode: "100644" } : null,
    after: deleted ? null : { type: "file", mode: "100644" },
    contentAuthority: authority,
  });
  return {
    intents,
    plan: { releases, consumptions },
    permittedChanges: hasRelease
      ? [
          permit("package.json", "manifest", "release-checks"),
          permit("package-lock.json", "lock", "node-or-bun-root-lock-version"),
          permit("CHANGELOG.md", "changelog", "node-or-bun-changelog-history-and-replay"),
          ...intents.map((intent) => permit(intent.path, "intent", "release-checks", true)),
        ]
      : [],
  };
}

export function captureRelease(
  root: string,
  expectedSource: string,
  npmEntrypoint: string,
): PreparedRelease {
  const actual = custody(root, npmEntrypoint);
  if (actual.head !== sha(expectedSource)) {
    throw new Error("Processed source changed before release planning");
  }
  const source = readReleaseWorkingTree(actual.root);
  if (
    treeIdentity(source) !== treeIdentity(readReleaseGitTree(actual.root, actual.head)) ||
    git(actual.root, ["status", "--porcelain", "--untracked-files=all"])
  ) {
    throw new Error("Release planning requires the exact clean accepted source");
  }
  const config = json(source, ".changeset/config.json");
  if (
    config.changelog !== "@changesets/cli/changelog" ||
    config.commit !== false ||
    config.baseBranch !== "main" ||
    config.access !== "public" ||
    config.updateInternalDependencies !== "patch" ||
    config.format !== false ||
    !isDeepStrictEqual(config.ignore, []) ||
    !isDeepStrictEqual(config.fixed, []) ||
    !isDeepStrictEqual(config.linked, []) ||
    Object.keys(config).some(
      (key) =>
        ![
          "$schema",
          "changelog",
          "commit",
          "baseBranch",
          "access",
          "updateInternalDependencies",
          "format",
          "ignore",
          "fixed",
          "linked",
        ].includes(key),
    )
  ) {
    throw new Error("Changesets configuration is outside the qualified single-package profile");
  }
  const engine = engineBinding(actual);
  const packages = inventory(source);
  if (
    record(packages[0]!.before.semantic.devDependencies, "development dependencies")[
      "@changesets/cli"
    ] !== "3.0.2"
  ) {
    throw new Error("Changesets must be an exact development dependency");
  }
  const temporary = mkdtempSync(join(tmpdir(), "TEST-node-or-bun-plan-"));
  let rawPlan: JsonRecord;
  try {
    const output = join(temporary, "plan.json");
    releaseCommand(actual.node, [actual.cli, "status", "--output", output], actual.root);
    rawPlan = record(JSON.parse(readFileSync(output, "utf8")), "official release plan");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  const normalized = normalizePlan(rawPlan, source);
  const binding: InputBinding = {
    source: { repository: releaseRepository, identity: actual.head, digest: treeIdentity(source) },
    engine,
    configDigest: source[".changeset/config.json"]!.file.digest,
    inventoryDigest: identity(packages),
    policyDigest: identity({
      profile: "node-or-bun-single-package-v1",
      lockArguments,
      permittedChanges: normalized.permittedChanges,
    }),
    intentsDigest: identity(normalized.intents),
    planDigest: identity(rawPlan),
  };
  const prepared = freeze({
    expected: { binding, packages, ...normalized },
    source,
    rawPlan,
    custody: actual,
  });
  assertExecution(prepared);
  if (treeIdentity(readReleaseWorkingTree(actual.root)) !== treeIdentity(source)) {
    throw new Error("Planning changed its source inputs");
  }
  return prepared;
}

function assertExecution(prepared: PreparedRelease): InputBinding["engine"] {
  const actual = custody(prepared.custody.root, prepared.custody.npm);
  if (!isDeepStrictEqual(actual, prepared.custody)) {
    throw new Error("Release execution custody changed");
  }
  const engine = engineBinding(actual);
  if (!isDeepStrictEqual(engine, prepared.expected.binding.engine)) {
    throw new Error("Release engine installation changed");
  }
  return engine;
}

function assertLock(before: ReleaseTree, after: ReleaseTree): void {
  const version = json(after, "package.json").version;
  const original = json(before, "package-lock.json");
  const observed = json(after, "package-lock.json");
  const originalRoot = record(record(original.packages, "lock packages")[""], "lock root");
  if (
    original.version !== json(before, "package.json").version ||
    originalRoot.version !== original.version
  ) {
    throw new Error("Accepted root lock metadata was already stale");
  }
  const allowed = {
    ...original,
    version,
    packages: { ...record(original.packages, "lock packages"), "": { ...originalRoot, version } },
  };
  if (!isDeepStrictEqual(observed, allowed)) {
    throw new Error("Release lock may change only its two matching root version fields");
  }
}

const words = (text: string): string => text.replace(/\s+/g, " ").trim();

function assertChangelog(prepared: PreparedRelease, tree: ReleaseTree): void {
  const release = prepared.expected.plan.releases.find(
    (candidate) => candidate.oldVersion !== candidate.newVersion,
  );
  if (!release) {
    return;
  }
  const before = content(prepared.source, "CHANGELOG.md");
  const after = content(tree, "CHANGELOG.md");
  const firstHeader = before.search(/^#{1,6}\s+\d+\.\d+/m);
  if (
    firstHeader < 0 ||
    !after.startsWith(before.slice(0, firstHeader)) ||
    !after.endsWith(before.slice(firstHeader))
  ) {
    throw new Error("Release changelog must preserve its existing history exactly");
  }
  const added = after.slice(firstHeader, after.length - (before.length - firstHeader));
  if (
    !added.startsWith(`## ${release.newVersion}\n`) ||
    (added.match(/^## /gm) ?? []).length !== 1
  ) {
    throw new Error("Changelog does not contain the exact planned release section");
  }
  for (const value of array(prepared.rawPlan.changesets, "official intents")) {
    const intent = record(value, "official intent");
    if (
      release.intentIds.includes(string(intent.id, "intent identity")) &&
      !words(added).includes(words(string(intent.summary, "release summary")))
    ) {
      throw new Error("Changelog omitted an accepted release summary");
    }
  }
}

export function checkReleaseTree(
  prepared: PreparedRelease,
  tree: ReleaseTree,
  candidateIdentity: string,
  sourceIdentity = prepared.custody.head,
): CheckReport {
  const engine = assertExecution(prepared);
  const { expected, source } = prepared;
  const paths = [...new Set([...Object.keys(source), ...Object.keys(tree)])].toSorted(ordered);
  const classification = (path: string): string =>
    basename(path) === "package.json"
      ? "manifest"
      : path === "package-lock.json"
        ? "lock"
        : path === "CHANGELOG.md"
          ? "changelog"
          : isChangesetIntent(path)
            ? "intent"
            : "source";
  const diff: FileChange[] = paths
    .filter((path) => !isDeepStrictEqual(source[path]?.file, tree[path]?.file))
    .map((path) => ({
      path,
      classification: classification(path),
      kind: !source[path] ? "added" : !tree[path] ? "deleted" : "modified",
      before: source[path]?.file ?? null,
      after: tree[path]?.file ?? null,
    }));
  const projected = { ...tree };
  for (const permitted of expected.permittedChanges) {
    if (source[permitted.path]) {
      projected[permitted.path] = source[permitted.path]!;
    } else {
      delete projected[permitted.path];
    }
  }
  const intents = expected.intents.map((intent) => ({
    ...intent,
    digest: tree[intent.path]?.file.digest ?? source[intent.path]!.file.digest,
  }));
  const manifests = paths
    .filter((path) => basename(path) === "package.json")
    .map((path) => ({
      manifestPath: path,
      before: source[path] ? manifest(source, path) : null,
      after: tree[path] ? manifest(tree, path) : null,
    }));
  const binding: InputBinding = {
    source: {
      repository: releaseRepository,
      identity: sha(sourceIdentity),
      digest: treeIdentity(projected),
    },
    engine,
    configDigest: tree[".changeset/config.json"]?.file.digest ?? digest("missing"),
    inventoryDigest: identity(inventory(projected)),
    policyDigest: identity({
      profile: "node-or-bun-single-package-v1",
      lockArguments,
      permittedChanges: expected.permittedChanges,
    }),
    intentsDigest: identity(intents),
    planDigest: identity(prepared.rawPlan),
  };
  const observed: ObservedCandidate = {
    binding,
    candidateIdentity,
    manifests,
    diff,
    consumptions: expected.intents
      .filter((intent) => !tree[intent.path])
      .map((intent) => ({
        intentId: intent.id,
        digest: source[intent.path]!.file.digest,
        effect: { kind: "remove" },
      })),
  };
  const report = checkReleaseCandidate({ schemaVersion: 1, expected, observed });
  if (report.outcome === "passed") {
    assertLock(source, tree);
    assertChangelog(prepared, tree);
  }
  return report;
}

export function assertReleasePassed(report: CheckReport): void {
  if (report.outcome !== "passed") {
    throw new Error(
      `Release candidate rejected: ${report.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join("; ")}`,
    );
  }
}

export function versionRelease(
  prepared: PreparedRelease,
): Readonly<{ changed: boolean; report: CheckReport; tree: ReleaseTree }> {
  assertExecution(prepared);
  if (
    treeIdentity(readReleaseWorkingTree(prepared.custody.root)) !== treeIdentity(prepared.source)
  ) {
    throw new Error("Source inputs changed after planning");
  }
  const changed = prepared.expected.plan.releases.some(
    (candidate) => candidate.oldVersion !== candidate.newVersion,
  );
  if (changed) {
    releaseCommand(prepared.custody.node, [prepared.custody.cli, "version"], prepared.custody.root);
    assertExecution(prepared);
    releaseCommand(
      prepared.custody.node,
      [prepared.custody.npm, ...lockArguments],
      prepared.custody.root,
    );
  }
  const tree = readReleaseWorkingTree(prepared.custody.root);
  const report = checkReleaseTree(prepared, tree, treeIdentity(tree));
  assertReleasePassed(report);
  return freeze({ changed, report, tree });
}

export function releaseNpmEntrypoint(): string {
  if (!process.env.npm_execpath) {
    throw new Error("Run this Host through its npm script so the exact npm CLI is captured");
  }
  return process.env.npm_execpath;
}
