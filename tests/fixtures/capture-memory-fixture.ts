import { drainCapture } from "../../src/internal/capture.js";

const input = new Uint8Array(16 * 1024 * 1024);
input.fill(0x61);
// Exclude the producer's allocation from the capture's retained memory.
const baseline = process.memoryUsage().arrayBuffers;
const retainedBytes: number[] = [];
const problems: unknown[] = [];

async function* chunks(): AsyncGenerator<Uint8Array> {
  yield input;
  // The drain still owns its chunks here, before final concatenation.
  retainedBytes.push(process.memoryUsage().arrayBuffers - baseline);
  input.fill(0x62);
  yield input;
  retainedBytes.push(process.memoryUsage().arrayBuffers - baseline);
}

const result = await drainCapture(chunks(), (error) => problems.push(error));

// Buffer.slice() aliases the source, so also exercise Buffer snapshot ownership.
const buffer = Buffer.from("buffer snapshot");
async function* bufferChunks(): AsyncGenerator<Uint8Array> {
  yield buffer;
  buffer.fill(0);
}
const bufferProblems: unknown[] = [];
const bufferResult = await drainCapture(bufferChunks(), (error) => bufferProblems.push(error));

const detached = new Uint8Array(1);
structuredClone(detached.buffer, { transfer: [detached.buffer] });
async function* detachedChunks(): AsyncGenerator<Uint8Array> {
  yield input;
  yield detached;
}
const detachedProblems: unknown[] = [];
const detachedResult = await drainCapture(detachedChunks(), (error) =>
  detachedProblems.push(error),
);

process.stdout.write(
  JSON.stringify({
    inputBytes: input.byteLength,
    baseline,
    retainedBytes,
    capturedBytes: result.bytes.byteLength,
    snapshotPreserved: result.bytes.every((byte) => byte === 0x61),
    overflow: result.overflow,
    normalEof: result.normalEof,
    problemCodes: problems.map((error) =>
      typeof error === "object" && error !== null && "code" in error ? error.code : null,
    ),
    bufferSnapshot: new TextDecoder().decode(bufferResult.bytes),
    bufferOverflow: bufferResult.overflow,
    bufferNormalEof: bufferResult.normalEof,
    bufferProblemCount: bufferProblems.length,
    detachedCapturedBytes: detachedResult.bytes.byteLength,
    detachedOverflow: detachedResult.overflow,
    detachedNormalEof: detachedResult.normalEof,
    detachedProblemCount: detachedProblems.length,
    detachedLastProblemIsTypeError: detachedProblems.at(-1) instanceof TypeError,
  }),
);
