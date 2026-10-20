# Migrate from 0.1.0 to 0.2.0

## Package and imports

The package moved from `@agent-teams/process-runtime` to `node-or-bun`. The
four public subpaths are preserved and no new subpath was added.

```diff
-import { createProcessExecutor } from "@agent-teams/process-runtime";
-import { createNodeProcessAdapter } from "@agent-teams/process-runtime/node";
+import { createProcessExecutor } from "node-or-bun";
+import { createNodeProcessAdapter } from "node-or-bun/node";
```

Apply the same package-name change to `/bun` and `/testing` imports. The
repository was subsequently renamed to `agent-teams-ai/node-or-bun`; the
old GitHub URL redirects to the new repository.

## Cancellation and result semantics

0.2.0 applies one fixed facts-outside rule:

1. A cleanup error or forced capture close after the EOF deadline wins and
   retains the initiating cause and incomplete-custody fact.
2. Otherwise the first initiating timeout, cancellation, capture/overflow
   error, or observation error wins.
3. Otherwise normal exit resolves. A numeric nonzero exit is a result fact;
   `strictUtf8` rejects malformed bytes as `invalid-output`.

This replaces 0.1.0's post-cancellation fallback to a later numeric exit,
capture failure, or decode failure. Consumers should inspect
`ProcessRuntimeError.facts` for the observed exit and late failure codes instead
of treating those late observations as the settlement.

Successful `ProcessRunResult` values now also include `facts`. Its observed
`Exit` fields remain top-level for compatibility with the 0.1.0 result shape.

Migration notes for error consumers:

- The incomplete-custody flag moved off the error instance onto
  `error.facts.incompleteCustody`; read it from `facts`, like every other
  neutral fact.
- `error.initiatingError` is the raw error object that started the
  settlement: the abort reason on an early-abort path (which may be any
  value, including a non-`Error` abort reason) and a `ProcessRuntimeError`
  elsewhere. Do not assume it is always a `ProcessRuntimeError`.

## Ports and hooks

No port or hook change is part of 0.2.0. The Node and Bun adapter factories
still accept paired native `acquire`/`cleanup` hooks, and the
`RunningProcess.cleanup`/`closeCapture` adapter surface is unchanged. Hosts
still own POSIX groups, Windows Jobs, wrapper protocols, and tree cleanup.

No Execa dependency or backend was added. The production `dependencies` key
is removed entirely; the package has zero production dependencies.
