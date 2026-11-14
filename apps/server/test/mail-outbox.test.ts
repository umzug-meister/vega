import assert from "node:assert/strict";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import express from "express";
import { prisma } from "../src/prisma.js";
import { MailDeliveryError } from "../src/mail/hostinger-mail-client.js";
import { deliverDueOutboxMail, deliverOutboxMail, MAIL_SENDING_STALE_MS, queueMail } from "../src/mail/mail-outbox-service.js";
import { MailService } from "../src/mail/mail-service.js";
import { reconcileOutboxMail } from "../src/mail/mail-reconciliation.js";
import { checkStaffEmailStatus, respondWithSendResult, sendStaffEmail } from "../src/mail/staff-email-service.js";
import { createAdminOrderRouter } from "../src/orders/admin-order-routes.js";
import { createInvoiceRouter } from "../src/invoices/invoice-routes.js";
import { createCreditNoteRouter } from "../src/invoices/credit-note-routes.js";
import { createReminderRouter } from "../src/invoices/reminder-routes.js";
import type { Request, Response } from "express";

type Row = Record<string, any>;

function fixture(context: TestContext) {
  let rows: Row[] = [];
  let events: Row[] = [];
  let activities: Row[] = [];
  let effects: Row[] = [];
  let failCommit = false;
  let loseCommitResponse = false;
  let failUnknownWrite = false;
  const restore: Array<() => void> = [];
  function mock(target: object, name: string, implementation: (...args: any[]) => any) {
    const original = Reflect.get(target, name);
    Reflect.set(target, name, implementation);
    restore.push(() => Reflect.set(target, name, original));
  }
  function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === "OR") return value.some((condition: Row) => matches(row, condition));
      if (value instanceof Date) return row[key] instanceof Date && row[key].getTime() === value.getTime();
      if (value && typeof value === "object") {
        if (value.in) return value.in.includes(row[key]);
        if (value.lte) return row[key] !== null && row[key] <= value.lte;
      }
      return row[key] === value;
    });
  }
  const defaults = {
    status: "PENDING", attempts: 0, lockedAt: null, sentAt: null, lastErrorCode: null,
    nextAttemptAt: new Date(), createdAt: new Date(), orderId: "order", optionOrderId: null, reminderEventId: null,
    kind: "OFFER", recipients: ["customer@example.test"], subject: "Test", contentHtml: "<p>Test</p>",
    signatureName: null, actorName: "Staff", attachments: [{ filename: "test.pdf", content: "cGRm" }],
  };
  mock(prisma.emailOutbox, "upsert", async ({ where, create }: Row) => {
    let row = rows.find((item) => matches(item, where));
    if (!row) { row = { ...defaults, ...create }; rows.push(row); }
    return { ...row };
  });
  mock(prisma.emailOutbox, "create", async ({ data }: Row) => { const row = { ...defaults, ...data }; rows.push(row); return { ...row }; });
  mock(prisma.emailOutbox, "findUnique", async ({ where }: Row) => {
    const row = rows.find((item) => matches(item, where));
    return row ? { ...row } : null;
  });
  mock(prisma.emailOutbox, "findUniqueOrThrow", async ({ where }: Row) => {
    const row = rows.find((item) => matches(item, where));
    if (!row) throw new Error("missing row");
    return { ...row };
  });
  mock(prisma.emailOutbox, "findMany", async ({ where, take }: Row) => rows.filter((row) => matches(row, where)).slice(0, take).map((row) => ({ ...row })));
  mock(prisma.emailOutbox, "count", async ({ where }: Row) => rows.filter((row) => matches(row, where)).length);
  mock(prisma.emailOutbox, "updateMany", async ({ where, data }: Row) => {
    if (failUnknownWrite && data.status === "UNKNOWN" && where.lockedAt instanceof Date) throw new Error("synthetic state-write failure");
    let count = 0;
    for (const row of rows.filter((item) => matches(item, where))) {
      for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value;
      count++;
    }
    return { count };
  });
  mock(prisma.emailEvent, "create", async ({ data }: Row) => { events.push(data); return data; });
  mock(prisma.orderActivityEvent, "create", async ({ data }: Row) => { activities.push(data); return data; });
  mock(prisma.order, "updateMany", async (args: Row) => { effects.push({ model: "order", ...args }); return { count: 1 }; });
  mock(prisma.reminderEvent, "updateMany", async (args: Row) => { effects.push({ model: "reminder", ...args }); return { count: 1 }; });
  mock(prisma, "$transaction", async (run: (tx: typeof prisma) => Promise<unknown>) => {
    const snapshot = { rows: rows.map((row) => ({ ...row })), events: [...events], activities: [...activities], effects: [...effects] };
    try {
      const result = await run(prisma);
      if (failCommit) throw new Error("synthetic commit failure");
      if (loseCommitResponse) { loseCommitResponse = false; throw Object.assign(new Error("lost commit response"), { committed: true }); }
      return result;
    } catch (error) {
      if (!(error as { committed?: boolean }).committed) ({ rows, events, activities, effects } = snapshot);
      throw error;
    }
  });
  context.after(() => restore.reverse().forEach((reset) => reset()));
  return {
    rows: () => rows, events: () => events, activities: () => activities, effects: () => effects,
    failCommit: () => { failCommit = true; }, loseCommitResponse: () => { loseCommitResponse = true; },
    failUnknownWrite: (value: boolean) => { failUnknownWrite = value; },
    add: (overrides: Row = {}) => { const row = { ...defaults, id: `mail-${rows.length}`, idempotencyKey: `key-${rows.length}`, ...overrides }; rows.push(row); return row; },
  };
}

