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
const { createInvoiceRouter } =
  await import("../../src/invoices/invoice-routes.js");
after(() => prisma.$disconnect());

function record(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}
async function json(response: Response): Promise<Record<string, unknown>> {
  return record(await response.json());
}
function key(n: number) {
  return `order-email-test-key-${String(n).padStart(4, "0")}`;
}

test("staff order mails: family, pair rules, idempotent send with PDFs and success hooks", async (context) => {
  const config: {
    mail: {
      apiToken: string;
      mailboxResourceId: string;
      apiBaseUrl: URL;
    } | null;
  } = { mail: null };
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const signatureUser = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: "Test Admin",
      email: `signature-${randomUUID()}@example.test`,
      signatureName: "Max <Meier>",
      signatureColor: "#28527A",
    },
  });
  context.after(() => prisma.user.delete({ where: { id: signatureUser.id } }));
  app.use((_req, res, next) => {
    res.locals.staffUser = { id: signatureUser.id, name: "Test Admin" };
    next();
  });
  app.use("/orders", createAdminOrderRouter(config));
  app.use("/invoices", createInvoiceRouter(config));
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

  const numbers: number[] = [];
  const invoiceIds: string[] = [];
  const orderSequence = await prisma.orderNumberSequence.findUniqueOrThrow({
    where: { id: 1 },
  });
  const invoiceSequence = await prisma.invoiceNumberSequence.findUniqueOrThrow({
    where: { id: 1 },
  });
  const originalFetch = globalThis.fetch;
  context.after(async () => {
    globalThis.fetch = originalFetch;
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.order.deleteMany({ where: { orderNumber: { in: numbers } } });
    await prisma.orderNumberSequence.update({
      where: { id: 1 },
      data: { nextValue: orderSequence.nextValue },
    });
    await prisma.invoiceNumberSequence.update({
      where: { id: 1 },
      data: { nextValue: invoiceSequence.nextValue },
    });
  });

  const origin = await createOrder(orderFixture(), "admin", "Test Admin");
  numbers.push(origin.orderNumber);
  const copyNumbers: number[] = [];
  for (let index = 0; index < 3; index++) {
    const copied = await json(
      await fetch(`${base}/orders/${origin.orderNumber}/copy`, {
        method: "POST",
      }),
    );
    const number = record(copied.data).orderNumber;
    assert.ok(typeof number === "number");
    numbers.push(number);
    copyNumbers.push(number);
  }
  const [copy, secondCopy, archivedCopy] = copyNumbers as [
    number,
    number,
    number,
  ];
  await prisma.order.update({
    where: { orderNumber: archivedCopy },
    data: { archivedAt: new Date() },
  });
  const foreign = await createOrder(orderFixture(), "admin", "Test Admin");
  numbers.push(foreign.orderNumber);

  assert.equal(
    record((await json(await fetch(`${base}/orders/${copy}`))).data).isCopy,
    true,
  );
  assert.equal(
    record(
      (await json(await fetch(`${base}/orders/${origin.orderNumber}`))).data,
    ).isCopy,
    false,
  );
  const family = record(
    (await json(await fetch(`${base}/orders/${secondCopy}/family`))).data,
  ).items;
  assert.ok(Array.isArray(family));
  assert.deepEqual(
    family.map((member) => [
      record(member).orderNumber,
      record(member).isOrigin,
      record(member).archived,
    ]),
    [
      [origin.orderNumber, true, false],
      [copy, false, false],
      [secondCopy, false, false],
      [archivedCopy, false, true],
    ],
  );

  const draft = async (orderNumber: number, query: string) =>
    fetch(`${base}/orders/${orderNumber}/email-draft?${query}`);
  const fromOrigin = await draft(
    origin.orderNumber,
    `kind=offer-pair&partner=${copy}`,
  );
  assert.equal(fromOrigin.status, 400);
  assert.equal(
    record((await json(fromOrigin)).error).code,
    "OFFER_PAIR_REQUIRES_COPY",
  );
  for (const partner of [copy, foreign.orderNumber, archivedCopy, 999_999]) {
    const response = await draft(copy, `kind=offer-pair&partner=${partner}`);
    assert.equal(response.status, 400);
    assert.equal(
      record((await json(response)).error).code,
      "INVALID_OFFER_PARTNER",
    );
  }
  const pairDraftResponse = await draft(
    copy,
    `kind=offer-pair&partner=${secondCopy}`,
  );
  assert.equal(pairDraftResponse.status, 200);
  const pairDraft = record((await json(pairDraftResponse)).data);
  assert.equal(pairDraft.to, "customer@example.test");
  assert.equal(
    pairDraft.subject,
    `📦 Umzugsangebot zu Ihrer Anfrage ${origin.orderNumber}`,
  );
  assert.ok(
    Array.isArray(pairDraft.attachmentNames) &&
      pairDraft.attachmentNames.length === 2,
  );
  assert.deepEqual(
    record((await json(await draft(copy, "kind=decline"))).data)
      .attachmentNames,
    [],
  );

  const send = (orderNumber: number, body: Record<string, unknown>) =>
    fetch(`${base}/orders/${orderNumber}/emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const pairBody = {
    kind: "offer-pair",
    partnerOrderNumber: secondCopy,
    to: "Kunde@Example.test",
    subject: pairDraft.subject,
    contentHtml: pairDraft.contentHtml,
    idempotencyKey: key(1),
  };

  const unconfigured = await send(copy, pairBody);
  assert.equal(unconfigured.status, 503);
  assert.equal(
    record((await json(unconfigured)).error).code,
    "MAIL_NOT_CONFIGURED",
  );
  assert.equal(
    await prisma.emailOutbox.count({
      where: { idempotencyKey: { contains: key(1) } },
    }),
    0,
  );
  assert.equal(
    (await send(copy, { ...pairBody, partnerOrderNumber: foreign.orderNumber }))
      .status,
    400,
  );
  assert.equal(
    (await send(copy, { ...pairBody, to: "kein-empfaenger" })).status,
    400,
  );

  config.mail = {
    apiToken: "test-only-api-token",
    mailboxResourceId: "test-mailbox",
    apiBaseUrl: new URL("https://api.mail.hostinger.com"),
  };
  const payloads: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== "https://api.mail.hostinger.com")
      return originalFetch(input, init);
    payloads.push(record(JSON.parse(String(init?.body))));
    return new Response(null, { status: 204 });
  };

  const copyRow = await prisma.order.findUniqueOrThrow({
    where: { orderNumber: copy },
  });
  const secondRow = await prisma.order.findUniqueOrThrow({
    where: { orderNumber: secondCopy },
  });
  await prisma.order.updateMany({
    where: { id: { in: [copyRow.id, secondRow.id] } },
    data: { edited: false },
  });
  const sent = await send(copy, pairBody);
  assert.equal(sent.status, 200);
  assert.equal(record((await json(sent)).data).status, "SENT");
  assert.equal(payloads.length, 1);
  const payload = payloads[0]!;
  assert.deepEqual(payload.to, ["kunde@example.test"]);
  assert.match(
    String(payload.html),
    /<span style="color:#28527A">Freundliche Grüße, <br \/>Max &lt;Meier&gt;<br \/>Ihr Umzug Ruck Zuck Team\.<\/span>/u,
  );
  assert.ok(
    Array.isArray(payload.attachments) && payload.attachments.length === 2,
  );
  for (const attachment of payload.attachments) {
    const entry = record(attachment);
    assert.equal(entry.contentType, "application/pdf");
    assert.ok(
      typeof entry.content === "string" &&
        Buffer.from(entry.content, "base64").subarray(0, 5).toString() ===
          "%PDF-",
    );
  }

  const outbox = await prisma.emailOutbox.findFirstOrThrow({
    where: { orderId: copyRow.id },
    include: { events: true },
  });
  assert.equal(outbox.status, "SENT");
  assert.equal(outbox.kind, "OFFER");
  assert.equal(outbox.optionOrderId, secondRow.id);
  assert.equal(outbox.signatureName, "Max <Meier>");
  assert.equal(outbox.signatureColor, "#28527A");
  assert.equal(outbox.attachments, null);
  assert.equal(outbox.events.length, 1);
  assert.equal(
    (await prisma.order.findUniqueOrThrow({ where: { id: copyRow.id } }))
      .edited,
    true,
  );
  assert.equal(
    (await prisma.order.findUniqueOrThrow({ where: { id: secondRow.id } }))
      .edited,
    false,
  );
  const optionEvents = await prisma.orderActivityEvent.findMany({
    where: { orderId: secondRow.id, action: "OFFER_SENT_AS_OPTION" },
  });
  assert.equal(optionEvents.length, 1);
  assert.equal(optionEvents[0]!.actorName, "Test Admin");

  const repeated = await send(copy, pairBody);
  assert.equal(repeated.status, 200);
  assert.equal(payloads.length, 1);
  assert.equal(
    await prisma.emailOutbox.count({ where: { orderId: copyRow.id } }),
    1,
  );

  const declined = await send(origin.orderNumber, {
    kind: "decline",
    to: "customer@example.test",
    subject: "Absage",
    contentHtml: "<p>Leider nein.</p>",
    idempotencyKey: key(2),
  });
  assert.equal(declined.status, 200);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[1]!.attachments, undefined);

  const archived = await send(archivedCopy, {
    kind: "offer",
    to: "customer@example.test",
    subject: "S",
    contentHtml: "<p>x</p>",
    idempotencyKey: key(3),
  });
  assert.equal(archived.status, 409);

  const templateResponse = await fetch(`${base}/invoices/from-order/${copy}`);
  const template = record(await templateResponse.json());
  const created = await json(
    await fetch(`${base}/invoices/from-order/${copy}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record(template.data ?? template)),
    }),
  );
  const invoiceId = record(created.data ?? created).id;
  assert.ok(typeof invoiceId === "string");
  invoiceIds.push(invoiceId);
  const invoiceDraft = record(
    (await json(await fetch(`${base}/invoices/${invoiceId}/email-draft`))).data,
  );
  assert.equal(invoiceDraft.to, "customer@example.test");
  const invoiceSent = await fetch(`${base}/invoices/${invoiceId}/emails`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: invoiceDraft.to,
      subject: invoiceDraft.subject,
      contentHtml: invoiceDraft.contentHtml,
      idempotencyKey: key(4),
    }),
  });
  assert.equal(invoiceSent.status, 200);
  assert.equal(payloads.length, 3);
  const invoiceAttachments = payloads[2]!.attachments;
  assert.ok(
    Array.isArray(invoiceAttachments) && invoiceAttachments.length === 1,
  );
  assert.equal(record(invoiceAttachments[0]).contentType, "application/pdf");
});
