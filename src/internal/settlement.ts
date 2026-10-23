export type Settlement<T> =
  | { readonly status: "fulfilled"; readonly value: T }
  | { readonly status: "rejected"; readonly reason: unknown };

export type BoundedSettlement<T> = Settlement<T> | { readonly status: "timeout" };

export const settleOperation = async <T>(
  operation: () => T | PromiseLike<T>,
): Promise<Settlement<Awaited<T>>> => {
  try {
    return { status: "fulfilled", value: await operation() };
  } catch (reason) {
    return { status: "rejected", reason };
  }
};

export const settleWithin = async <T>(
  operation: () => T | PromiseLike<T>,
  timeoutMs: number,
): Promise<BoundedSettlement<Awaited<T>>> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<BoundedSettlement<Awaited<T>>>((resolve) => {
    timer = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
  });
  try {
    return await Promise.race([
      (async (): Promise<BoundedSettlement<Awaited<T>>> => {
        await Promise.resolve();
        return { status: "fulfilled", value: await operation() };
      })(),
      timeout,
    ] satisfies Promise<BoundedSettlement<Awaited<T>>>[]);
  } catch (reason) {
    return { status: "rejected", reason };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

export const rejectedReasons = (settlements: readonly Settlement<unknown>[]): unknown[] =>
  settlements.flatMap((settlement) =>
    settlement.status === "rejected" ? [settlement.reason] : [],
  );

export const withCause = <T extends object>(error: T, cause: unknown): T => {
  Object.defineProperty(error, "cause", {
    value: cause,
    configurable: true,
    writable: true,
  });
  return error;
};
