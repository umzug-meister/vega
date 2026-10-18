import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const { createInvoice, archiveInvoice, restoreInvoice } =
  await import("../../src/invoices/invoice-service.js");
const { createCreditNoteRouter } =
  await import("../../src/invoices/credit-note-routes.js");
const { createReminderRouter } =
  await import("../../src/invoices/reminder-routes.js");
after(() => prisma.$disconnect());

function record(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}
async function data(response: Response) {
  return record(record(await response.json()).data);
}
async function errorCode(response: Response) {
  return record(record(await response.json()).error).code;
}

test("Mahnungen and Gutschriften: level order, uniqueness, archive rules, PDFs and sentAt after mail", async (context) => {
  const config: {
    mail: {
      apiToken: string;
      mailboxResourceId: string;
      apiBaseUrl: URL;
    } | null;
  } = { mail: null };
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: "Test Admin",
      email: `accounting-${randomUUID()}@example.test`,
    },
  });
  app.use((_req, res, next) => {
    res.locals.staffUser = { id: user.id, name: "Test Admin" };
    next();
  });
  app.use("/credits", createCreditNoteRouter(config));
  app.use("/reminders", createReminderRouter(config));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  const put = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const orderSequence = await prisma.orderNumberSequence.findUniqueOrThrow({
    where: { id: 1 },
  });
  const invoiceSequence = await prisma.invoiceNumberSequence.findUniqueOrThrow({
    where: { id: 1 },
  });
  const originalFetch = globalThis.fetch;
  const fixture = orderFixture();
  fixture.customer.salutation = "Frau";
  const created = await createOrder(fixture, "admin", "Test Admin");
  const order = await prisma.order.findUniqueOrThrow({
    where: { orderNumber: created.orderNumber },
    select: { id: true, orderNumber: true },
  });
  const invoiceInput = {
    invoiceDate: "2026-10-01",
    company: "",
    customerName: "Test Kunde",
    customerStreet: "Teststraße 1",
    customerPostalCity: "80331 München",
    taxPercent: 19,
    text: "",
    entries: [{ description: "Umzug", quantity: 2, unitPrice: 100 }],
    dueDates: [],
  };
  const invoice = await createInvoice(invoiceInput, {
    id: order.id,
    orderNumber: order.orderNumber,
  });
  const other = await createInvoice({
    ...invoiceInput,
    customerName: "Andere Kundin",
  });
  context.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await prisma.reminderEvent.deleteMany({
      where: { invoiceId: { in: [invoice.id, other.id] } },
    });
    await prisma.creditNote.deleteMany({
      where: { invoiceId: { in: [invoice.id, other.id] } },
    });
    await prisma.invoice.deleteMany({
      where: { id: { in: [invoice.id, other.id] } },
    });
    await prisma.order.deleteMany({ where: { id: order.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.orderNumberSequence.update({
      where: { id: 1 },
      data: { nextValue: orderSequence.nextValue },
    });
    await prisma.invoiceNumberSequence.update({
      where: { id: 1 },
      data: { nextValue: invoiceSequence.nextValue },
    });
  });

  // Reminders: strict level order with legacy defaults.
  assert.equal(
    await errorCode(
      await post("/reminders", { invoiceId: invoice.id, level: 2 }),
    ),
    "REMINDER_LEVEL_INVALID",
  );
  assert.equal(
    (await post("/reminders", { invoiceId: invoice.id, level: 4 })).status,
    400,
  );
  assert.equal(
    (await post("/reminders", { invoiceId: "missing", level: 1 })).status,
    404,
  );
  const firstResponse = await post("/reminders", {
    invoiceId: invoice.id,
    level: 1,
  });
  assert.equal(firstResponse.status, 201);
  const first = await data(firstResponse);
  assert.equal(first.previousDueDate, "2026-10-11");
  assert.equal(first.dueDate, "2026-10-21");
  assert.equal(first.fee, 10);
  assert.equal(first.outstandingAmount, 200);
  assert.match(
    String(first.text),
    /^Sehr geehrte Frau Kunde,\n\ngewiss ist es Ihnen entgangen, dass ein Betrag in Höhe von 200,00\s€ bereits am 11\.10\.2026 fällig war/u,
  );
  assert.equal(
    await errorCode(
      await post("/reminders", { invoiceId: invoice.id, level: 1 }),
    ),
    "REMINDER_LEVEL_INVALID",
  );
  const edited = await data(
    await put(`/reminders/${String(first.id)}`, {
      dueDate: "2026-10-25",
      fee: 5,
      outstandingAmount: 200,
      text: "Neuer Text",
    }),
  );
  assert.deepEqual(
    [edited.dueDate, edited.fee, edited.outstandingAmount, edited.text],
    ["2026-10-25", 5, 200, "Neuer Text"],
  );
  const second = await data(
    await post("/reminders", { invoiceId: invoice.id, level: 2 }),
  );
  assert.deepEqual(
    [second.previousDueDate, second.dueDate, second.outstandingAmount],
    ["2026-10-25", "2026-11-04", 200],
  );
  assert.match(
    String(second.text),
    /Mahnung vom 25\.10\.2026 haben Sie leider nicht reagiert\. Bitte überweisen Sie den fälligen Betrag bis zum 04\.11\.2026\./u,
  );

  // Reminders have no own archive action.
  assert.equal(
    (await post(`/reminders/${String(second.id)}/archive`)).status,
    404,
  );
  // Only the highest level can be deleted; the next level can then be created again.
  const third = await data(
    await post("/reminders", { invoiceId: invoice.id, level: 3 }),
  );
  const remove = (id: unknown) =>
    fetch(`${base}/reminders/${String(id)}`, { method: "DELETE" });
  assert.equal(
    await errorCode(await remove(second.id)),
    "REMINDER_NOT_HIGHEST",
  );
  assert.equal((await remove(third.id)).status, 200);
  assert.equal(
    await prisma.reminderEvent.count({ where: { id: String(third.id) } }),
    0,
  );
  assert.equal((await remove(third.id)).status, 404);
  const listed = record(
    record(
      await (await fetch(`${base}/reminders?invoiceId=${invoice.id}`)).json(),
    ).data,
  ).items;
  assert.ok(Array.isArray(listed) && listed.length === 2);

  const pdf = await fetch(`${base}/reminders/${String(second.id)}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(
    String(pdf.headers.get("content-disposition")),
    /Mahnung%20Nr\.2%20/u,
  );
  assert.equal((await pdf.arrayBuffer()).byteLength > 1000, true);

  // Reminder mail: sentAt only after a successful send, linked through the outbox.
  const draft = await data(
    await fetch(`${base}/reminders/${String(second.id)}/email-draft`),
  );
  assert.equal(draft.to, "customer@example.test");
  assert.equal(
    draft.subject,
    `2. Mahnung zu Ihrer Rechnung ${invoice.invoiceNumber}`,
  );
  const mailBody = {
    to: draft.to,
    subject: draft.subject,
    contentHtml: draft.contentHtml,
    idempotencyKey: `accounting-test-key-${randomUUID()}`,
  };
  assert.equal(
    (await post(`/reminders/${String(second.id)}/emails`, mailBody)).status,
    503,
  );
  assert.equal(
    (
      await prisma.reminderEvent.findUniqueOrThrow({
        where: { id: String(second.id) },
      })
    ).sentAt,
    null,
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
  const sent = await post(`/reminders/${String(second.id)}/emails`, mailBody);
  assert.equal(sent.status, 200);
  assert.equal((await data(sent)).status, "SENT");
  assert.equal(payloads.length, 1);
  const attachments = payloads[0]!.attachments;
  assert.ok(Array.isArray(attachments) && attachments.length === 1);
  assert.match(String(record(attachments[0]).filename), /^Mahnung Nr\.2 /u);
  const sentRow = await prisma.reminderEvent.findUniqueOrThrow({
    where: { id: String(second.id) },
    include: { emails: true },
  });
  assert.ok(sentRow.sentAt);
  assert.equal(sentRow.emails[0]?.kind, "PAYMENT_REMINDER");
  assert.equal(sentRow.emails[0]?.orderId, order.id);

  // Archiving the invoice archives all its reminders; restoring brings them back.
  await archiveInvoice(invoice.id, new Date());
  const archivedReminders = await prisma.reminderEvent.findMany({
    where: { invoiceId: invoice.id },
  });
  assert.equal(archivedReminders.length, 2);
  for (const row of archivedReminders)
    assert.equal(
      row.purgeAt!.getTime() - row.archivedAt!.getTime(),
      30 * 86400000,
    );
  assert.equal(
    await errorCode(
      await put(`/reminders/${String(second.id)}`, {
        dueDate: "2026-11-04",
        fee: 10,
        outstandingAmount: 200,
        text: "x",
      }),
    ),
    "REMINDER_ARCHIVED",
  );
  assert.equal(
    await errorCode(
      await post("/reminders", { invoiceId: invoice.id, level: 3 }),
    ),
    "INVOICE_ARCHIVED",
  );
  assert.equal(
    await errorCode(
      await post("/credits", {
        invoiceId: invoice.id,
        creditNumber: "G-X",
        creditDate: "2026-10-05",
        text: "",
        entries: [],
      }),
    ),
    "INVOICE_ARCHIVED",
  );
  await restoreInvoice(invoice.id);
  assert.equal(
    await prisma.reminderEvent.count({
      where: { invoiceId: invoice.id, archivedAt: null, purgeAt: null },
    }),
    2,
  );

  // Credit notes: one per invoice, unique number, snapshot from the invoice.
  const creditNumber = `G-TEST-${randomUUID().slice(0, 8)}`;
  const creditBody = {
    invoiceId: invoice.id,
    creditNumber,
    creditDate: "2026-10-05",
    text: "Erstattung",
    entries: [{ description: "Umzug", quantity: 1, unitPrice: 50 }],
  };
  assert.equal(
    (await post("/credits", { ...creditBody, creditNumber: " " })).status,
    400,
  );
  const createdCredit = await post("/credits", creditBody);
  assert.equal(createdCredit.status, 201);
  const credit = await data(createdCredit);
  assert.deepEqual(
    [
      credit.invoiceNumber,
      credit.customerName,
      credit.taxPercent,
      credit.creditNumber,
    ],
    [invoice.invoiceNumber, "Test Kunde", 19, creditNumber],
  );
  assert.equal(
    await errorCode(
      await post("/credits", {
        ...creditBody,
        creditNumber: `${creditNumber}-2`,
      }),
    ),
    "CREDIT_NOTE_EXISTS",
  );
  assert.equal(
    await errorCode(
      await post("/credits", { ...creditBody, invoiceId: other.id }),
    ),
    "CREDIT_NUMBER_IN_USE",
  );
  const updated = await data(
    await put(`/credits/${String(credit.id)}`, {
      ...creditBody,
      text: "Geändert",
    }),
  );
  assert.equal(updated.text, "Geändert");
  const creditPdf = await fetch(`${base}/credits/${String(credit.id)}/pdf`);
  assert.equal(creditPdf.status, 200);
  assert.match(
    String(creditPdf.headers.get("content-disposition")),
    new RegExp(`G-${creditNumber}%20Test%20Kunde\\.pdf`, "u"),
  );
  const creditDraft = await data(
    await fetch(`${base}/credits/${String(credit.id)}/email-draft`),
  );
  assert.equal(
    creditDraft.subject,
    `Gutschrift ${creditNumber} zu Ihrer Rechnung ${invoice.invoiceNumber}`,
  );
  const creditSent = await post(`/credits/${String(credit.id)}/emails`, {
    to: creditDraft.to,
    subject: creditDraft.subject,
    contentHtml: creditDraft.contentHtml,
    idempotencyKey: `accounting-test-key-${randomUUID()}`,
  });
  assert.equal((await data(creditSent)).status, "SENT");
  assert.equal(
    await prisma.emailOutbox.count({
      where: { orderId: order.id, kind: "CREDIT_NOTE", status: "SENT" },
    }),
    1,
  );

  await post(`/credits/${String(credit.id)}/archive`);
  assert.equal(
    await errorCode(await put(`/credits/${String(credit.id)}`, creditBody)),
    "CREDIT_NOTE_ARCHIVED",
  );
  assert.equal(
    (await fetch(`${base}/credits/${String(credit.id)}/email-draft`)).status,
    409,
  );
  assert.equal(
    await errorCode(
      await post("/credits", {
        ...creditBody,
        creditNumber: `${creditNumber}-3`,
      }),
    ),
    "CREDIT_NOTE_EXISTS",
  );
  assert.equal(
    (await data(await post(`/credits/${String(credit.id)}/restore`)))
      .archivedAt,
    null,
  );
});
