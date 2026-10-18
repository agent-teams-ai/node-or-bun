# Process contract

## Public boundary

The root entrypoint is platform-neutral. `Launch`, `Request`, `Exit`,
`RunningProcess`, `ProcessAdapter`, `ProcessExecutor`, `ProcessRunResult`, and
`ProcessRuntimeFacts` contain no `NodeJS.*`, `Buffer`, `ChildProcess`,
`Bun.Subprocess`, or Electron types. `createProcessExecutor(adapter)` is the
only lifecycle coordinator.

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

## Lifecycle and ownership

The fixed order is validate and snapshot; pre-abort without spawn; spawn and
synchronous hold; observe/setup; parallel bounded drain; first observation;
cleanup including normal exit; up to 1,000 ms natural capture EOF; forced
native close and up to 1,000 ms reader settlement; decode; fixed arbitration.
Requests are snapshotted at entry. An omitted environment inherits an adapter
snapshot; a supplied map is exact. NUL bytes, an empty executable/cwd, malformed
strings, and a deadline outside integer 1..2,147,483,647 reject before launch.

The adapter owns spawn, terminal observation, native readers, and
`closeCapture()`. Shared code owns capture limits, classification, settlement,
timers, and direct-child cleanup. Foundation Host owns POSIX process groups,
Windows Job Objects, the managed wrapper protocol, and tree cleanup after
leader exit. Default library cleanup is direct-child only.
Hosts translate the fixed classification codes at their own boundary; this
package does not implement Foundation's exception projection.

Both captures drain concurrently and are independently bounded to 4 MiB.
Overflow starts owned cleanup and later bytes are discarded. UTF-8 is decoded
after capture; replacement decoding is the default and `strictUtf8` rejects
malformed bytes as `invalid-output`.

## Facts-outside arbitration

Classification is fixed in shared code with no strategy plugin:

1. Cleanup failure or forced close after the capture EOF deadline outranks all
   other outcomes. It preserves the initiating cause and sets incomplete
   custody.
2. Otherwise the first initiating timeout, cancellation, capture/overflow
   error, or observation error wins.
3. Otherwise normal exit returns a result. Numeric nonzero is retained in the
   observed `Exit`; strict decode failure is `invalid-output`.

Every completed capture run preserves neutral facts: initiating cause;
whether completion was requested before exit observation; observed `Exit`;
late capture/decode failures as error codes; whether existing output limits
bounded the capture; and, for cleanup failures, incomplete custody. The public
surface contains no recursive `ProcessRuntimeError[]`.

Error messages contain no argv, environment, or captured output. The library
does not automatically log output. A timeout that starts cleanup remains
`timeout` after successful cleanup. The same first-cause rule applies to
cancellation and capture/observation failures. Late observations remain facts
and do not replace the initiating settlement.

Detached children created with `setsid` and arbitrary descendant trees are not
promised by the default adapter.
