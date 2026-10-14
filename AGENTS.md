# Agent instructions

This repository owns a production-importable process mechanism. It must not
depend on Engineering Foundation, Electron, or consumer business policy.

Before planning, implementing, or reviewing changes, read the canonical
[organization Engineering Quality Standard](https://github.com/agent-teams-ai/.github/blob/main/docs/engineering-quality-standard.md).
Apply Clean Architecture, SOLID, and DRY proportionally. Keep one lifecycle owner,
explicit Node/Bun adapter entrypoints, and runtime-neutral public contracts.
Do not add a service registry, general command DSL, supervisor, or desktop API.

Implementation follows the reviewed Process Runtime and Foundation Bun migration
plan supplied in the worker's task contract. That contract also supplies the full
Q instructions and applicable owner rules. Missing contract input must be reported,
not replaced by guessed requirements.

- Write new handwritten tooling and harnesses in TypeScript and typecheck them.
- Run process fixtures only in owned disposable TEST directories.
- Preserve bounded output, honest cleanup failures, cancellation and timeout
  precedence, and explicit limitations of direct-child ownership.
- Share conformance cases between adapters; do not duplicate tests at every layer.
- Use short conventional branches and Conventional Commits.
- Ordinary commits use author and committer `iliya <iliyazelenkog@gmail.com>`.
- Implementation changes require independent technical review and relevant CI
  before merge. The initial branch is a non-code admission baseline only.
- Supported releases are published by the reviewed GitHub-hosted OIDC workflow.
  Any namespace bootstrap is explicitly unsupported and separately reconciled.
- Never store credentials, local links, build outputs, or dependency directories
  in Git. Do not modify another agent's work.

The first implementation pull request must provide meaningful `check` and
adapter conformance commands, package qualification, and the corresponding CI.
Do not claim these commands exist in this baseline.
