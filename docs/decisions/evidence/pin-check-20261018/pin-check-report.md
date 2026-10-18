# Standards pin check — 2026-10-18 (plan v4 §6)

Command outputs of the admission-time pin check via `gh` / local clones.
All current SHAs read 2026-10-18 (T09:2x–10:4xZ). Saved pins are the ones named
in plan v4 §6 (`f9f4c8…`, `7d6535dd…`, CMS `859fbca1…`).

## Current SHAs vs saved

| Source | Current (2026-10-18) | Saved | Delta |
| --- | --- | --- | --- |
| Foundation main | `43dbe80844ac639573019312a72393156549714d` | `59f49ea55` (train 0.5.0 revision-4.2 head) | YES — 13 commits, 136 files, +5230/−220 (full diff saved) |
| GetModular main | `ccd815eac780b603a4cb6d01d07c995348c7b0f5` | `7d6535dd…` | YES — 20 commits, 754 files, +50854/−947 (full diff saved) |
| GetModular CMS doc `docs/architecture/common-assembly.md` (complete-document SHA-256) | `e5cb510c5ea83e54a6833cc40b6ad31fc5cf8c70d9838e4e0c6923edc6f70919` | `859fbca1e8a0c61b6ae873bea0057735a55b80230100e6e73a74de22e123165a` | YES — +504/−139 on the document (full diff saved) |
| EQS (`agent-teams-ai/.github` main; repo carries `docs/engineering-quality-standard.md`) | `f5653f5630057524a4ee44e50c16e138442a9b42` | `f9f4c8a` | YES — 1 commit, 6 files, +926/−5 (full diff saved) |
| EQS separate pin `66d6d3d` | `66d6d3d` = "feat(governance): stage Node 26 portable authority successor", ancestor of `f5653f5` | `66d6d3…` | UNCHANGED — pin resolves, content identity preserved |
| agent-architecture-standard main | `4d19cece3b40c28eb8756b79f96ba1577af0b449` | `2fda5ffd7` | saved pin does not resolve — neither local clone nor GitHub API returns a commit (`HTTP 422 No commit found for SHA`); recorded as unresolved, no freshness claim made |

## Delta contents read in full

1. GetModular `7d6535dd..ccd815ea` — 20 commits. Boundary-relevant: `bcd4c9a`
   revised the Consumer Module Standard and added the module authoring guide;
   `2f33631`/`ab41023`/`ca879f7` added Assembly module entries + static groups
   and the conformance wiring oracle / module layout checks (ADR-0036,
   ADR-0037); `99816e4` prepared Core/Assembly 0.5.0 and conformance 0.3.0;
   the rest is research docs, tests and codemods.
2. CMS document diff (saved `common-assembly.diff`) — confirms at the current
   pin: Host owns permissions, readiness, lifecycle decisions and cleanup
   authority; fixed library dependencies and private helpers inside a cohesive
   feature remain static imports and typed factories and are not graph nodes;
   static profile lists are the standard ("a variant is a separate root with its
   own `profileId`"), so static selection is inside the CMS, not against it;
   FMS v1 identity unchanged (blob `d0bfff20…`, SHA-256 `851653f9…`) with a
   published successor v1.1 (blob `bd949a9a…`, SHA-256 `cfa088ef…`) that a
   consumer follows only when its profile pins it.
3. EQS `f9f4c8a..f5653f5` — publishes Feature Module Standard v1.1
   (`docs/architecture/feature-module-standard/v1.1.md`, sub-features and
   composition contracts) and ADR-0010; the EQS canonical table now lists v1
   and v1.1 with "the consumer's local adoption profile owns its exact scope".
   FMS v1 stays the pinned authority for this work.
4. Foundation `59f49ea55..43dbe808` — 13 commits (docs Node-26 qualification,
   bounded source graph facts, etc.). Adoption-relevant items remain the
   F1-corrected surface already integrated in PR 393.

Historical ADRs are not rewritten; this record and the boundary classification
are additive evidence.
