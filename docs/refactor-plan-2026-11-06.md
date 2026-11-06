# Bounded legacy and architecture refactor plan — 2026-11-06

Status: **implementation proposal (draft PR)**. The plan precedes production edits and may be narrowed by real CI and review evidence. Owner: this repository. Baseline: `main` at `5b52f1da342482ccc03ad7f9c11431421f38bc0a`.

## 1. Goal and sizing

Remove **confirmed** repetition and unnecessary indirection without weakening process ownership. The requested 10–20k-line refactor is a *ceiling/aspiration, not a minimum*: this is a small library. The checked-in inventory contains 91 files, with the production implementation concentrated in `src/executor.ts`, `src/adapters/{node,bun}.ts`, `src/internal/*.ts`, `src/contract.ts`, and `src/errors.ts`. Much of the larger repository footprint is retained historical evidence, release tooling, conformance tests, and the npm lockfile.

Prefer a smaller verified patch to manufactured churn. Do not delete code merely because a name looks old, and do not reinterpret intentionally preserved historical evidence as executable legacy.

### Success definition

* The Node and Bun native adapters preserve their independent OS-facing acquire/retain, observation, cleanup, and capture ownership.
* The already-shared, runtime-neutral mechanisms remain under one executor and narrowly scoped helpers.
* The redundant pieces targeted below disappear **only when** an equivalent implementation and regression evidence exist.
* All public exports, error codes, facts, launch semantics, and supported package subpaths remain unchanged.
* No new production dependencies, runtime adapter auto-detection, registry, service container, platform supervisor, command DSL, or Get Modular adoption.
* The changed files pass the existing cross-platform process E2E, typecheck, lint, format, pack, installed-consumer checks, and independent review before merge.

## 2. Baseline and architectural constraints

Documents read before the plan: `AGENTS.md`, central Engineering Quality Standard, `docs/process-contract.md`, `docs/plan-scope.md`, `docs/decisions/backend.md`, `docs/decisions/modularity-boundaries.md`, `docs/releases.md`, CI workflow, package manifest, and both adapter implementations.

| Boundary | Current responsibility | Treatment |
| --- | --- | --- |
| `src/contract.ts`, `src/index.ts`, `src/errors.ts` | Public runtime-neutral API, error and fact shapes | Freeze |
| `src/executor.ts` | Exactly one lifecycle coordinator, arbitration and closure | Freeze unless proven defect |
| `src/internal/capture.ts`, `classification.ts`, `input.ts`, `settlement.ts` | Shared byte capture, validation, outcome policy and settlement | Keep; no strategy hierarchy |
| `src/internal/termination.ts` | Fixed direct-child termination policy | May host a small common terminal-proof waiting primitive |
| `src/adapters/node.ts` | Native Node spawn, retain, observation, streams and cleanup | Keep distinct; only safe shared seams |
| `src/adapters/bun.ts` | Native Bun spawn, retain, observation, reader locking and cleanup | Keep distinct; only safe shared seams |
| `src/testing/conformance.ts` and `tests/` | Shared contract and real-process regression tests | Preserve; add focused coverage if required |
| `scripts/`, release workflows, changesets | Exact-source release and packaging control plane | No unrelated refactor |
| `docs/decisions/evidence/` | Historical pinned evidence and diffs | Do not modify or delete |

This repository's fixed library mechanism is deliberately **not** a Get Modular Assembly. Its consumer's composition owner may use Get Modular; adding Get Modular as a dependency here would create an unnecessary lifecycle authority and violate the accepted boundary record. DDD means keeping genuine domain decisions with the owning context, not inventing entities or aggregate roots around a process utility.

## 3. Proposed implementation slices

### A — deterministic spawn environment copy (medium priority, low behavioral risk)

Observed duplication: `defaultAcquire` in `src/adapters/node.ts` and `src/adapters/bun.ts` independently copy `process.env` excluding undefined values, or copy a supplied exact environment. The logic is the same and is not a native process operation.

* Extract exactly one small, pure, runtime-neutral helper under `src/internal/`. Pass the inherited environment as a parameter; **do not import** `node:process` into the neutral contract layer.
* Keep the actual `process.env` read at the adapter launch boundary. The helper must preserve own `__proto__` keys and avoid prototype-based merging.
* Neither inherit from the parent when the caller supplies an environment, nor introduce extra validation/policy at the adapter.
* Retain existing conformance: exact argv/cwd/environment, absence of inherited keys when explicit, frozen launch snapshot, preserved own `__proto__`.

