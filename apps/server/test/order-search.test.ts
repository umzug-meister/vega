import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOrderSearch,
  orderListWhere,
  ORDER_NUMBER_MAX,
} from "../src/orders/order-search.js";

test("numeric order search matches an order number inside the Int range", () => {
  const normalized = normalizeOrderSearch(" 0001014 ");
  assert.equal(normalized.kind, "orderNumber");
  assert.equal(normalized.orderNumber, 1014);
  assert.deepEqual(
    orderListWhere({ archived: false, ...normalized }).OR,
    [
      { customerName: { contains: "0001014" } },
      { customerEmail: { contains: "0001014" } },
      { orderNumber: 1014 },
    ],
  );
});

test("oversized numeric input stays a text search instead of failing the query", () => {
  const normalized = normalizeOrderSearch("999999999999999999999999");
  assert.equal(normalized.kind, "text");
  assert.equal(normalized.orderNumber, null);
  const where = orderListWhere({ archived: false, ...normalized });
  assert.deepEqual(where.OR, [
    { customerName: { contains: "999999999999999999999999" } },
    { customerEmail: { contains: "999999999999999999999999" } },
  ]);
  assert.ok(!JSON.stringify(where).includes("orderNumber"));
});

test("the Int maximum is inclusive and one above it is not", () => {
  assert.equal(
    normalizeOrderSearch(String(ORDER_NUMBER_MAX)).orderNumber,
    ORDER_NUMBER_MAX,
  );
  assert.equal(
    normalizeOrderSearch(String(ORDER_NUMBER_MAX + 1)).orderNumber,
    null,
  );
});

test("text and empty searches never produce an order number condition", () => {
  assert.equal(normalizeOrderSearch("kunde").kind, "text");
  assert.equal(normalizeOrderSearch("").kind, "none");
  assert.equal(normalizeOrderSearch(undefined).kind, "none");
  assert.deepEqual(
    orderListWhere({ archived: false, ...normalizeOrderSearch("") }),
    { archivedAt: null },
  );
  assert.deepEqual(
    orderListWhere({ archived: true, ...normalizeOrderSearch("") }),
    { archivedAt: { not: null } },
  );
});

test("search input is trimmed and capped at the documented length", () => {
  const normalized = normalizeOrderSearch(`  ${"x".repeat(150)}  `);
  assert.equal(normalized.search.length, 100);
  assert.ok(normalized.search.startsWith("x"));
});
