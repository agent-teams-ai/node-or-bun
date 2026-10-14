import type { Launch, Request } from "../contract.js";
import { PROCESS_TIMEOUT_MAX_MS } from "../contract.js";
import { processError } from "../errors.js";

export type RequestSnapshot = {
  readonly launch: Launch;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number | undefined;
  readonly strictUtf8: boolean;
};

const hasNul = (value: string): boolean => value.includes("\u0000");

const validateString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0 || hasNul(value)) {
    throw processError("invalid-input", `${field} must be a non-empty string without NUL`);
  }
  return value;
};

const snapshotEnvironment = (
  value: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const entries = Object.entries(value);
  const result: Record<string, string> = {};
  for (const [key, entryValue] of entries) {
    if (typeof key !== "string" || typeof entryValue !== "string" || hasNul(key) || hasNul(entryValue)) {
      throw processError("invalid-input", "environment entries must be strings without NUL");
    }
    result[key] = entryValue;
  }
  return result;
};

export const snapshotRequest = (request: Request): RequestSnapshot => {
  if (request === null || typeof request !== "object") {
    throw processError("invalid-input", "request must be an object");
  }
  const command = validateString(request.command, "command");
  if (!Array.isArray(request.args)) {
    throw processError("invalid-input", "args must be an array");
  }
  const args = request.args.map((arg, index) => {
    if (typeof arg !== "string" || hasNul(arg)) {
      throw processError("invalid-input", `args[${index}] must be a string without NUL`);
    }
    return arg;
  });
  const cwd = validateString(request.cwd, "cwd");
  const environment = snapshotEnvironment(request.environment);
  const timeoutMs = request.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > PROCESS_TIMEOUT_MAX_MS)
  ) {
    throw processError("invalid-input", "timeoutMs must be an integer in 1..2147483647");
  }
  if (request.strictUtf8 !== undefined && typeof request.strictUtf8 !== "boolean") {
    throw processError("invalid-input", "strictUtf8 must be a boolean");
  }
  return {
    launch: {
      command,
      args,
      cwd,
      ...(environment === undefined ? {} : { environment }),
    },
    signal: request.signal,
    timeoutMs,
    strictUtf8: request.strictUtf8 ?? false,
  };
};
