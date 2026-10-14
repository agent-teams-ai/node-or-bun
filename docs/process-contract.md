# Process contract

## Public boundary

The root entrypoint is platform-neutral. `Launch`, `Request`, `Exit`,
`RunningProcess`, `ProcessAdapter`, `ProcessExecutor`, and `ProcessRunResult`
contain no `NodeJS.*`, `Buffer`, `ChildProcess`, `Bun.Subprocess`, or Electron
types. `createProcessExecutor(adapter)` is the only lifecycle coordinator.

The native technical entrypoints expose one optional hook pair:

```ts
acquire(request, retain)
cleanup(nativeChild, cause)
```

Both hooks are supplied together or the adapter factory rejects. `acquire` is
synchronous and calls `retain(child)` exactly once immediately after native
spawn. `retain` records custody and attaches terminal observation before it
returns. A hook that throws before `retain` promises it allocated no child. A
setup failure after custody runs owned cleanup and closes capture before launch
rejects; a cleanup failure is reported as `cleanup` with the initiating error
and incomplete-custody fact retained.

## Lifecycle

The fixed order is validate, acquire/retain, observe, cleanup, capture
settlement, and resolve/reject. Requests are snapshotted at entry. An omitted
environment inherits an adapter snapshot; a supplied map is exact. NUL bytes,
an empty executable/cwd, malformed strings, and a deadline outside integer
1..2,147,483,647 reject before launch.

Both capture streams are drained concurrently and independently bounded to
4 MiB. Overflow starts owned cleanup and later bytes are discarded. UTF-8 is
decoded after capture; replacement decoding is the default and `strictUtf8`
rejects malformed bytes with `invalid-output`.

Cancellation and timeout request termination and await cleanup. A timeout that
starts termination remains `timeout` after successful cleanup, even when exit,
capture, UTF-8, overflow, or stream observations arrive late. A capture failure
that starts termination first retains its own reason. Cleanup failure always
supersedes the initiating result with `cleanup`; it never claims containment or
release.

The adapter owns native readers and `closeCapture()`. After cleanup, the
executor allows 1,000 ms for both captures to reach EOF. If they remain open it
initiates idempotent native close and allows a further 1,000 ms for close and
reader settlement. EOF still absent is a `cleanup` failure even if force-close
settled. Native close must settle pending reads and must not leave a private
read promise pending.

## Errors

`ProcessRuntimeError.code` is one of `invalid-input`, `launch`, `output-limit`,
`invalid-output`, `stream`, `timeout`, `cancelled`, or `cleanup`. Errors do not
print argv, environment, or captured output. Hosts translate these codes at
their own boundary; this package does not implement Foundation's exception
projection.

## Scope limits

The default direct-child cleanup protocol has no descendant claim. It is not a
process-group, Job Object, sandbox, or hostile-containment mechanism. Foundation
can compose the Node adapter under Bun with its existing group/Job Object hooks,
but the native Bun adapter is tested as a direct-child adapter and is not a
claim about Foundation custody. PTYs, stdin protocols, supervision, retries,
readiness, service registration, and general command plugins remain out of
scope.
