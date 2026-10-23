# Release checks integration with current main: 2026-10-23

The preparation branch was integrated with current main without rewriting its
history. The merged implementation passes the current Stack Toolchain checks
and all **29 release tests** in an owned disposable TEST checkout. A separate
run starts from the actual current `0.2.3` manifest: Changesets generates
`0.2.4`, the release Host accepts it, and the existing build, pack and installed
consumer checks pass for Node, native Bun and Node inside Bun.

This is local integration evidence. The public exact leaf coordinate still
returned HTTP **404** on 2026-10-23, so its registry lock, final-head CI, owner
merge and public release remain pending.

## Accepted source and integration boundaries

The public refs were reread immediately before this record:

| Ref | Exact commit |
| --- | --- |
| Preparation `feat/release-checks` | `58023cd53578fc5ebc449933460f58cf90efb0f3` |
| Current `main` | `b000bbdaf5ffe1bfa87f2b5ef8f6f03625c5cff2` |

The current main package version, published changelog, product source,
development-only `stack-toolchain@0.1.0`, publisher implementation and
`release.yml` were preserved. The installed-consumer qualifier is byte-identical
to main, including its current-manifest archive selection and Stack compilation.
All five main CI jobs and its lint/format gates remain present.

The three merge conflicts were the manifest, lock and installed-consumer
qualifier. Actual npm 11.20.0 generated the Changesets dependency closure from
the current main lock in a separate owned TEST directory. All **95** preexisting
non-root package records are unchanged; **39** genuine Changesets closure
records were added. Both production lock root versions remain `0.2.3`.

The intended production dependency remains exactly
`@agent-teams/release-checks@0.1.0`. Its root lock entry and package record are
deliberately absent until the actual public package can be installed. The TEST
manifest omitting that unpublished leaf was used only to resolve the newly
required published Changesets closure; no invented URL, integrity or local
archive reference was copied into production metadata. Production `npm ci`
and adoption are not claimed at this checkpoint.

Current main introduced typed lint and formatting after the original preparation.
The first integration run found 100 lint errors and five unformatted new TS
files. These five files were corrected under the existing configuration; no
exclusion or suppression was added. JSON and Git mode assertions now use actual
guards, tree collectors retain null prototypes, PR event parsing reuses existing
owner helpers, and cleanup preserves both operation and cleanup failures. A
final explicit `LeafShape` annotation fixed the resulting type widening.

The generated-archive regression invokes the current owner `npm run build`
script. Independent GPT-6.1-sol xhigh review inspected the integration and then
the guard/cleanup changes; neither final review found a blocking issue. Local
review does not replace the required remote review and exact-head CI.

The current repository instructions and canonical organization quality standard
were read at organization main
`dcdc2838c377e90995eb6e35364a84b6684d376a`.
The [2026-10-20 record](../release-checks-20261020/README.md) is retained unchanged.

## Actual installed TEST candidate

The current built Foundation leaf was packed with actual npm without altering
its source version. Only the owned disposable TEST consumer manifest replaced
the intended dependency with an absolute `file:` reference to these real bytes,
then npm installed it with lifecycle scripts disabled.

| Archive fact | Observed value |
| --- | --- |
| Filename | `agent-teams-release-checks-0.0.0.tgz` |
| Package | `@agent-teams/release-checks@0.0.0` |
| Size | `24718` bytes |
| SHA-256 | `57d23d281697ee349065508d2b6c2b5436cf2f598009fda9ac7754308796f1f3` |
| npm integrity | `sha512-287Y8hoH4oNwbiNKpPHotUf65+eB3cNZHpPl9iVj7Pg0uSdTDoT9z4iGHeWR4LWhqrzyen7ZB1/OEmBl8AhMOQ==` |

This archive is a local TEST input, not the canonical CI writer, bootstrap
publication or public registry adoption evidence. No production version or
changelog was edited for this qualification.

## Commands and observed results

The actual toolchain was Node **26.11.1**, Bun **1.4.3**, npm **11.20.0**,
Stack Toolchain **0.1.0**, TypeScript **7.0.2** and Changesets CLI **3.0.2**.

