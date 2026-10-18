# Modularity boundary classification (plan v4 section 6)

Status: evidence record, additive. Historical ADRs are not rewritten by this
document. This is not a claim of conformance to the agent-architecture-standard;
that repository was read only and no conformity statement is made.

## Pin check (2026-10-18)

Current SHAs were read through `gh` and local clones; deltas against the saved
pins (`f9f4c8…`, `7d6535dd…`, CMS `859fbca1…`) were read in full and the bytes
saved. Freshness is not asserted in advance.

| Source | Current | Saved | Delta |
| --- | --- | --- | --- |
| Foundation main | `43dbe80844ac639573019312a72393156549714d` | `59f49ea55` | yes, 13 commits (full diff saved) |
| GetModular main | `ccd815eac780b603a4cb6d01d07c995348c7b0f5` | `7d6535dd…` | yes, 20 commits (full diff saved) |
| CMS document SHA-256 | `e5cb510c5ea83e54a6833cc40b6ad31fc5cf8c70d9838e4e0c6923edc6f70919` | `859fbca1…` | yes, +504/−139 (full diff saved) |
| EQS (`agent-teams-ai/.github` main) | `f5653f5630057524a4ee44e50c16e138442a9b42` | `f9f4c8a` | yes, 1 commit (FMS v1.1 + ADR-0010) |
| EQS pin `66d6d3d` | resolves, ancestor of `f5653f5` | `66d6d3…` | unchanged |
| agent-architecture-standard main | `4d19cece3b40c28eb8756b79f96ba1577af0b449` | `2fda5ffd7` | saved pin does not resolve (HTTP 422); no freshness claim |

Evidence bytes and outputs: staging `registry/archives/review-inputs/
pin-check-20261018/` (SHA256SUMS verified). The CMS document was read at the
current pin (`ccd815ea`), path `docs/architecture/common-assembly.md`. The
Feature Module Standard v1 identity is unchanged (blob `d0bfff20…`, SHA-256
`851653f9…`); its successor v1.1 (`cfa088ef…`) applies only to a consumer whose
profile pins it, which this one does not.

## Boundary classification

Each real boundary is classified against the Consumer Module Standard (CMS) at
the current pin. Leaf helpers (`node-runtime-verifier`, the internal capture
machinery in `src/executor.ts`) are not graph nodes: they are fixed library
internals and are excluded from classification.

### 1. Neutral contract as the consumer port

- Path: `src/` public surface — `createProcessExecutor`, the executor/adapter
  contracts, and the four preserved subpaths (`node-or-bun`, `/node`, `/bun`,
  `/testing`).
- Contract: TypeScript types of the package itself; consumers own their ports,
  this package is a passive fixed library dependency.
- Owner: this repository (package `node-or-bun`).
- Conclusion: consumer port, static import. CMS agrees — "fixed library
  dependencies and private helpers inside a cohesive feature remain static
  imports and typed factories"; installing this package is not a CMS adoption
  claim. No Assembly entry, group or declaration is justified.
- Review trigger: the public surface gains an independently assembled
  capability, an alternative implementation selected at runtime, or a second
  production composition authority.

### 2. Backends as adapters

- Path: `src/` Node and Bun adapter factories (`/node`, `/bun`) with paired
  native `acquire`/`cleanup` hooks; `RunningProcess.cleanup`/`closeCapture`.
- Contract: the adapter surface of this package; hosts own POSIX groups,
  Windows Jobs, wrapper protocols and tree cleanup.
- Owner: this repository for the adapter contract; the Host for native custody.
- Conclusion: adapters behind the neutral contract. CMS boundary "backends as
  adapters" maps cleanly: no CMS value would be added — the seam is one fixed
  pair behind one contract, selected statically. No lifecycle kernel, resources
  package or registry is required (CMS: Host owns cleanup authority; passive
  construction needs no generic lifecycle manager).
- Review trigger: a third backend, backend selection at runtime, or backend-side
  lifecycle that the Host does not own.

### 3. Composition root in Foundation (backend + Host custody pair)

- Path: engineering-foundation adoption slice (PR 393, F1-corrected): the
  Foundation-side wiring that binds the chosen backend adapter with the Host
  custody pair.
- Contract: Foundation's adoption contract and its pinned policy files
  (`engineering-foundation.artifacts.json`, frozen lists, QGR v2 schema).
- Owner: engineering-foundation (composition authority is the profile owner).
- Conclusion: this is the one boundary where CMS composition (a single
  Core/Assembly composition root, consumer-owned ports) would offer real value
  *if* Foundation adopts Assembly there. At this pin the CMS gate that exists
  is `@get-modular/conformance` (`checkWiring`, `checkNamespaces`,
  `checkModuleLayout`, `smoke`, `isolate`). Whether it applies is decided when
  that root is built: if Foundation builds it with Assembly module entries, the
  existing gate is connected as a test check; no new checker is written and no
  runtime GetModular dependency is added to this package. Until then the root
  is Foundation-side pending work and no adoption is claimed here.
- Review trigger: Foundation starts assembling the root from module entries, or
  adds configurable inter-module relationships.

### 4. Static profile choice

- Path: the N/E backend decision (recorded in
  [backend.md](backend.md)) — N accepted by the pre-recorded rule of plan v4
  section 2.4; profile choice (Node/Bun default, Bun-default PR in phase 6) is
  static.
- Contract: plan v4 sections 2 and 5; decision record in this directory.
- Owner: plan owner (decision rule) / this repository (record).
- Conclusion: static selection is not an argument against Assembly. The CMS at
  the current pin explicitly supports static module lists ("a root that
  prepares with `{ profileId }` lists its modules statically … a variant is a
  separate root with its own `profileId`"). For these boundaries static choice
  simply does not need Assembly: one fixed mechanism, one selected profile, no
  runtime plugin discovery ("static composition does not imply runtime plugin
  discovery"). The value question is therefore decided per boundary above, not
  by the static nature of the choice.
- Review trigger: the profile stops being static (runtime backend selection,
  hot replacement, dynamically admitted modules).

## Gate decision

No existing CMS gate is applicable to this package's own boundaries: it has
zero production dependencies, no Assembly entries, and its tests are ordinary
Node/Bun conformance tests. The existing gate (`@get-modular/conformance`) is
applicable only to boundary 3 if and when Foundation assembles that root with
Assembly; at execution time its presence is verified and it is connected as a
test check there. No new checkers are introduced. A runtime dependency on
GetModular is not added to this package for adoption purposes.
