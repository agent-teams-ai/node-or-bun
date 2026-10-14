import { PROCESS_CAPTURE_LIMIT_BYTES } from "../contract.js";
import { processError } from "../errors.js";

export type CaptureRead = {
  readonly bytes: Uint8Array;
  readonly overflow: boolean;
};

const copyChunk = (value: Uint8Array): Uint8Array => {
  if (!(value instanceof Uint8Array)) {
    throw processError("stream", "capture stream yielded a non-byte chunk");
  }
  return new Uint8Array(value);
};

export const concatBytes = (chunks: readonly Uint8Array[], length: number): Uint8Array => {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};

export const decodeCapture = (
  bytes: Uint8Array,
  strictUtf8: boolean,
  streamName: "stdout" | "stderr",
): string => {
  try {
    return new TextDecoder("utf-8", {
      fatal: strictUtf8,
      ignoreBOM: true,
    }).decode(bytes);
  } catch (cause) {
    throw processError("invalid-output", `${streamName} is not valid UTF-8`, cause);
  }
};

export const drainCapture = async (
  stream: AsyncIterable<Uint8Array>,
  onProblem: (error: unknown) => void,
): Promise<CaptureRead> => {
  const chunks: Uint8Array[] = [];
  let length = 0;
  let overflow = false;
  try {
    for await (const value of stream) {
      const chunk = copyChunk(value);
      if (overflow) {
        continue;
      }
      const remaining = PROCESS_CAPTURE_LIMIT_BYTES - length;
      const accepted = chunk.byteLength <= remaining ? chunk : chunk.subarray(0, Math.max(0, remaining));
      if (accepted.byteLength > 0) {
        chunks.push(accepted);
        length += accepted.byteLength;
      }
      if (chunk.byteLength > remaining) {
        overflow = true;
        onProblem(processError("output-limit", "captured output exceeded 4 MiB"));
      }
    }
  } catch (cause) {
    // Preserve the stream-specific reason at the executor boundary.
    onProblem(cause);
  }
  return { bytes: concatBytes(chunks, length), overflow };
};