const success = () => new MailService({ send: async () => {} });
const uncertain = () => new MailService({ send: async () => { throw new MailDeliveryError("MAIL_TIMEOUT", false, undefined, "UNKNOWN"); } });

test("outbox retains separate Reply-All To and Cc recipients for delivery", async (context) => {
  const f = fixture(context);
  const id = await queueMail({
    kind: "INBOX_REPLY",
    to: ["sender@example.test"],
    cc: ["colleague@example.test"],
    subject: "Re: Umzug",
    contentHtml: "<p>Antwort</p>",
    replyToMailUid: 42,
    signatureName: "Alexander Berent",
    actorName: "Alexander Berent",
    idempotencyKey: "staff:inbox:42:reply-all-key",
  });
  assert.deepEqual(f.rows()[0]?.recipients, {
    to: ["sender@example.test"],
    cc: ["colleague@example.test"],
  });

  let delivered: { to: string[]; cc?: string[]; replyToMailUid?: number } | undefined;
  const service = new MailService({ send: async (mail) => { delivered = mail; } });
  assert.equal(await deliverOutboxMail(id, service), "sent");
  assert.deepEqual(delivered?.to, ["sender@example.test"]);
  assert.deepEqual(delivered?.cc, ["colleague@example.test"]);
  assert.equal(delivered?.replyToMailUid, 42);
});

test("stale crash claims become UNKNOWN, fresh claims and UNKNOWN are never resent", async (context) => {
  const f = fixture(context);
  f.add({ status: "SENDING", lockedAt: new Date(Date.now() - MAIL_SENDING_STALE_MS - 1) });
  f.add({ status: "SENDING", lockedAt: new Date() });
  f.add({ status: "UNKNOWN", lastErrorCode: "MAIL_TIMEOUT" });
  let sends = 0;
  const result = await deliverDueOutboxMail(new MailService({ send: async () => { sends++; } }));
  assert.deepEqual(result, { sent: 0, failed: 0, unknown: 2 });
  assert.equal(f.rows()[0]!.lastErrorCode, "MAIL_STALE_SENDING");
  assert.equal(f.rows()[1]!.status, "SENDING");
  for (const row of f.rows()) assert.equal(await deliverOutboxMail(row.id, success()), "not-claimed");
  assert.equal(sends, 0);
});

test("timeout after submission is UNKNOWN, keeps the snapshot and cannot be blindly retried", async (context) => {
  const f = fixture(context);
  const row = f.add();
  await assert.rejects(deliverOutboxMail(row.id, uncertain()), (error: unknown) => error instanceof MailDeliveryError && error.outcome === "UNKNOWN");
  assert.equal(f.rows()[0]!.status, "UNKNOWN");
  assert.ok(f.rows()[0]!.attachments);
  assert.equal(f.events().length, 0);
  assert.equal(await deliverOutboxMail(row.id, success()), "not-claimed");
  assert.deepEqual(await deliverDueOutboxMail(success()), { sent: 0, failed: 0, unknown: 1 });
});