Reject this slice if it changes how missing environment variables or unusual keys are handled on any supported OS.

### B — common terminal-proof wait (medium priority, medium lifecycle risk)

Observed duplication: Node and Bun `observeExit` each implement the same promise-versus-timeout mechanism for `waitForTerminal(timeoutMs)`. They differ in native exit proof, so only the **wait primitive** may be shared.

* Move the small, promise-based bounded wait into the existing `src/internal/termination.ts` (or keep local if diff-based review shows no gain).
* Keep Node's `exit` event and Bun's `child.exited` as distinct proofs. An error while the child may still be live is **not** terminal proof.
* Preserve cleanup order, existing 1,000 ms TERM/KILL steps, timer disposal, error identity, and direct-child-only limitation.
* No hidden retries, new timers, worker process, supervisor, or cross-platform lifecycle adapter.
* If the extraction increases timing risk or complexity, drop it rather than generalizing observation itself.

### C — remove demonstrably redundant Bun delegation (low priority, low risk)

`closeBunCaptureWithin` simply `await`s `closeBunCapture` without adding a deadline or any behavior. The underlying closure already uses bounded settlements.

* Inline its single call site and remove the pass-through function.
* Preserve the existing per-stream cleanup deadline, rejection aggregation, lock release, and rollback semantics.
* Do **not** rewrite Bun reader cancellation and settlement while removing the wrapper.

### D — verification and release metadata

* Add a patch Changeset for actual implementation changes, with no direct edits to `package.json` version, lockfile version or changelog.
* Add a focused regression test only for uncovered behavior. Do not copy the full conformance matrix into each adapter.
* Keep `package.json` subpaths `.`, `./node`, `./bun`, `./testing`, zero production dependencies, and strict TypeScript.
* Verify `README.md` / process contract only if a factual statement changed (none expected).

## 4. Explicitly out of scope

1. Replacing native Node/Bun with Execa, shell wrappers, worker threads, `get-modular`, or another execution engine.
2. Rewriting `src/executor.ts` into state-machine/DDD/framework classes or moving cleanup authority into a container.
3. Changing the error taxonomy, output limit (4 MiB per stream), timer budgets, strict UTF-8 contract, facts precedence, or observed nonzero exits.
4. Modifying release policy, signing, OIDC, arbitrary CI pin updates, dependencies, package exports or the toolchain profile.
5. Deleting or reformatting evidence bundles, migration plans, accepted ADRs, old test fixtures, or files with uncertain consumers.
6. Refactoring consumer projects, Foundation host custody, process-tree cleanup or native Windows Job Objects.
7. Feature flags or parallel compatibility APIs.
8. Artificially changing 10k lines to meet a target.

## 5. Review rounds on this plan

These are **adversarial analytical passes**, not a claim that separately hosted models have run. External independent PR review is an additional gate below.

**Round 1 — architecture + scope + dependency critic**
- Objection: A generic `RuntimeAdapter` superclass and Get Modular composition may look DRY but create a second lifecycle owner.
- Disposition: Reject them. Preserve the two real native adapters and the existing public port; share only proven identical, side-effect-free mechanics.
- Objection: A 10–20k LOC target exceeds the bounded responsibility.
- Disposition: Measure success in removed duplication and passed invariants, not changed line count.

**Round 2 — runtime/custody critic**
- Objection: Moving native terminal observation or rollback into a common base could mistakenly call an error a terminal state or claim incomplete cleanup as success.
- Disposition: Share only waiting on an already-established terminal proof; retain native observation and owned rollback separately. Do not touch capture close ordering.
- Objection: Timer replacement could alter the deadline and cause false cleanup success/failure.
- Disposition: No deadline-policy redesign. Verify the same existing timeout semantics and timeouts under native E2E.

**Round 3 — cross-platform + packaging critic**
- Objection: Inherited versus exact environments differ between Node and Bun, especially with unusual keys on Windows.
- Disposition: Keep snapshots at the adapter boundary and the helper platform-neutral, then qualify on Ubuntu, Windows, and macOS. Do not claim native coverage from local Linux alone.
- Objection: Refactoring release scripts along with runtime code hides regressions from package qualification.
- Disposition: Keep all release and package gates unchanged, add Changeset only, and test built installed artifacts.

**Remaining unknowns:** Real native Windows/macOS outcomes and independent reviewer findings are not established by this document. Any reviewer-discovered issue must be reproduced, bounded, fixed, and retested before completion.

## 6. Execution order and evidence

