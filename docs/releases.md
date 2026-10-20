# npm releases

Change `package.json` and its lockfile version in a reviewed pull request when
shipping a new version. A successful main push `ci` run triggers `release`.
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
