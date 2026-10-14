export type Exit = {
  readonly exitCode: number | null;
  readonly signal: string | null;
};

export type Launch = {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string>>;
};

export type Request = Launch & {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly strictUtf8?: boolean;
};

export type CompletionCause = "exited" | "cancelled" | "timeout" | "failed";

export type RunningProcess = {
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  readonly exited: Promise<Exit>;
  readonly cleanup: (cause: CompletionCause) => Promise<void>;
  readonly closeCapture: () => Promise<void>;
};

export type ProcessAdapter = {
  readonly launch: (request: Launch) => Promise<RunningProcess>;
};

export type ProcessRunResult = Exit & {
  readonly stdout: string;
  readonly stderr: string;
};

export type ProcessExecutor = {
  readonly run: (request: Request) => Promise<ProcessRunResult>;
};

export const PROCESS_CAPTURE_LIMIT_BYTES = 4 * 1024 * 1024;
export const PROCESS_CLEANUP_STEP_MS = 1_000;
export const PROCESS_TIMEOUT_MAX_MS = 2_147_483_647;
