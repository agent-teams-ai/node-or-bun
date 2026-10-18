# Changelog

## 0.2.0 - 2026-10-17

- Rename the package to `node-or-bun` while preserving `.`, `/node`, `/bun`,
  and `/testing`.
- Apply the fixed facts-outside lifecycle and cancellation semantics to the
  native Node.js and Bun adapters.
- Preserve classifier facts and bounded-output guarantees without exposing a
  recursive runtime-error array.
- Rewrite synthetic cancellation conformance and document observable cleanup
  guarantees and explicit limitations.
- Add the 0.1-to-0.2 migration guide.
- Pin `@agent-teams/engineering-foundation` `1.7.4` as an exact development
  dependency; production dependencies remain empty.

## 0.1.0 - 2026-10-14

- Add the neutral process contract and `createProcessExecutor`.
- Add explicit Node.js and Bun native adapters.
- Add shared conformance coverage for capture, cancellation, timeout, cleanup,
  invalid output, and bounded stream behavior.
- Add typed build, package qualification, and reviewed-main GitHub OIDC release
  workflow preparation.