| Gate | Result |
| --- | --- |
| `verify-toolchain` | Passed |
| `typecheck` | Passed through Stack Toolchain's `tsrs` engine |
| `lint` | Passed, 0 warnings and 0 errors |
| `format:check` | Passed |
| Installed common conformance | 12 passed |
| Real engine, custody, tree, replay and generated-archive Host tests | 9 passed |
| Current main publisher policy tests | 8 passed |
| `test:release` total | 29 passed, 0 failed, 0 skipped |
| Fresh current-source `release:status` | Official plan: `0.2.3` to `0.2.4` |
| Fresh current-source `release:version` | Passed, no diagnostics |
| Generated `0.2.4` `build`, `pack` and `qualify` | Passed for installed Node, native Bun and Node inside Bun |

The fixed `0.2.2` to `0.2.3` fixture remains a valid independent regression.
It is separate from the fresh current-source run above. That fresh run used
owned TEST source commit `379f628fae9f2101e7ce36eddb579b87d00aaba9` with only TEST
dependency metadata. The complete official plan, consumed intent, exact
generated changelog and matching root lock updates passed the unmodified Host
guards. Only the intent, changelog and two package metadata files changed.
The generated TEST archive SHA-256 is
`4645783156fb87db362ce908d353fd0681102200e6142a3dee7902ae751ae7a3`.

The complete final command output is retained in
[qualification.log](qualification.log), SHA-256
`45d4625c5e07cc8d0fb6e6766425c269e5e2d5081775cb2e1f5f2030af567064`.
This checkpoint does not claim a full native source suite rerun, a production
install, GitHub CI, npm publication or `latest` promotion.

## Checked source snapshot

These hashes identify the checked implementation before this record was added.
Scripts, tests and workflow bytes in the TEST checkout matched these files.
The production manifest and lock describe the pending public adoption state.

| Source file | SHA-256 |
| --- | --- |
| `scripts/release-candidate.ts` | `e8ad53a3d26e336328516efbfeed68195558ef5263a6e6940800e15be0e6625c` |
| `tests/release-candidate.test.ts` | `b53bc4e673482ef7847cf3aaae898426c7e7eada24ce5afb18e7d85f6a4d14e9` |
| `scripts/release-pr.ts` | `fbe314d933518ef9775b63b88d445d8140d0faaa0ce670ece6ff31267447b551` |
| `scripts/check-release-pr.ts` | `f3bc00b4d4c184ccc9bb0b8bd10f22e2a7a426775f68b499619a38724ad972fb` |
| `scripts/version-release.ts` | `9fb9779bd11935d19f09e8608f6a27c79a635a466b302d61f0fdb033881b4467` |
| `scripts/qualify-installed-consumer.ts` | `6a6623e5d8f8989e8937517312c47d75da58e56ac18a5de13aff33c7cd64ef11` |
| `.github/workflows/ci.yml` | `040d7ca6ae8bd2b368847ec488f84d546bc34f3f1e6b8f8db75db8ef386e7f24` |
| `.github/workflows/version.yml` | `ac0011d326703e85bdd2f0d4a0a76758fa0bb155258279306de3851fe4cf234d` |
| `.changeset/config.json` | `0b06d7c0bb2f8107e4adfd80dd70327df8d85c67693fd24401e459d5807a774b` |
| `package.json` | `2efa27db91ee49d6fb3cb6e3e0687d10b1df0386323bde263ad326b4ced2157a` |
| `package-lock.json` | `41776abc0c6d9729bd95c9b5e9e1b99606cdd37b01bfeedf9e6e39160b91ddcc` |

## Remaining public path

After Foundation publishes the exact public leaf, install that version using
actual npm and commit its real lock record. Then run current-head native CI and
independent owner review before merging the implementation. Changesets must
derive the release again from the then-current main; the TEST `0.2.4` observation
does not authorize copying a version or changelog. Complete the reviewed owner
release PR, exact-source archive publication and reconciliation, registry
readback, installed Node/Bun/Node-in-Bun qualification and `latest` promotion
through the existing release workflow.
