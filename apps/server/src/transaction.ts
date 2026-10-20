import { setTimeout } from "node:timers/promises";
import type { Prisma } from "./generated/prisma/client.js";
import { prisma } from "./prisma.js";

export function isTransactionConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error))
    return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2039" && error.code !== "P2010") return false;
  if (
    !("meta" in error) ||
    typeof error.meta !== "object" ||
    error.meta === null
  )
    return false;
  const meta = error.meta as Record<string, unknown>;
  if (error.code === "P2010") return meta.code === "1020" || meta.code === 1020;
  const adapter = meta.driverAdapterError;
  if (typeof adapter !== "object" || adapter === null || !("cause" in adapter))
    return false;
  const cause = adapter.cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "originalCode" in cause &&
    cause.originalCode === "1020"
  );
}

const MAX_CONFLICT_ATTEMPTS = 5;

// Retries a single DB operation (or a whole transaction) only on MariaDB snapshot conflicts.
// Callbacks must contain only DB work, never external side effects.
export async function retryOnTransactionConflict<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= MAX_CONFLICT_ATTEMPTS - 1 || !isTransactionConflict(error))
        throw error;
      await setTimeout(10 * 2 ** attempt);
    }
  }
}

// Callbacks must contain only transactional DB work, never external side effects.
export function runTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return retryOnTransactionConflict(() => prisma.$transaction(operation));
}
