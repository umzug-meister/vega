import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test, { after } from "node:test";
import { orderFixture } from "../fixtures/order.js";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !/^\/[a-zA-Z0-9_]+_test$/u.test(new URL(testUrl).pathname)) {
  throw new Error(
    "TEST_DATABASE_URL must explicitly select a separate database ending in _test.",
  );
}
process.env.DATABASE_URL = testUrl;
const { prisma } = await import("../../src/prisma.js");
const { createOrder } = await import("../../src/orders/order-service.js");
const { createAdminOrderRouter } =
  await import("../../src/orders/admin-order-routes.js");
after(() => prisma.$disconnect());

function record(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

test("admin order list handles text, order numbers and oversized numbers without a server error", async (context) => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((_req, res, next) => {
    res.locals.staffUser = { id: "order-search-test", name: "Test Admin" };
    next();
  });
  app.use("/orders", createAdminOrderRouter({ mail: null }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  const sequence = await prisma.orderNumberSequence.findUniqueOrThrow({
    where: { id: 1 },
  });

  const suffix = randomUUID().slice(0, 8);
  const input = orderFixture();
  input.customer.firstName = `Search${suffix}`;
  input.customer.email = `search-${suffix}@example.test`;
  const order = await createOrder(input, "admin", "Test Admin");
  context.after(async () => {
    await prisma.order.deleteMany({
      where: { orderNumber: order.orderNumber },
    });
    await prisma.orderNumberSequence.update({
      where: { id: 1 },
      data: { nextValue: sequence.nextValue },
    });
  });

  const list = async (search: string) => {
    const response = await fetch(
      `${base}/orders?archived=false&page=1&pageSize=10&search=${encodeURIComponent(search)}`,
    );
    assert.equal(response.status, 200);
    const body = record(await response.json());
    return record(body.data);
  };

  const byName = await list(suffix);
  assert.equal(byName.total, 1);
  assert.equal(
    record((byName.items as unknown[])[0]!).orderNumber,
    order.orderNumber,
  );

  const byNumber = await list(String(order.orderNumber));
  assert.equal(byNumber.total, 1);

  for (const oversized of [
    "999999999999999999999999",
    "2147483648",
    "1".repeat(100),
  ]) {
    const result = await list(oversized);
    assert.equal(result.total, 0);
    assert.deepEqual(result.items, []);
  }
});
