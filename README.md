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

The pinned tools are Node.js 26.11.1, Bun 1.4.3, and TypeScript 7.0.2. The
runtime contract remains Node.js `^24.18.0 || ^26.0.0` and Bun `>=1.4.3`.

```sh
npm install
npm run typecheck
npm run test
npm run pack
npm run qualify
```

This TEST change-set has executed typecheck, Node/Bun conformance, Node-under-Bun,
pack, and installed-consumer qualification on Linux only. No native Windows or
macOS run is claimed here. The workflow matrix is configuration, not completed
release evidence; those platform runs remain pending.

See [the process contract](https://github.com/agent-teams-ai/process-runtime/blob/main/docs/process-contract.md),
[the 0.1-to-0.2 migration
guide](https://github.com/agent-teams-ai/process-runtime/blob/main/docs/migration-0.1-to-0.2.md),
and [the bounded scope
record](https://github.com/agent-teams-ai/process-runtime/blob/main/docs/plan-scope.md).
The `docs/` directory is not part of the published package, so these links
point at the repository copy.
