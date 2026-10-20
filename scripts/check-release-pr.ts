import { readFileSync } from "node:fs";
import { releaseCommand, releaseNpmEntrypoint, releaseRepository } from "./release-candidate.ts";
import { qualifyReleasePr } from "./release-pr.ts";

interface PullRequestEvent {
  pull_request?: {
    base: { ref: string; sha: string; repo: { full_name: string } };
    head: { ref: string; sha: string; repo: { full_name: string } };
  };
}

if (process.env.GITHUB_EVENT_NAME !== "pull_request" || process.env.GITHUB_REPOSITORY !== releaseRepository || !process.env.GITHUB_EVENT_PATH) {
  throw new Error("Release PR qualification requires this repository's authenticated pull_request event");
}
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) as PullRequestEvent;
const pr = event.pull_request;
if (!pr || pr.base.ref !== "main" || pr.head.ref !== "changeset-release/main"
  || pr.base.repo.full_name !== releaseRepository || pr.head.repo.full_name !== releaseRepository) {
  throw new Error("Unexpected release PR repository or branch");
}
const root = process.cwd();
const assertCurrent = (): void => {
  const refs = releaseCommand("git", ["ls-remote", "--refs", "origin", "refs/heads/main", "refs/heads/changeset-release/main"], root).toString("utf8").trim().split("\n");
  if (refs.length !== 2 || !refs.includes(`${pr.base.sha}\trefs/heads/main`) || !refs.includes(`${pr.head.sha}\trefs/heads/changeset-release/main`)) {
    throw new Error("Release PR is stale against live main or its current generated branch; regenerate and rerun current CI");
  }
};
assertCurrent();
qualifyReleasePr(root, pr.base.sha, pr.head.sha, releaseNpmEntrypoint());
assertCurrent();
process.stdout.write(`Release PR independently qualified: ${pr.base.sha} -> ${pr.head.sha}\n`);