1. Confirm `main` baseline and no competing PR. Use a dedicated short-lived branch and a draft PR; each connector commit updates the remote branch immediately.
2. Commit **this plan before production edits**. Do not start implementation until plan critique is complete.
3. Apply A, B, C independently; minimize each diff. Preserve exact public contract.
4. Run GitHub PR CI: Node 24 compatibility; Node/Bun conformance on Ubuntu, Windows, macOS; Node-under-Bun; strict source/test/tooling typecheck; lint/format; release-policy tests; packed tarball and fresh installed consumer checks.
5. Inspect each failed job's actual log. Fix only confirmed regression, push, and repeat the affected CI path. Do not bypass, cancel or fake required checks.
6. Inspect the final PR diff and perform at least two code-critique passes focused on (a) behavior/custody and (b) API, dependency, packaging and test quality.
7. Seek actual independent technical review through the repository's approved route, address actionable comments, and rerun relevant CI. Self-critique alone does not fulfill the repo's independent-review rule.
8. Only after green required checks, settled reviews and no outstanding high-impact issue, consider ready/merge; verify the merged `main` SHA and completed main CI. Do not merge merely because the PR exists or an incomplete CI status appears green.

## 7. Acceptance matrix / stop conditions

| Concern | Acceptance evidence | Stop condition |
| --- | --- | --- |
| ABI/API | Untouched export map, neutral types, error/facts shapes | Public contract change without explicit decision |
| Custody | Setup rollback, direct-child SIGTERM/SIGKILL, observation failure and capture closure pass | Cleanup silently skipped or error priority changed |
| Output | 4 MiB per stream, overflow, invalid bytes, error output remain bounded | Unbounded capture or disclosure |
| Timing | Cancellation, timeout, EOF grace and deadlines retain precedence | Flaky or shorter native cleanup proof |
| Cross-platform | Required GitHub Node 24 and Node/Bun CI on Linux, Windows, macOS | Incomplete native matrix |
| Packaging | Build, `pack`, `qualify`, exact installed consumer smoke | Broken exports or runtime dependency creep |
| Quality | Strict TS, lint, format, technical review | Unsupported implementation or unresolved finding |

The plan is deliberately cancellable slice-by-slice: if a proposed extraction is not demonstrably simpler **and** equivalently safe, skip it. Do not broaden scope to reach the user’s stated line-count estimate.

## 8. Owner-authorized narrow follow-up — error aggregation (2026-11-06)

The owner subsequently requested additional cautious refactoring and improvement, without speculative changes. This appendix is an explicit **scope amendment before its implementation**. All earlier exclusions remain in force, except the deliberate narrow internal change described here.

**Verified duplication:** three existing sites — `src/executor.ts`, `src/adapters/node.ts` rollback, and `src/adapters/bun.ts` rollback — independently turn exactly two `Settlement<unknown>` values into either no failure, a single rejection reason, or `AggregateError(reasons, "cleanup and capture closure both failed")`. The same internal `rejectedReasons` already extracts rejections. These sites should not diverge in future error precedence.

**One narrow improvement:** add one pure, private helper in the existing `src/internal/settlement.ts` that returns **a reason-bearing object or `undefined` to indicate absence of any rejected settlement**. Preserve `{ reason: undefined }` for an actual rejection of `undefined`. Replace exactly those three duplicated reductions, retaining separate native operations, exception wrapping and custody authority.

**Do not:** migrate rollback orchestration, change error messages, add a new package/module hierarchy, change deadline policy, modify release tooling, normalize rejected `undefined` to a fabricated Error, or alter the number/order of cleanup operations.

**Critique A — lifecycle:** reducing all native rollback to one shared function would conceal OS-specific custody. Rejected; share *only* the already-identical pure reduction after native cleanup has settled.

**Critique B — failure fidelity:** using truthy/falsy tests on an aggregated reason would drop a genuine rejection of `undefined`. Therefore the helper distinguishes no rejected settlement from a rejected settlement containing `undefined`, and the conformance suite gains a single-failure sentinel case. The existing dual-failure case must also pass.

**Critique C — API and test cost:** the helper is internal and not part of `./testing` or package root exports. No new dependencies or release scripts are justified. One shared conformance regression is sufficient; every platform will exercise it without triplicating test harnesses.

**Acceptance:** all prior CI/review gates plus proof that single/double rejection order, initiating-cause precedence, `incompleteCustody`, and existing native setup rollback behavior remain unchanged. If the abstraction produces more code or weakens evidence, revert this follow-up instead of extending scope.
