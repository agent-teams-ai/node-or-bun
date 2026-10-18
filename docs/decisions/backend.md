# Backend decision: variant N (native Node and Bun)

Status: accepted. Decided 2026-10-17 under the rule recorded in advance in
plan v4 section 2.4. The decision owner is root per artifacts; no further
agreement is required after plan v4 admission. This file is the observable
record required by plan v4 acceptance item 1; the same decision is summarized
in `docs/plan-scope.md`.

## Context

Plan v4 section 2 compared two bounded variants while keeping native `/bun`:

- Variant N: the existing native Node and native Bun adapters, changed only by
  the shared section 3.2 classifier and section 3.3 lifecycle.
- Variant E: the Node API path implemented through Execa run-to-result capture
  (`encoding: "buffer"`, explicit `maxBuffer`, `stripFinalNewline: false`),
  with native Bun keeping its own capture.

## Input facts as executed (2026-10-17)

Recorded from `package-lock.json` and `npm ls --all --json` during the
comparison run:

- Execa version `10.1.1`, engines `node >=22`.
- Direct dependencies: 12. Closure: 17 packages (18 including Execa itself).
  Transitive-only: 5.
- `cross-spawn` is absent from the actual installed graph and unreachable, so
  its Windows behavior is not applicable to this comparison.

## Mandatory case matrix (section 2.2)

Cases 1-8 passed on both variants in both default and managed forms: overflow
while alive, forced EOF, leader exit while a child holds the pipe, pre-abort,
abort during work, timeout versus late capture error, authoritative cleanup,
and setup rollback. Case 10 (E-only early-close regression guard) passed on
Execa Node. Case 9 (Windows wrapper/Job behavior) is draft-only: the delta
typechecks, native Windows execution was pending, and no pass is claimed for
it. Linux evidence covers neither native Windows nor native macOS.

## Rule application and decision

Under the section 2.4 rule, E is accepted only if every section 2.2 case
passes on both paths without private APIs or forks, and E has fewer own states
and duplicated mechanics than N once the second (Bun) capture implementation,
the early-cleanup bridge, the Windows prepare-spawn-attach-handoff refactor,
the 12+ dependency closure, and Execa Bun-compat risk are counted.

E keeps native Bun capture alongside Execa capture, which is duplicated
capture and arbitration mechanics — an explicit choose-N condition in the
rule. E also adds a 17-package closure where N has zero production
dependencies, and case 9 remained unexecuted natively.

Decision: **N**. The accepted change-set is the native Node and native Bun
adapters carrying the shared section 3.2 classifier and section 3.3
lifecycle. Variant E is not accepted: no Execa dependency and no `/execa`
subpath exist in the package, and the production `dependencies` key is
removed (zero production dependencies).

Reconsideration requires a new fact, for example Execa gaining spawn
injection. Infrastructure failure during the comparison never counted against
Execa; the comparison executed to completion.

## Evidence

- Comparison run `prc-lib-20261014-ne-a2` (report, `dependency-facts.json`,
  `dependency-closure.json`, case matrix) staged in the immutable review
  archives of the `bun-process-v1` workstream on the worker host.
- CI artifacts for this repository: conformance on macOS, Ubuntu, and Windows,
  node24-compat, and package-artifact, green on merge commit `e6fbf257f4`.
