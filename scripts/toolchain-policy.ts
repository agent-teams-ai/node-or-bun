import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { jsonRecord, packageIdentity } from "./release-policy.ts";

function contained(root: string, filename: string): string {
  const actual = realpathSync(filename);
  const suffix = relative(root, actual);
  if (suffix === ".." || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
    throw new Error("Stack development tooling resolved outside its local owner");
  }
  return actual;
}

const readJson = (filename: string): unknown => JSON.parse(readFileSync(filename, "utf8"));

export function developmentToolchain(root: string) {
  const consumer = realpathSync(root);
  const source = jsonRecord(readJson(join(consumer, "package.json")));
  const version = jsonRecord(source.devDependencies)["stack-toolchain"];
  if (
    typeof version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version) ||
    ["dependencies", "optionalDependencies", "peerDependencies"].some((section) =>
      Object.hasOwn(jsonRecord(source[section] ?? {}), "stack-toolchain"),
    )
  ) {
    throw new Error("Stack requires one canonical stable exact root development pin");
  }
  const fromConsumer = createRequire(join(consumer, "package.json"));
  const metadataPath = contained(
    join(consumer, "node_modules"),
    fromConsumer.resolve("stack-toolchain/package.json"),
  );
  const metadata = jsonRecord(readJson(metadataPath));
  const installed = packageIdentity(metadata);
  if (installed.name !== "stack-toolchain" || installed.version !== version) {
    throw new Error("Installed Stack identity differs from the root development pin");
  }
  const packageRoot = dirname(metadataPath);
  const manifest = jsonRecord(
    readJson(
      contained(packageRoot, fromConsumer.resolve("stack-toolchain/toolchain-manifest.json")),
    ),
  );
  if (manifest.schemaVersion !== 1) {
    throw new Error("Unsupported public Stack toolchain manifest schema");
  }
  const bin =
    typeof metadata.bin === "string" ? metadata.bin : jsonRecord(metadata.bin)["stack-toolchain"];
  if (typeof bin !== "string" || bin.length === 0 || isAbsolute(bin)) {
    throw new Error("Stack requires a relative public CLI entrypoint");
  }
  const cli = contained(packageRoot, resolve(packageRoot, bin));
  if (!statSync(cli).isFile()) {
    throw new Error("Stack public CLI entrypoint must be a regular file");
  }
  return { version, cli, manifest };
}

export function assertToolchainDoctor(
  value: unknown,
  toolchain: ReturnType<typeof developmentToolchain>,
): void {
  const report = jsonRecord(value);
  const details = jsonRecord(report.details);
  if (
    report.schemaVersion !== 1 ||
    report.command !== "doctor" ||
    report.status !== "passed" ||
    report.exitCode !== 0 ||
    details.schemaVersion !== 1 ||
    details.packageVersion !== toolchain.version ||
    !Array.isArray(details.findings) ||
    details.findings.some((finding: unknown) => jsonRecord(finding).severity === "error")
  ) {
    throw new Error("Unsupported or unsuccessful public Stack doctor report");
  }
  for (const name of ["typescript", "oxlint", "oxlint-tsgolint", "oxfmt"]) {
    const pin = toolchain.manifest[name];
    const observed = jsonRecord(details[name]);
    if (
      typeof pin !== "string" ||
      observed.available !== true ||
      observed.expectedVersion !== pin ||
      observed.installedVersion !== pin ||
      observed.resolvedVersion !== pin
    ) {
      throw new Error(`Stack doctor does not qualify required tool ${name}`);
    }
  }
}
