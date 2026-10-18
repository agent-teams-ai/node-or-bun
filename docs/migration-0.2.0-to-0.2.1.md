# Migrate from 0.2.0 to 0.2.1

Upgrade the exact `node-or-bun` pin to `0.2.1`. Imports, adapters and settlement
precedence are unchanged. No migration is needed for successful results.

0.2.0 retained the observed exit and late failure codes but discarded decoded
output when rejecting. Consumers that reconstruct a result from these neutral
facts can now explicitly read `ProcessRuntimeError.output`:

```ts
import { isProcessRuntimeError } from "node-or-bun";

try {
  await executor.run(request);
} catch (error) {
  if (isProcessRuntimeError(error) && error.output !== null) {
    const { stdout, stderr } = error.output;
    // Apply consumer policy using error.facts and the captured content.
  }
  throw error;
}
```

The typed pair (`ProcessCapturedOutput`) is available only when both bounded
captures settle and decode successfully. It is `null` for early failures,
unsettled capture, or a strict UTF-8 decode failure. Empty strings are valid
captured output. Stream failure and overflow can leave bounded prefixes, so
inspect the error code and late failure codes before claiming complete output.

The pair is copied and frozen. The `output` property is non-enumerable and
read-only, keeping it out of ordinary error JSON/spread. Explicit access or
serialization of the pair still exposes
captured content; callers remain responsible for handling sensitive output.
