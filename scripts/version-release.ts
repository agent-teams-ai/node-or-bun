import { appendFileSync } from "node:fs";
import {
  captureRelease,
  releaseCommand,
  releaseNpmEntrypoint,
  versionRelease,
} from "./release-candidate.ts";

const root = process.cwd();
const source =
  process.env.RELEASE_SOURCE_SHA ??
  releaseCommand("git", ["rev-parse", "HEAD"], root).toString("utf8").trim();
const prepared = captureRelease(root, source, releaseNpmEntrypoint());
const changed = prepared.expected.plan.releases.some(
  (release) => release.oldVersion !== release.newVersion,
);
if (process.argv.slice(2).some((argument) => argument !== "--status")) {
  throw new Error("Unsupported release option");
}
if (process.argv.includes("--status")) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `has_release=${String(changed)}\n`);
  }
  process.stdout.write(
    `${JSON.stringify({ source, hasRelease: changed, plan: prepared.rawPlan }, null, 2)}\n`,
  );
} else {
  const result = versionRelease(prepared);
  process.stdout.write(
    `${JSON.stringify({ source, hasRelease: result.changed, report: result.report }, null, 2)}\n`,
  );
}
