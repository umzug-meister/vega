import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { prisma } from "../src/prisma.js";
import { registerOrderEmailRoutes } from "../src/orders/order-email-routes.js";
import { orderFixture } from "./fixtures/order.js";

test("inbox offer reply requests current missing saved data before the original quote", async (context) => {
  const data = orderFixture();
  data.customer.phone = "";
  data.movingDate = "";
  data.details!.showSecondaryFrom = false;
  data.details!.showSecondaryTo = false;
  const from = { role: "FROM", street: "", postalCode: "12345", city: "Berlin", details: { floor: "EG" } };
  const to = { role: "TO", street: "Zielstraße 1", postalCode: "12345", city: "Berlin", details: { floor: "EG" } };
  const order = {
    id: "order-id",
    orderNumber: 1042,
    archivedAt: null,
    customerEmail: "customer@example.test",
    data,
    addresses: [from, to],
    positions: [],
  };
  const originalFind = prisma.order.findUnique;
  Reflect.set(prisma.order, "findUnique", async (args: { select?: unknown }) =>
    args.select ? { sourceMessageId: "<original@example.test>" } : order);
  const originalFetch = globalThis.fetch;
  const message = {
    uid: 42, date: "2026-11-14T10:00:00Z", subject: "Anfrage",
    from: { name: "Test Kunde", address: "customer@example.test" },
    messageId: "<original@example.test>",
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== "https://mail.example.test") return originalFetch(input, init);
    if (url.pathname.endsWith("/messages/search")) return Response.json({ data: [message] });
    if (url.pathname.endsWith("/messages/42")) return Response.json({ data: message });
    if (url.pathname.endsWith("/messages/42/text"))
      return Response.json({ data: { text: "Originaltext", html: "" } });
    throw new Error(`Unexpected Hostinger path: ${url.pathname}`);
  };
  const app = express();
  const router = express.Router();
  registerOrderEmailRoutes(router, {
    mail: { apiToken: "test-token", mailboxResourceId: "test", apiBaseUrl: new URL("https://mail.example.test") },
  });
  app.use("/orders", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => {
    server.close();
    globalThis.fetch = originalFetch;
    Reflect.set(prisma.order, "findUnique", originalFind);
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/orders/1042/email-draft`;
  const response = await fetch(`${base}?kind=offer&reply=1`);
  assert.equal(response.status, 200);
  const reply = (await response.json()) as { data: { contentHtml: string; to: string; replyToSourceMail: boolean } };
  assert.equal(reply.data.to, "customer@example.test");
  assert.equal(reply.data.replyToSourceMail, true);
  assert.match(reply.data.contentHtml, /Telefonnummer/u);
  assert.match(reply.data.contentHtml, /Abholadresse: Straße und Hausnummer/u);
  assert.match(reply.data.contentHtml, /Gewünschter Umzugstermin oder Zeitraum/u);
  assert.match(reply.data.contentHtml, /Im Anhang finden Sie den Auftrag\.<\/p><p><strong><span style="color:#28527a">Für die weitere Planung/u);
  assert.match(reply.data.contentHtml, /<li><p><strong><span style="color:#28527a">Telefonnummer<\/span><\/strong><\/p><\/li>/u);
  assert.ok(reply.data.contentHtml.indexOf("Telefonnummer") < reply.data.contentHtml.indexOf("Sollten Sie unser Angebot annehmen"));
  assert.ok(reply.data.contentHtml.indexOf("Telefonnummer") < reply.data.contentHtml.indexOf("Originaltext"));

  const ordinary = await fetch(`${base}?kind=offer`);
  assert.doesNotMatch(((await ordinary.json()) as { data: { contentHtml: string } }).data.contentHtml, /Telefonnummer/u);
  data.customer.phone = "123456";
  data.movingDate = "2026-12-01";
  from.street = "Startstraße 1";
  const updated = await fetch(`${base}?kind=offer&reply=1`);
  assert.doesNotMatch(((await updated.json()) as { data: { contentHtml: string } }).data.contentHtml, /Telefonnummer|Abholadresse:|Gewünschter Umzugstermin/u);
});
