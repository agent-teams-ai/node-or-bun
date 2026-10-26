# npm releases

## Version generation and owner PRs

Add an owning `.changeset/*.md` with the intended package change to the reviewed
implementation PR. Changesets 3.0.2 is the sole version engine for the public
root package. For example, development dependency or script changes affect the
packed root manifest and require a truthful metadata patch; they do not imply a
runtime behavior change. Do not hand-edit a release version or its changelog.

After that PR reaches main, `version` reads the full official Changesets plan.
A plan with no actual release exits immediately and retains empty intents. A
real plan runs pinned Changesets/action 1.9.0 with the version-only
`npm run release:version` command. The Host captures the source after the
action's admitted branch reset, runs the captured Changesets entrypoint, then
runs the captured npm 11.20.0 entrypoint with
`install --package-lock-only --ignore-scripts --no-audit --no-fund`. This order is
required: Changesets updates the root manifest but leaves both lockfile root
version fields unchanged. The Host allows only those two matching metadata
updates; dependency graph or other lock changes reject the candidate.

The independent development package `@agent-teams/release-checks` compares the
frozen official plan with all observed manifests, consumed intents, source
bindings and file changes. It has no dependency on Engineering Foundation and
is never imported by product runtime code. This repository retains ownership
of Git and actual installation custody, changelog history and summaries, npm
locks, CI evidence, archives, publishing and promotion. The single public root
is explicitly versioned and included in the inventory. Private/workspace or
prerelease configurations require a separately qualified owning change.

Organization and repository Actions PR creation/approval remain **false**.
The action can leave a checked `changeset-release/main` branch and then fail
when attempting PR creation. The active owner agent inspects that exact branch
against current main, opens its owner PR using the established owner protocol,
and reruns the failed current-input workflow when necessary. Existing PRs can
be updated by subsequent action runs. There is no automatic PR approval,
automatic merge, publisher or registry credential in this version workflow.

Each conformance CI lane independently replays a release PR from its
authenticated base SHA in an owned disposable TEST checkout with a fresh
`npm ci`. It reads the complete actual candidate Git tree at the event's head,
checks the shared relations and exact regenerated changelog, and requires live
main and the generated branch to retain those same SHAs before and after the
check. A stale candidate must be regenerated; a candidate's own version or
claimed source is never the expected version authority. Every implementation
and release PR still needs independent technical review, the complete relevant
CI and the canonical owner merge guard.

The local `npm run release:status` and `npm run release:version` commands require
the exact clean accepted Git source, Node 26.11.1, Changesets 3.0.2 and npm
11.20.0. They retain no release authority outside the invocation. The latter
changes source files and leaves the checked result for owner review; it does
not commit or push. `npm run test:release` runs the common installed-library
conformance and real engine/Host rejection fixtures alongside the existing
publisher policy tests.

## Exact-source publication and recovery

A successful main push `ci` run triggers `release`.
The release workflow validates all product CI jobs at the identical source SHA,
then downloads the original `node-or-bun-release-candidate` archive by artifact
ID and verifies its digest. Every required job and the artifact must belong to
the successful current CI attempt; the artifact must have been created after
that attempt started. A partial CI rerun cannot reuse older attempt evidence.
It never rebuilds the release archive or generates version bumps. After CI
validation, automatic scheduling reads the source version and npm's exact
version and `latest`. It skips when that version is already published as
`latest`, and releases when it is missing or `latest` is older. This also catches
a release commit followed by a docs commit before the release commit's CI
finished. Registry failures fail the run; they never count as absence. An
automatic run refuses to move a newer `latest` back to the source version.

The pinned organization workflow publishes with npm Trusted Publishing under
the `npm` environment, initially using a candidate tag. It reconciles an
already published version only when registry bytes match the retained archive.
Pin both reusable calls to a reviewed commit delivered on the central repository's
main branch. Verify that Actions resolves the pin in a TEST caller before
rollout; contents API access to a former pull-request head is insufficient.
Consumer verification first matches both manifests, the complete receipt,
source SHA, release run and archive hashes against the original retained bytes.
It installs those downloaded bytes with lifecycle scripts
disabled and qualifies Node, native Bun, and Node inside Bun. Only successful
verification allows the organization workflow to promote `latest`. Jobs that
check out this repository have no OIDC permission. No npm token is required.

To complete a failed publication/verification attempt or qualify the current
published version, dispatch `release` on main. Manual dispatch always reconciles
the archive, including when the version is already `latest`. It requires successful complete
main push CI for that exact source. A stale automatic CI completion is skipped
when main has advanced; dispatch against current main after its CI succeeds.
Concurrent releases are serialized without cancelling an in-flight release.
Every attempt retains its own original archive, manifest, registry archive and
receipt. A byte mismatch fails and requires investigation; an existing npm
version is never overwritten or treated as proof of qualification.

The unsupported `@agent-teams/process-runtime` namespace bootstrap artifact
remains outside this release path. Public package identity and API
remain `node-or-bun` and its existing subpaths.

## Current adoption checkpoint

The consumer now records the exact public
`@agent-teams/release-checks@0.1.0` development dependency and its authentic npm
registry URL and integrity. Actual npm 11.20.0 generated the lock, and a fresh
`npm ci --ignore-scripts --no-audit --no-fund` installed the public package.
The complete parsed lock graph changed only by that exact leaf package record
and its root development dependency; the root remains `0.2.3`.

The [2026-10-26 adoption record](decisions/evidence/release-checks-20261026/README.md)
retains the public package/source binding, current local checks and remaining
delivery gates. The historical
[2026-10-23 preparation record](decisions/evidence/release-checks-20261023/README.md)
and [2026-10-20 record](decisions/evidence/release-checks-20261020/README.md)
remain unchanged and describe their original TEST-only checkpoints.

Exact final-head native CI, technical review and implementation merge remain
pending. Changesets must derive the metadata patch from the then-current accepted
main; the earlier TEST `0.2.4` observation does not authorize copying a version
or changelog. The official version PR, exact-source archive publication and
reconciliation, registry readback, installed Node/Bun/Node-in-Bun qualification
and `latest` promotion remain separate required evidence. An automatic
same-version skip is not reconciliation or publication proof.
