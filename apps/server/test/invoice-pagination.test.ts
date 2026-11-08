import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import type { AdminInvoiceListDto } from "@vega/domain";
import { prisma } from "../src/prisma.js";
import { createInvoiceRouter } from "../src/invoices/invoice-routes.js";

test("invoice pagination reaches records beyond 100 and applies search/archive to both page and total", async (context) => {
  const now = new Date("2026-10-11T10:00:00Z");
  const invoices = Array.from({ length: 260 }, (_, index) => ({
    id: String(index).padStart(3, "0"), invoiceNumber: `R-${index}`, revision: 0, orderNumberSnapshot: index,
    invoiceDate: now, company: "", customerNameSnapshot: index % 2 ? "Ada" : "Berta",
    customerStreet: "", customerPostalCity: "", text: "", taxPercent: 19, entries: [], dueDates: [],
    archivedAt: index >= 230 ? now : null, purgeAt: index >= 230 ? new Date("2026-11-15T10:00:00Z") : null, createdAt: now, updatedAt: now,
  }));
  type Where = { archivedAt: { not: null } | null; OR?: Array<Record<string, unknown>> };
  function filter(where: Where) {
    return invoices.filter((invoice) => Boolean(invoice.archivedAt) === Boolean(where.archivedAt)
      && (!where.OR || where.OR.some((clause) => {
        const [key, value] = Object.entries(clause)[0]!;
        if (typeof value === "number") return Reflect.get(invoice, key) === value;
        return String(Reflect.get(invoice, key)).includes((value as { contains: string }).contains);
      })));
  }
  const originalFind = prisma.invoice.findMany;
  const originalCount = prisma.invoice.count;
  Reflect.set(prisma.invoice, "findMany", async ({ where, skip, take, orderBy }: { where: Where; skip: number; take: number; orderBy: unknown }) => {
    assert.ok(take <= 100);
    assert.deepEqual(orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
    return filter(where).slice(skip, skip + take);
  });
  Reflect.set(prisma.invoice, "count", async ({ where }: { where: Where }) => filter(where).length);
  context.after(() => {
    Reflect.set(prisma.invoice, "findMany", originalFind);
    Reflect.set(prisma.invoice, "count", originalCount);
  });
  const app = express();
  app.use("/invoices", createInvoiceRouter());
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/invoices`;
  async function page(query: string) {
    const response = await fetch(`${base}?${query}`);
    assert.equal(response.status, 200);
    return (await response.json() as { data: AdminInvoiceListDto }).data;
  }
  const pages = await Promise.all([1, 2, 3].map((number) => page(`page=${number}&pageSize=100`)));
  assert.deepEqual(pages.map((result) => result.items.length), [100, 100, 30]);
  assert.ok(pages.every((result) => result.total === 230 && result.pageSize === 100));
  assert.equal(new Set(pages.flatMap((result) => result.items.map((invoice) => invoice.id))).size, 230);
  const search = await page("search=Ada&page=5&pageSize=25");
  assert.equal(search.total, 115);
  assert.equal(search.items.length, 15);
  assert.ok(search.items.every((invoice) => invoice.customerName === "Ada" && !invoice.archivedAt));
  const archived = await page("archived=true&search=Berta&page=2&pageSize=10");
  assert.equal(archived.total, 15);
  assert.equal(archived.items.length, 5);
  assert.ok(archived.items.every((invoice) => invoice.archivedAt));
  assert.ok(archived.items.every((invoice) => invoice.purgeAt === "2026-11-15T10:00:00.000Z"));
  assert.ok(pages[0]!.items.every((invoice) => invoice.purgeAt === null));
  assert.deepEqual((await page("search=259&archived=true")).items.map((invoice) => invoice.orderNumber), [259]);
  for (const query of ["page=0", "page=-1", "page=1.1", "page=Infinity", "pageSize=101", "pageSize=0", "page=1&page=2", "page=99999999999999"]) {
    assert.equal((await fetch(`${base}?${query}`)).status, 400, query);
  }
});
