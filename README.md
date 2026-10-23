# node-or-bun

Runtime-agnostic process execution.

## Quickstart

There is NO autodetect: choose the runtime adapter explicitly.

```ts
// Node.js
import { createProcessExecutor } from "node-or-bun";
import { createNodeProcessAdapter } from "node-or-bun/node";

const run = createProcessExecutor(createNodeProcessAdapter());
const result = await run.run({
  command: process.execPath,
  args: ["-e", "process.stdout.write('hello')"],
  cwd: process.cwd(),
});
```

```ts
// Bun
import { createProcessExecutor } from "node-or-bun";
import { createBunProcessAdapter } from "node-or-bun/bun";

const run = createProcessExecutor(createBunProcessAdapter());
const result = await run.run({
  command: process.execPath,
  args: ["-e", "process.stdout.write('hello')"],
  cwd: process.cwd(),
});
```

The package keeps its 0.1.0 subpaths and adds none:

- `node-or-bun` exposes the runtime-neutral contract and executor.
- `node-or-bun/node` uses `node:child_process.spawn`.
- `node-or-bun/bun` uses `Bun.spawn`.
- `node-or-bun/testing` exposes the shared conformance suite.

## Observable guarantees

- **Bounded memory:** stdout and stderr are independently retained up to 4 MiB.
  Overflow returns `output-limit`; bytes after the bound are discarded.
- **Cleanup before settlement:** a resolved result or rejection is produced only
  after direct-child cleanup and capture settlement have completed or produced
  an honest `cleanup` failure.
- **Unfinished capture is an error:** capture is allowed 1,000 ms to reach
  natural EOF, then native close is requested and allowed a further 1,000 ms.
  Forced close after the EOF deadline is a `cleanup` error with incomplete
  custody retained.
- **Partial setup is held:** after synchronous spawn/retain, observation or
  capture setup failure runs owned cleanup and capture close before `launch`
  rejects.
- **Direct-child cleanup only:** default cleanup sends TERM to the direct child,
  waits 1,000 ms, sends KILL, and waits a further 1,000 ms. It does not promise
  cleanup of a detached `setsid` child or an arbitrary descendant tree.
- **Fixed facts-outside arbitration:** cleanup failure outranks all other
  outcomes. Otherwise the first initiating timeout, cancellation,
  capture/overflow error, or observation error wins. Otherwise normal exit
  returns its observed `Exit`; numeric nonzero remains a result fact, while
  strict malformed UTF-8 returns `invalid-output`.

Errors expose neutral classifier facts without a recursive error array:
initiating cause, whether completion was requested before exit observation,
the observed `Exit`, late capture/decode failure codes, bounded-output status,
and incomplete-custody status. Error messages do not include argv, environment,
or captured output. The library never logs captured output automatically.

`ProcessRuntimeError.output` retains `{ stdout, stderr }` after both bounded
captures settle and decode successfully. It is `null` before capture, while a
capture remains unsettled, or if either strict UTF-8 decode fails. Capture
failures can leave bounded prefixes; inspect the error code and late failure
facts before treating output as complete. The pair is copied and frozen, and
the property is non-enumerable so ordinary error JSON/spread omits it. Explicit
access or serialization of `error.output` still exposes captured content.

## What is not there

- No runtime autodetect and no hidden adapter selection.
- No stdin, PTY, event stream, supervisor, retry, command DSL, service
  registry, Electron API, or product policy.
- No promise of POSIX process groups, Windows Job Objects, wrapper protocols,
  or tree cleanup. A Foundation Host owns those containment boundaries and may
  pair them with the native Node/Bun hooks.
- No promise for detached children created with `setsid`.
- No Execa backend. The accepted N decision keeps production dependencies
  empty and uses the existing native Node and Bun adapters.
- No automatic output logging or implicit diagnostic dump.

## Development and CI evidence

The pinned development entrypoint is Stack Toolchain 0.1.0, with official
TypeScript 7.0.2 for compilation and tsrs → Bun check → TypeScript 7.0.2 for
qualified type checks. Native runtime tests use Node.js 26.11.1 and Bun 1.4.3. The
runtime contract remains Node.js `^24.18.0 || ^26.0.0` and Bun `>=1.4.3`.

```sh
npm install
npm run typecheck
npm run test
npm run pack
npm run qualify
```

This change-set executed typecheck, Node/Bun conformance, Node-under-Bun, pack,
and installed-consumer qualification locally on Linux only. The library CI
workflow executed the same steps on macOS, Ubuntu, and Windows runners plus a
Node 24.18.0 conformance run; those runs completed green on merge commit
`e6fbf257f4` (workflow runs `39112568940` and `39113096124`). Native Windows
wrapper/Job behavior and the Foundation job matrix are Foundation-side pending
items and are not claimed here.

See [the process contract](https://github.com/agent-teams-ai/node-or-bun/blob/main/docs/process-contract.md),
[the 0.1-to-0.2 migration
guide](https://github.com/agent-teams-ai/node-or-bun/blob/main/docs/migration-0.1-to-0.2.md),
and [the bounded scope
record](https://github.com/agent-teams-ai/node-or-bun/blob/main/docs/plan-scope.md).
The `docs/` directory is not part of the published package, so these links
point at the repository copy.

## Development checks

The repository uses the exact development-only `stack-toolchain` release for
`npm run typecheck`, `npm run lint`, `npm run format:check` and compilation.
`toolchain.config.json` owns the four standalone source-checking projects and
selected source paths. Runtime-specific types remain in this repository.
`npm run check` retains adapter conformance, native lifecycle, packaging and
installed-consumer qualification. The published library has no Toolchain or
Engineering Foundation runtime dependency.