test("DB completion failure after provider success never schedules another send", async (context) => {
  const f = fixture(context);
  const row = f.add({ reminderEventId: "reminder", optionOrderId: "option" });
  f.failCommit();
  await assert.rejects(deliverOutboxMail(row.id, success()), (error: unknown) => error instanceof MailDeliveryError && error.code === "MAIL_SENT_COMMIT_UNCERTAIN" && !error.retryable);
  assert.equal(f.rows()[0]!.status, "UNKNOWN");
  assert.equal(f.events().length, 0);
  assert.equal(f.effects().length, 0);
  assert.equal(f.activities().length, 0);
  assert.equal(await deliverOutboxMail(row.id, success()), "not-claimed");
});

test("a lost DB commit response recognizes already-recorded success", async (context) => {
  const f = fixture(context);
  const row = f.add();
  f.loseCommitResponse();
  assert.equal(await deliverOutboxMail(row.id, success()), "sent");
  assert.equal(f.rows()[0]!.status, "SENT");
  assert.equal(f.events().length, 1);
});

test("even failure to persist UNKNOWN reports uncertainty and leaves a non-retryable claim for stale recovery", async (context) => {
  const f = fixture(context);
  const row = f.add({ idempotencyKey: "staff:order:outbox-state-loss" });
  f.failCommit();
  f.failUnknownWrite(true);
  const result = await sendStaffEmail(success(), "order", "outbox-state-loss", async () => { throw new Error("must not rebuild"); });
  assert.deepEqual(result.result, { status: "UNKNOWN", errorCode: "MAIL_OUTBOX_STATE_UNAVAILABLE" });
  assert.equal(f.rows()[0]!.status, "SENDING");
  f.failUnknownWrite(false);
  f.rows()[0]!.lockedAt = new Date(Date.now() - MAIL_SENDING_STALE_MS - 1);
  assert.deepEqual(await deliverDueOutboxMail(success()), { sent: 0, failed: 0, unknown: 1 });
  assert.equal(f.events().length, 0);
});

test("parallel claims send once and record all success effects exactly once", async (context) => {
  const f = fixture(context);
  const row = f.add({ reminderEventId: "reminder", optionOrderId: "option" });
  let sends = 0;
  const service = new MailService({ send: async () => { sends++; await new Promise<void>((resolve) => setImmediate(resolve)); } });
  const results = await Promise.all([deliverOutboxMail(row.id, service), deliverOutboxMail(row.id, service)]);
  assert.deepEqual(results.sort(), ["not-claimed", "sent"]);
  assert.equal(sends, 1);
  assert.equal(f.rows()[0]!.status, "SENT");
  assert.equal(f.events().length, 1);
  assert.equal(f.activities().length, 1);
  assert.deepEqual(f.effects().map((entry) => entry.model), ["order", "reminder"]);
  assert.equal(f.effects()[1]!.data.sentAt, f.events()[0]!.sentAt);
  assert.equal(await deliverOutboxMail(row.id, service), "not-claimed");
});

test("permanent rejections stop, known-not-sent transient errors back off and later succeed", async (context) => {
  const f = fixture(context);
  const rejected = f.add();
  await assert.rejects(deliverOutboxMail(rejected.id, new MailService({ send: async () => { throw new MailDeliveryError("ERR_VALIDATION_FAILED", false, 422); } })));
  assert.equal(f.rows()[0]!.status, "REJECTED");
  const retry = f.add();
  const before = Date.now();
  await assert.rejects(deliverOutboxMail(retry.id, new MailService({ send: async () => { throw new MailDeliveryError("MAIL_NETWORK_ERROR", true); } })));
  assert.equal(f.rows()[1]!.status, "FAILED");
  assert.ok(f.rows()[1]!.nextAttemptAt.getTime() >= before + 60_000);
  assert.ok(f.rows()[1]!.nextAttemptAt.getTime() < before + 65_000);
  f.rows()[1]!.nextAttemptAt = new Date(0);
  assert.deepEqual(await deliverDueOutboxMail(success()), { sent: 1, failed: 0, unknown: 0 });
  assert.equal(f.rows()[0]!.status, "REJECTED");
});

