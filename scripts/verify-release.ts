import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertRegistryRelease } from "./release-policy.ts";

const metadata = JSON.parse(await readFile("package.json", "utf8")) as { name: string; version: string };
const file = process.env.ARCHIVE ?? "";
if (metadata.name !== "node-or-bun" || !/^\d+\.\d+\.\d+$/.test(metadata.version)
  || file !== `node-or-bun-${metadata.version}.tgz`) {
  throw new Error("Qualification archive must match the source package identity");
}
const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
const [original, registry, receipt, originalBytes, registryBytes] = await Promise.all([
  json(".worker-tmp/original/release.json"),
  json(".worker-tmp/registry/release.json"),
  json(".worker-tmp/registry/receipt.json"),
  readFile(resolve(".worker-tmp/original", file)),
  readFile(resolve(".worker-tmp/registry", file)),
]);
assertRegistryRelease({ repository: process.env.GITHUB_REPOSITORY ?? "", source: process.env.GITHUB_SHA ?? "",
  runId: process.env.GITHUB_RUN_ID ?? "", name: metadata.name, version: metadata.version, file },
original, registry, receipt, originalBytes, registryBytes);
process.stdout.write("Original archive, registry archive and complete receipt match this source and release run\n");
