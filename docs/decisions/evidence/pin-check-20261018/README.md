# Pin-check evidence — source and link manifest

The upstream snapshots (`common-assembly.current.md` and all `*.diff` and
`*.log.txt` files) are byte copies of their sources, verified by `SHA256SUMS`;
they are evidence snapshots and are not rewritten for this repository.
Exceptions in this directory: `README.md` is this manifest (local metadata),
`SHA256SUMS` is the checksum manifest of the snapshots, and
`pin-check-report.md` is local command output of the pin check, not an upstream
copy.

## Sources

| File | Source (resolve relative links here) |
| --- | --- |
| `common-assembly.current.md` | `https://github.com/agent-teams-ai/get-modular/blob/ccd815eac780b603a4cb6d01d07c995348c7b0f5/docs/architecture/common-assembly.md` |
| `common-assembly.diff` | `https://github.com/agent-teams-ai/get-modular/compare/7d6535dd...ccd815ea` (document path) |
| `get-modular-7d6535dd..ccd815ea.diff` | `https://github.com/agent-teams-ai/get-modular/compare/7d6535dd...ccd815ea.diff` |
| `get-modular-log.txt` | same compare range, `git log --oneline` |
| `org-github-f9f4c8a..f5653f5.diff` | `https://github.com/agent-teams-ai/.github/compare/f9f4c8a...f5653f5.diff` |
| `org-github-log.txt` | same compare range, `git log --oneline` |
| `engineering-foundation-59f49ea55..43dbe808.diff` | `https://github.com/agent-teams-ai/engineering-foundation/compare/59f49ea55...43dbe808.diff` |
| `engineering-foundation-log.txt` | same compare range, `git log --oneline` |

## Broken relative links in the snapshot

`common-assembly.current.md` is the CMS document exactly as it exists at the
pinned commit, so its relative references (`../decisions/…`,
`../../packages/…`, `../guides/…`, `feature-module-standard.md`) are relative
to `docs/architecture/` in the GetModular repository at pin `ccd815ea`. To
follow any of them, prefix the relative path with

`https://github.com/agent-teams-ai/get-modular/tree/ccd815eac780b603a4cb6d01d07c995348c7b0f5/docs/architecture/`

For example `../decisions/0036-…md` resolves to
`https://github.com/agent-teams-ai/get-modular/tree/ccd815eac780b603a4cb6d01d07c995348c7b0f5/docs/decisions/0036-…md`.
The FMS v1.1 link inside the document already points at the pinned EQS blob
(`f5653f5630057524a4ee44e50c16e138442a9b42`) and needs no adjustment.

No snapshot bytes are modified by this manifest.