test("staff response repeats stable UNKNOWN/SENDING/permanent outcome without rebuilding a mail", async (context) => {
  const f = fixture(context);
  for (const [status, expected] of [["UNKNOWN", "UNKNOWN"], ["SENDING", "SENDING"], ["REJECTED", "FAILED"], ["FAILED", "RETRY_SCHEDULED"]] as const) {
    const row = f.add({ status, idempotencyKey: `staff:order:outcome:${status}`, nextAttemptAt: new Date(Date.now() + 60_000), lockedAt: new Date(), lastErrorCode: "CODE" });
    const result = await sendStaffEmail(success(), "order", `outcome:${status}`, async () => { throw new Error("must not rebuild"); });
    assert.equal(result.outboxId, row.id);
    assert.equal(result.result.status, expected);
  }
  const responses: Row[] = [];
  const res = {
    setHeader() {}, status(status: number) { responses.push({ status }); return this; }, json(body: Row) { responses.push(body); },
  } as unknown as Response;
  const req = { log: { warn() {} } } as unknown as Request;
  respondWithSendResult(req, res, "mail", { status: "UNKNOWN", errorCode: "MAIL_TIMEOUT" });
  assert.equal(responses[0]!.status, 202);
  assert.equal(responses[1]!.data.status, "UNKNOWN");
  assert.equal(responses[1]!.data.outboxId, "mail");
});

test("queue retries of the same key reuse one persisted message", async (context) => {
  const f = fixture(context);
  const input = { kind: "OFFER" as const, to: ["customer@example.test"], subject: "Original", contentHtml: "<p>Original</p>", idempotencyKey: "stable-key" };
  const first = await queueMail(input);
  assert.equal(await queueMail({ ...input, subject: "Changed" }), first);
  assert.equal(f.rows().length, 1);
  assert.equal(f.rows()[0]!.subject, "Original");
});

test("operator reconciliation requires UNKNOWN and explicit evidence, journals confirmation atomically", async (context) => {
  const f = fixture(context);
  const row = f.add({ status: "UNKNOWN", reminderEventId: "reminder" });
  const result = await reconcileOutboxMail({
    outboxId: row.id, actorName: "Operator", evidenceRef: "INC-42", workersStopped: true,
    resolution: { status: "SENT", sentFolderUid: 42, sentAt: new Date(Date.now() - 60_000) },
  });
  assert.equal(result.status, "SENT");
  assert.equal(f.events().length, 1);
  assert.equal(f.effects()[1]!.model, "reminder");
  const audit = f.rows().find((entry) => entry.id === result.auditId)!;
  assert.equal(audit.status, "RESOLVED");
  assert.equal(audit.actorName, "Operator");
  assert.equal(JSON.parse(audit.contentHtml).evidenceRef, "INC-42");
  assert.equal(JSON.parse(audit.contentHtml).uid, 42);
  await assert.rejects(reconcileOutboxMail({
    outboxId: row.id, actorName: "Operator", evidenceRef: "INC-42", workersStopped: true,
    resolution: { status: "NOT_SENT", providerConfirmedNotSent: true },
  }), /REQUIRES_UNKNOWN/u);
});

test("only explicit provider-confirmed non-submission releases UNKNOWN for retry, never a missing sent-copy", async (context) => {
  const f = fixture(context);
  const row = f.add({ status: "UNKNOWN" });
  await assert.rejects(reconcileOutboxMail({
    outboxId: row.id, actorName: "Operator", evidenceRef: "INC-43", workersStopped: true,
    resolution: { status: "NOT_SENT", providerConfirmedNotSent: false as true },
  }), /CONFIRMATION_REQUIRED/u);
  assert.equal(f.rows()[0]!.status, "UNKNOWN");
  const result = await reconcileOutboxMail({
    outboxId: row.id, actorName: "Operator", evidenceRef: "INC-43", workersStopped: true,
    resolution: { status: "NOT_SENT", providerConfirmedNotSent: true },
  });
  assert.equal(result.status, "PENDING");
  assert.equal(f.events().length, 0);
  assert.equal(await deliverOutboxMail(row.id, success()), "sent");
  assert.equal(f.events().length, 1);
});

test("failed reconciliation audit commits leave UNKNOWN, journal and reminder state unchanged", async (context) => {
  const f = fixture(context);
  const row = f.add({ status: "UNKNOWN", reminderEventId: "reminder" });
  f.failCommit();
  await assert.rejects(reconcileOutboxMail({
    outboxId: row.id, actorName: "Operator", evidenceRef: "INC-44", workersStopped: true,
    resolution: { status: "SENT", sentFolderUid: 44, sentAt: new Date(Date.now() - 60_000) },
  }));
  assert.equal(f.rows()[0]!.status, "UNKNOWN");
  assert.equal(f.rows().length, 1);
  assert.equal(f.events().length, 0);
  assert.equal(f.effects().length, 0);
});

