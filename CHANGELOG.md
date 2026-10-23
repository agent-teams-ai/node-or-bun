# Changelog

## 0.2.3 - 2026-10-23

- Adopt exact published `stack-toolchain@0.1.0` for development typecheck, lint,
  formatting checks and TypeScript compilation. Runtime-specific types and native
  Node/Bun conformance remain owned by this repository.
- Keep Stack Toolchain and Engineering Foundation out of production dependencies;
  the public process API and runtime guarantees remain unchanged.
- Resolve the explicitly qualified Bun test runtime independently of optional
  development tool binaries and derive the default qualification archive from
  the reviewed package version.

## 0.2.2 - 2026-10-20

- Align repository metadata and documentation links with the GitHub repository
  rename to `agent-teams-ai/node-or-bun`. The npm name and public API are unchanged.

## 0.2.1 - 2026-10-18

- Preserve bounded, successfully decoded stdout/stderr on
  `ProcessRuntimeError.output` so consumers can classify late observed exits
  without losing captured content. The nullable pair is copied, frozen and
  non-enumerable; error messages and ordinary error JSON do not include it.
- Keep first-cause settlement and capture/decode failure facts unchanged.
- See the [0.2.1 migration note](https://github.com/agent-teams-ai/node-or-bun/blob/main/docs/migration-0.2.0-to-0.2.1.md).

## 0.2.0 - 2026-10-18

- Breaking: after a timeout or cancellation, late exit codes and decode
  failures no longer settle the result; they are reported in
  `ProcessRuntimeError.facts`. See the [migration
  guide](https://github.com/agent-teams-ai/node-or-bun/blob/main/docs/migration-0.1-to-0.2.md).
- Rename the package to `node-or-bun` while preserving `.`, `/node`, `/bun`,
  and `/testing`.
- Apply the fixed facts-outside lifecycle and cancellation semantics to the
  native Node.js and Bun adapters.
- Preserve classifier facts and bounded-output guarantees without exposing a
  recursive runtime-error array.
- Rewrite synthetic cancellation conformance and document observable cleanup
  guarantees and explicit limitations.
- Add the 0.1-to-0.2 migration guide.
- Remove the empty `dependencies` key; there are zero production dependencies.
  No dependency on Engineering Foundation is added (repository policy); the
  section 3.4 consumer-profile gap stays recorded in `docs/plan-scope.md`.

## 0.1.0 - 2026-10-14

- Add the neutral process contract and `createProcessExecutor`.
- Add explicit Node.js and Bun native adapters.
- Add shared conformance coverage for capture, cancellation, timeout, cleanup,
  invalid output, and bounded stream behavior.
- Add typed build, package qualification, and reviewed-main GitHub OIDC release
  workflow preparation.
