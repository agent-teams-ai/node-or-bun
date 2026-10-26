import { readFileSync } from "node:fs";
import { releaseCommand, releaseNpmEntrypoint, releaseRepository } from "./release-candidate.ts";
import { qualifyReleasePr } from "./release-pr.ts";
import { jsonRecord, jsonString } from "./release-policy.ts";

if (
  process.env.GITHUB_EVENT_NAME !== "pull_request" ||
  process.env.GITHUB_REPOSITORY !== releaseRepository ||
  !process.env.GITHUB_EVENT_PATH
) {
  throw new Error(
    "Release PR qualification requires this repository's authenticated pull_request event",
  );
}
const event = jsonRecord(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")));
const pr = jsonRecord(event.pull_request);
const base = jsonRecord(pr.base);
const head = jsonRecord(pr.head);
const baseSha = jsonString(base.sha);
const headSha = jsonString(head.sha);
if (
  base.ref !== "main" ||
  head.ref !== "changeset-release/main" ||
  jsonRecord(base.repo).full_name !== releaseRepository ||
  jsonRecord(head.repo).full_name !== releaseRepository
) {
  throw new Error("Unexpected release PR repository or branch");
}
const root = process.cwd();
const assertCurrent = (): void => {
  const refs = releaseCommand(
    "git",
    ["ls-remote", "--refs", "origin", "refs/heads/main", "refs/heads/changeset-release/main"],
    root,
  )
    .toString("utf8")
    .trim()
    .split("\n");
  if (
    refs.length !== 2 ||
    !refs.includes(`${baseSha}\trefs/heads/main`) ||
    !refs.includes(`${headSha}\trefs/heads/changeset-release/main`)
  ) {
    throw new Error(
      "Release PR is stale against live main or its current generated branch; regenerate and rerun current CI",
    );
  }
};
assertCurrent();
qualifyReleasePr(root, baseSha, headSha, releaseNpmEntrypoint());
assertCurrent();
process.stdout.write(`Release PR independently qualified: ${baseSha} -> ${headSha}\n`);
