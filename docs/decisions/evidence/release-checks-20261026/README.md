# Public release-checks adoption: 2026-10-26

The prepared history at `f67df0056705ec4db782fd31c142eed2547cc5a7` now
contains accepted main `55655e8573d066ff8e3d38cf54de1c8d051e0ab0` through
history-preserving merge `4611930`. All three PR #12 toolchain identity files
were integrated without conflict. The product root stays `0.2.3`; no version
or changelog was copied from earlier TEST runs. Historical evidence is unchanged.

## Public input and installation

Exact public input: `@agent-teams/release-checks@0.1.0`, registry archive
`https://registry.npmjs.org/@agent-teams/release-checks/-/release-checks-0.1.0.tgz`,
integrity `sha512-bspWdQYc85GCvmR6fFn1wffHk6ZNRlY7ox288X7zN6yfzXbEE+a4WVPa3FU3TCaiZ6e2dqsiutgR3V0gZTPXjw==`.

The coordinating operator independently verified actual registry installation,
strict TypeScript 7.0.2, all 12 public conformance cases and npm signature audit
with empty invalid/missing lists. Its provenance binding identifies source
`23b5a885ba46a2b43b5715ce82db28fcf04f2175` and
[Foundation publication run 40187728694, attempt 1](https://github.com/agent-teams-ai/engineering-foundation/actions/runs/40187728694/attempts/1).
The non-secret operator summary is retained outside the repository in the
release-checks-resume-20261023/public-leaf-0.1.0-20261026 evidence directory.
This consumer record relies on that explicit operator audit for publication
provenance; it does not claim to repeat it.

Actual Node `26.11.1` and npm `11.20.0` generated the committed lock with
`npm install --package-lock-only --ignore-scripts --no-audit --no-fund`.
A whole parsed lock comparison against merge `4611930` confirmed only two
additions: the root exact leaf devDependency and the authentic leaf package
record. Every previous non-root record and every other lock field stayed equal.
Fresh `npm ci --ignore-scripts --no-audit --no-fund` succeeded (60 packages).
No local archive, guessed integrity or manual lock edit was used.

## Current checks and limits

- `verify-toolchain`: passed with Node 26.11.1, Stack Toolchain 0.1.0 and Bun 1.4.3.
  An initial attempt could not find qualified Bun on PATH; the successful retry
  explicitly used the installed `node_modules/@oven/bun-darwin-aarch64/bin/bun`
  (`--version` returned 1.4.3). No global runtime was changed.
- `typecheck`: passed through Stack Toolchain tsrs.
- `lint`: passed, zero warnings/errors.
- `format:check`: passed.
- `test:release`: 32 of 33 passed, including all 12 installed public conformance
  cases, real Changesets/lock checks, replay and generated-archive regression.
  One documentation fixture failed its clean-source precondition because the
  operator's global Git excludes file ignores `CLAUDE.md`; fixture `git add`
  omitted its deliberately created `.changeset/CLAUDE.md`. The guard correctly
  rejected that untracked source. This is an operator fixture-environment issue,
  not passing full-suite evidence. No global config or source guard was changed.
  A diagnostic rerun with command-scoped `core.excludesFile=/dev/null` passed
  all 33 cases. The trailing name filter in that npm-script invocation was not
  applied by Node, so this was a full diagnostic run. Two earlier retry launch
  forms were rejected by the Host npm-context/exact-engine guards; neither
  changed source or global configuration.
- The fixture now force-adds only its eight explicitly created documentation
  paths, preserving node_modules exclusion and every assertion. This makes its
  intended Git input independent of operator ignore files. Post-fix typecheck
  passes. The fixed documentation case passed alone under the ordinary operator
  ignore configuration (1/1). The final normal `npm run test:release` passed all
  33 tests with no failures, skips or cancellations. No Git excludes override
  was present in that final run. Lint and format checks also passed after the fix.

Heavy product build/conformance/pack/installed Node/Bun/Node-in-Bun qualification
is assigned to exact-final-head native GitHub CI. Technical review, implementation
merge and official Changesets version PR remain pending. The existing metadata
Changeset is the sole patch intent. Preserve Changesets 3.0.2 and publisher
`ff94f77116923d7842a37a8004a5f4e31d65201e`; no tool upgrade is part of adoption.
Public consumer installation alone does not prove a node-or-bun release.
Exact-archive OIDC publication/reconciliation, registry readback, installed
verification and latest promotion must follow `docs/releases.md`.

Final normal release-suite output: [release-tests.log](release-tests.log), SHA-256
`ceb04a81538d8ef52aa2bf826873aa55880bca73a200b9ff77f90226bdc836f1`.
[Parsed lock verification](lock-verification.json) retains the full-graph comparison result.

## Native Windows follow-up

PR #13 native Windows execution at `283b3b0` passed all 12 public leaf
conformance cases but rejected all nine actual Host scenarios at the same
repository-root string comparison. Linux passed. The captured error establishes
the failed comparison; differing Windows path spellings are an inference because
the original error did not log both paths.

The Host now compares actual directory objects using bigint `stat` device and
inode identity after resolving the caller and Git top-level paths. It rejects
non-directories and unavailable zero inode identity, and retains root identity
in execution custody. Captured root, Git/common directories, HEAD and engine
checks stay intact. No universal path case folding or foreign-root exception
was added. The existing foreign-root scenario additionally rejects a nested
`.changeset` caller root.

Node documents that [realpath performs no case conversion and canonical paths
need not be unique](https://nodejs.org/api/fs.html#fsrealpathpath-options-callback),
and defines [device](https://nodejs.org/api/fs.html#statsdev) and
[inode](https://nodejs.org/api/fs.html#statsino) identity fields. The change uses
bigint values to avoid precision loss. Typecheck, lint and format checks pass.
The three focused actual generation, source/Git-directory tamper and foreign-root
regressions pass (3/3, no skips); the latter includes the nested-root rejection.
Final native Windows CI remains required; a local macOS pass is not that proof.