test("a missing outbox status check cancels the old key without sending and fences a later original request", async (context) => {
  const f = fixture(context);
  const key = "missing-outbox-key-123456";
  const checked = await checkStaffEmailStatus("order", key, { orderId: "order" });
  assert.equal(checked.result.status, "NOT_QUEUED");
  assert.equal(f.rows()[0]!.status, "NOT_QUEUED");
  assert.equal(f.rows()[0]!.contentHtml, "");
  let sends = 0;
  const service = new MailService({ send: async () => { sends++; } });
  const delayed = await sendStaffEmail(service, "order", key, async () => { throw new Error("must not build cancelled mail"); });
  assert.equal(delayed.result.status, "NOT_QUEUED");
  assert.equal(sends, 0);
  assert.equal(f.events().length, 0);
  assert.deepEqual(await deliverDueOutboxMail(service), { sent: 0, failed: 0, unknown: 0 });
});

test("status-check cancellation also fences a request already building its PDF before it queues", async (context) => {
  const f = fixture(context);
  const key = "pending-build-key-123456";
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let building: () => void = () => {};
  const started = new Promise<void>((resolve) => { building = resolve; });
  let sends = 0;
  const delayed = sendStaffEmail(new MailService({ send: async () => { sends++; } }), "order", key, async () => {
    building();
    await gate;
    return { kind: "OFFER", orderId: "order", to: ["customer@example.test"], subject: "Original", contentHtml: "<p>Original</p>" };
  });
  await started;
  const checked = await checkStaffEmailStatus("order", key, { orderId: "order" });
  assert.equal(checked.result.status, "NOT_QUEUED");
  release();
  assert.equal((await delayed).result.status, "NOT_QUEUED");
  assert.equal(sends, 0);
  assert.equal(f.rows().length, 1);
  assert.equal(f.rows()[0]!.contentHtml, "");
});

test("status-only checks of queued mail never deliver, rebuild or replace its original contents", async (context) => {
  const f = fixture(context);
  const key = "queued-original-key-123456";
  const id = await queueMail({ kind: "OFFER", to: ["customer@example.test"], subject: "Original", contentHtml: "<p>Original</p>", idempotencyKey: `staff:order:${key}` });
  const checked = await checkStaffEmailStatus("order", key);
  assert.equal(checked.outboxId, id);
  assert.equal(checked.result.status, "SENDING");
  assert.equal(f.rows()[0]!.attempts, 0);
  assert.equal(f.rows()[0]!.contentHtml, "<p>Original</p>");
  assert.equal(f.events().length, 0);
});

test("all staff document status routes accept only a key and never require provider configuration or mail payload", async (context) => {
  const f = fixture(context);
  const restores: Array<() => void> = [];
  for (const [delegate, row] of [
    [prisma.order, { id: "order", orderNumber: 1004 }],
    [prisma.invoice, { id: "invoice", orderId: "order" }],
    [prisma.creditNote, { id: "credit", invoice: { orderId: "order" } }],
    [prisma.reminderEvent, { id: "reminder", invoice: { orderId: "order" } }],
  ] as const) {
    const original = delegate.findUnique;
    Reflect.set(delegate, "findUnique", async () => row);
    restores.push(() => Reflect.set(delegate, "findUnique", original));
  }
  context.after(() => restores.forEach((restore) => restore()));
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.staffUser = { id: "staff", name: "Staff" }; next(); });
  app.use("/orders", createAdminOrderRouter({ mail: null }));
  app.use("/invoices", createInvoiceRouter());
  app.use("/credits", createCreditNoteRouter());
  app.use("/reminders", createReminderRouter());
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  for (const path of ["/orders/1004", "/invoices/invoice", "/credits/credit", "/reminders/reminder"]) {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}/emails/status`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: "route-status-key-123456" }),
    });
    assert.equal(response.status, 200, path);
    assert.equal((await response.json()).data.status, "NOT_QUEUED", path);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(f.rows().length, 4);
  assert.ok(f.rows().every((row) => row.status === "NOT_QUEUED" && row.contentHtml === ""));
  assert.equal(f.events().length, 0);
});
