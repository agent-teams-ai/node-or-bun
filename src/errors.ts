import type { Exit } from "./contract.js";

export type ProcessErrorCode =
  | "invalid-input"
  | "launch"
  | "output-limit"
  | "invalid-output"
  | "stream"
  | "timeout"
  | "cancelled"
  | "cleanup";

export type ProcessInitiatingCause =
  | "launch"
  | "timeout"
  | "cancellation"
  | "capture"
  | "observation"
  | "decode"
  | "exit"
  | null;

export type ProcessRuntimeFacts = {
  readonly initiatingCause: ProcessInitiatingCause;
  readonly completionRequestedBeforeExitObservation: boolean;
  readonly observedExit: Exit | null;
  readonly lateFailureCodes: readonly ProcessErrorCode[];
  readonly outputBounded: boolean;
  readonly incompleteCustody: boolean;
};

export type ProcessCapturedOutput = {
  readonly stdout: string;
  readonly stderr: string;
};

export type ProcessRuntimeErrorOptions = {
  readonly cause?: unknown;
  readonly initiatingError?: unknown;
  readonly incompleteCustody?: boolean;
  readonly facts?: Partial<ProcessRuntimeFacts>;
  readonly output?: ProcessCapturedOutput | null;
};

export class ProcessRuntimeError extends Error {
  readonly code: ProcessErrorCode;
  readonly initiatingError: unknown;
  readonly facts: ProcessRuntimeFacts;
  /** Bounded decoded captures, or null if either capture/decode is unavailable. */
  declare readonly output: ProcessCapturedOutput | null;

  constructor(
    code: ProcessErrorCode,
    message: string,
    options: ProcessRuntimeErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProcessRuntimeError";
    this.code = code;
    this.initiatingError = options.initiatingError ?? null;
    // Keep captured content out of ordinary error enumeration/JSON. Explicit
    // access is still sensitive and callers decide whether to expose it.
    Object.defineProperty(this, "output", {
      value: options.output == null
        ? null
        : Object.freeze({ stdout: options.output.stdout, stderr: options.output.stderr }),
      enumerable: false,
      writable: false,
      configurable: false,
    });
    this.facts = Object.freeze({
      initiatingCause: options.facts?.initiatingCause ?? null,
      completionRequestedBeforeExitObservation:
        options.facts?.completionRequestedBeforeExitObservation ?? false,
      observedExit: options.facts?.observedExit ?? null,
      lateFailureCodes: Object.freeze([...(options.facts?.lateFailureCodes ?? [])]),
      outputBounded: options.facts?.outputBounded ?? false,
      incompleteCustody:
        options.facts?.incompleteCustody ?? options.incompleteCustody ?? false,
    });
  }

  get incompleteCustody(): boolean {
    return this.facts.incompleteCustody;
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
