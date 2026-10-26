# Change intentions

Record a public package change with the pinned Changesets CLI. Changesets owns
version selection and changelog generation. The release Host checks the complete
generated candidate before an owner creates or merges the version pull request.

Development dependency and script changes affect this package's published root
manifest and require an honest metadata release even when runtime behavior is
unchanged. See [npm releases](../docs/releases.md) for the owning procedure.
