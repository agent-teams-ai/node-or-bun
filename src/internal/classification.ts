import type { Exit } from "../contract.js";
import {
  ProcessRuntimeError,
  type ProcessCapturedOutput,
  type ProcessErrorCode,
  type ProcessInitiatingCause,
  type ProcessRuntimeFacts,
} from "../errors.js";

export type InitiatingFailure = {
  readonly cause: ProcessInitiatingCause;
  readonly code: ProcessErrorCode;
  readonly error: ProcessRuntimeError;
};

export type ClassificationInput = {
  readonly initiatingFailure?: InitiatingFailure | undefined;
  readonly cleanupFailure?: { readonly reason: unknown } | undefined;
  readonly decodeFailure?: ProcessRuntimeError | undefined;
  readonly lateFailureCodes: readonly ProcessErrorCode[];
  readonly observedExit: Exit | null;
  readonly completionRequestedBeforeExitObservation: boolean;
  readonly outputBounded: boolean;
  readonly output: ProcessCapturedOutput | null;
};

const facts = ({
  initiatingFailure,
  lateFailureCodes,
  observedExit,
  completionRequestedBeforeExitObservation,
  outputBounded,
  incompleteCustody,
}: Omit<ClassificationInput, "cleanupFailure" | "output"> & {
  readonly incompleteCustody: boolean;
}): ProcessRuntimeFacts =>
  Object.freeze({
    initiatingCause: initiatingFailure?.cause ?? (observedExit === null ? null : "exit"),
    completionRequestedBeforeExitObservation,
    observedExit,
    lateFailureCodes: Object.freeze([...lateFailureCodes]),
    outputBounded,
    incompleteCustody,
  });

/**
 * The fixed facts-outside classifier from plan v4 section 3.2. Cleanup/forced
 * EOF closure wins; otherwise the first initiating failure wins; otherwise a
 * normal observed exit is a result and strict decode failure is `invalid-output`.
 */
export const classifyProcessOutcome = ({
  initiatingFailure,
  cleanupFailure,
  decodeFailure,
  lateFailureCodes,
  observedExit,
  completionRequestedBeforeExitObservation,
  outputBounded,
  output,
}: ClassificationInput):
  | { readonly kind: "result"; readonly facts: ProcessRuntimeFacts }
  | { readonly kind: "error"; readonly error: ProcessRuntimeError } => {
  const shared = {
    initiatingFailure,
    lateFailureCodes,
    observedExit,
    completionRequestedBeforeExitObservation,
    outputBounded,
  };

  if (cleanupFailure !== undefined) {
    return {
      kind: "error",
      error: new ProcessRuntimeError("cleanup", "process cleanup did not complete", {
        output,
        cause: cleanupFailure.reason,
        initiatingError: initiatingFailure?.error ?? null,
        facts: facts({ ...shared, incompleteCustody: true }),
      }),
    };
  }

  if (initiatingFailure !== undefined) {
    return {
      kind: "error",
      error: new ProcessRuntimeError(initiatingFailure.code, initiatingFailure.error.message, {
        output,
        cause: initiatingFailure.error.cause,
        initiatingError: initiatingFailure.error,
        facts: facts({ ...shared, incompleteCustody: false }),
      }),
    };
  }

  if (decodeFailure !== undefined) {
    return {
      kind: "error",
      error: new ProcessRuntimeError("invalid-output", decodeFailure.message, {
        output,
        cause: decodeFailure.cause,
        initiatingError: decodeFailure,
        facts: {
          ...facts({ ...shared, incompleteCustody: false }),
          initiatingCause: "decode",
        },
      }),
    };
  }

  return {
    kind: "result",
    facts: facts({ ...shared, incompleteCustody: false }),
  };
};
