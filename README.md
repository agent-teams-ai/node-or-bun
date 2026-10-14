# Process Runtime

`@agent-teams/process-runtime` is a small captured-command library with a
runtime-neutral root contract and explicit native adapters:

- `@agent-teams/process-runtime` exports `createProcessExecutor`, neutral types,
  and stable process errors. Importing the root does not load Node or Bun
  native APIs.
- `@agent-teams/process-runtime/node` uses `node:child_process.spawn`.
- `@agent-teams/process-runtime/bun` uses `Bun.spawn`.
- `@agent-teams/process-runtime/testing` exports the shared behavior suite and
  is never imported by runtime code.

The executor captures stdout and stderr concurrently with a 4 MiB bound per
stream, decodes UTF-8 after capture, arbitrates cancellation, timeout, capture
failure, and cleanup, and returns terminal facts only after owned cleanup has
completed. Default cleanup owns only the launched child: TERM, a 1,000 ms
confirmation window, KILL, and a further 1,000 ms confirmation window. It does
not provide hostile descendant containment. Hosts that own POSIX process groups
or Windows Job Objects must provide the paired native `acquire`/`cleanup` hooks
on the Node adapter and retain their own protocol.

No stdin, PTY, event stream, supervisor, retry, command plugin, service
registry, Electron API, or Foundation production import is part of this
package. Foundation's existing QGR console wrapper remains Foundation-owned.

## Development

The pinned build tools are Bun 1.4.3, TypeScript 7.0.2, and Node.js 26.11.1.
The package runtime contract supports Node.js `^24.18.0 || ^26.0.0`; CI runs a
focused Node 24 import/process check while retaining Node 26.11.1 as the build
toolchain.

```sh
npm install
npm run typecheck
npm run test
npm run pack
npm run qualify
```

`npm run pack` writes a tarball plus `SHA256SUMS` and `artifact.json` under
`.worker-tmp/pack` for the reviewed release operator. `npm run qualify` creates
unique disposable `sandbox/TEST-installed-*` consumers and exercises the packed
package with both Node and Bun.

See [the process contract](docs/process-contract.md) and
[the bounded scope record](docs/plan-scope.md) for the exact lifecycle and
limitations.
