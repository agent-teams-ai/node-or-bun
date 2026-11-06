import { PROCESS_CLEANUP_STEP_MS } from "../contract.js";
import { processError } from "../errors.js";

export type DirectChildCleanupInput = {
  readonly cause: "exited" | "cancelled" | "timeout" | "failed";
  readonly isTerminal: () => boolean;
  readonly waitForTerminal: (timeoutMs: number) => Promise<boolean>;
  readonly terminate: (signal: "SIGTERM" | "SIGKILL") => void;
};

export const cleanupDirectChild = async ({
  cause,
  isTerminal,
  waitForTerminal,
  terminate,
}: DirectChildCleanupInput): Promise<void> => {
  if (cause === "exited" || isTerminal()) {
    return;
  }
  try {
    terminate("SIGTERM");
    if (await waitForTerminal(PROCESS_CLEANUP_STEP_MS)) {
      return;
    }
    terminate("SIGKILL");
    if (await waitForTerminal(PROCESS_CLEANUP_STEP_MS)) {
      return;
    }
  } catch (error) {
    throw processError("cleanup", "direct child termination failed", error);
  }
  throw processError("cleanup", "direct child terminal observation timed out");
};

/** Wait only on the native adapter's established terminal proof. */
export const waitForTerminalProof = (
  terminalProof: Promise<void>,
  timeoutMs: number,
): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  return Promise.race([terminalProof.then(() => true), timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
};
