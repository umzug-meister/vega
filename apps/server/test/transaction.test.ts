import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../src/prisma.js";
import { isTransactionConflict, runTransaction } from "../src/transaction.js";

function snapshotConflict() {
  return Object.assign(new Error("Snapshot write conflict"), {
    code: "P2039",
    meta: {
      driverAdapterError: {
        cause: { originalCode: "1020", kind: "mysql", code: 1020 },
      },
    },
  });
}

test("transaction conflicts use structured Prisma codes, not message text", () => {
  for (const error of [
    snapshotConflict(),
    { code: "P2034" },
    { code: "P2010", meta: { code: "1020" } },
  ]) {
    assert.equal(isTransactionConflict(error), true);
  }
  for (const error of [
    null,
    "1020",
    {},
    new Error("1020"),
    { code: "P2002" },
    { code: "P2025" },
    { code: "P2039" },
    { code: "P2010", meta: { code: "1062" } },
    {
      code: "P2039",
      meta: { driverAdapterError: { cause: { originalCode: "1062" } } },
    },
  ]) {
    assert.equal(isTransactionConflict(error), false);
  }
});

test("retry starts a fresh transaction after rollback and returns its result", async (context) => {
  const original = prisma.$transaction;
  let attempts = 0;
  let callbacks = 0;
  const operation = async () => {
    callbacks++;
    return "saved";
  };
  Reflect.set(prisma, "$transaction", async (callback: typeof operation) => {
    assert.equal(callback, operation);
    await callback();
    if (++attempts === 1) throw snapshotConflict();
    if (attempts === 2)
      throw Object.assign(new Error("Deadlock"), { code: "P2034" });
    return "committed";
  });
  context.after(() => {
    Reflect.set(prisma, "$transaction", original);
  });
  assert.equal(await runTransaction(operation), "committed");
  assert.equal(attempts, 3);
  assert.equal(callbacks, 3);
});

test("transaction retries are bounded and preserve the final error", async (context) => {
  const original = prisma.$transaction;
  const error = snapshotConflict();
  let attempts = 0;
  Reflect.set(prisma, "$transaction", async () => {
    attempts++;
    throw error;
  });
  context.after(() => {
    Reflect.set(prisma, "$transaction", original);
  });
  await assert.rejects(
    runTransaction(async () => undefined),
    (actual) => actual === error,
  );
  assert.equal(attempts, 5);
});

test("validation, unique, upload, and uncertain commit errors are never retried", async (context) => {
  const original = prisma.$transaction;
  context.after(() => {
    Reflect.set(prisma, "$transaction", original);
  });
  for (const code of [
    "P2002",
    "P2025",
    "P2028",
    "P1001",
    "INVALID_UPLOAD_CLAIM",
  ]) {
    const error = Object.assign(new Error(code), { code });
    let attempts = 0;
    Reflect.set(prisma, "$transaction", async () => {
      attempts++;
      throw error;
    });
    await assert.rejects(
      runTransaction(async () => undefined),
      (actual) => actual === error,
    );
    assert.equal(attempts, 1);
  }
});
