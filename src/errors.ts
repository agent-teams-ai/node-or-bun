export type ProcessErrorCode =
  | "invalid-input"
  | "launch"
  | "output-limit"
  | "invalid-output"
  | "stream"
  | "timeout"
  | "cancelled"
  | "cleanup";

export type ProcessRuntimeErrorOptions = {
  readonly cause?: unknown;
  readonly initiatingError?: unknown;
  readonly incompleteCustody?: boolean;
};

export class ProcessRuntimeError extends Error {
  readonly code: ProcessErrorCode;
  readonly initiatingError: unknown;
  readonly incompleteCustody: boolean;

  constructor(
    code: ProcessErrorCode,
    message: string,
    options: ProcessRuntimeErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProcessRuntimeError";
    this.code = code;
    this.initiatingError = options.initiatingError ?? null;
    this.incompleteCustody = options.incompleteCustody ?? false;
  }
}

export const isProcessRuntimeError = (
  value: unknown,
): value is ProcessRuntimeError =>
  value instanceof ProcessRuntimeError;

export const processError = (
  code: ProcessErrorCode,
  message: string,
  cause?: unknown,
): ProcessRuntimeError =>
  new ProcessRuntimeError(code, message, cause === undefined ? {} : { cause });
