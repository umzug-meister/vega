import { createHash, createHmac } from "node:crypto";
import { prisma } from "./prisma.js";
import { retryOnTransactionConflict } from "./transaction.js";

const WINDOW_MS = 60_000;
let requestCount = 0;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function isMissingRow(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  );
}

async function incrementWindowCount(
  key: string,
  windowStartedAt: Date,
): Promise<number> {
  // Concurrent requests sharing a window key can race the upsert's implicit
  // create (observed as P2002 on the PRIMARY key under parallel catalog loads).
  // The loser retries as a plain increment; the increment can only lose its row
  // to the hourly cleanup of long-expired windows, in which case the upsert runs again.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (
        await prisma.publicApiRateLimit.upsert({
          where: { key },
          create: { key, windowStartedAt, count: 1 },
          update: { count: { increment: 1 } },
          select: { count: true },
        })
      ).count;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    try {
      return (
        await prisma.publicApiRateLimit.update({
          where: { key },
          data: { count: { increment: 1 } },
          select: { count: true },
        })
      ).count;
    } catch (error) {
      if (!isMissingRow(error)) throw error;
    }
  }
  throw new Error("Public API rate limit window could not be incremented");
}

export async function consumePublicApiRateLimit(
  ipAddress: string,
  secret: string,
  namespace: string,
  limit: number,
  now = new Date(),
): Promise<boolean> {
  const windowStartedAt = new Date(
    Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS,
  );
  const ipHash = createHmac("sha256", secret).update(ipAddress).digest("hex");
  const key = createHash("sha256")
    .update(`${namespace}:${ipHash}:${windowStartedAt.toISOString()}`)
    .digest("hex");
  // Retries only the increment on MariaDB snapshot conflicts (ER 1020, surfaced as P2039).
  const count = await retryOnTransactionConflict(() =>
    incrementWindowCount(key, windowStartedAt),
  );

  requestCount += 1;
  if (requestCount % 128 === 0) {
    await prisma.publicApiRateLimit.deleteMany({
      where: {
        windowStartedAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) },
      },
    });
  }
  return count <= limit;
}
