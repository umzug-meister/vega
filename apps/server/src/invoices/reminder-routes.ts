import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import {
  addIsoDays,
  calculateInvoiceTotals,
  DEFAULT_REMINDER_FEE,
  formatGermanDate,
  isInvoiceAmount,
  MAX_REMINDER_LEVEL,
  REMINDER_WAITING_DAYS,
  reminderGreeting,
  reminderText,
  type CreateOrderInput,
  type EmailDraft,
} from "@vega/domain";
import type { AppConfig } from "../config.js";
import type {
  Invoice,
  Prisma,
  ReminderEvent,
} from "../generated/prisma/client.js";
import { createConfiguredMailService } from "../mail/configured-mail-service.js";
import { reminderEmail } from "../mail/staff-email-templates.js";
import {
  invalidEmail,
  mailNotConfigured,
  respondWithSendResult,
  respondWithStaffEmailStatus,
  sendStaffEmail,
  validateStaffEmailInput,
} from "../mail/staff-email-service.js";
import {
  orderDataWithRelations,
  orderRelations,
} from "../orders/order-relations.js";
import { parseEntries } from "../pdf/accounting-pdf.js";
import {
  generateReminderPdf,
  reminderPdfFilename,
} from "../pdf/reminder-pdf.js";
import { prisma } from "../prisma.js";
import { loadSignature } from "../staff/signature-name.js";
import {
  dateFromIso,
  isIsoDate,
  isoDate,
  round,
  toReminderDto,
  validateReminder,
} from "./accounting-input.js";
import { fail, isMissing } from "./accounting-shared.js";

const invoiceWithOrder = {
  order: { include: orderRelations },
} satisfies Prisma.InvoiceInclude;
type InvoiceWithOrder = Prisma.InvoiceGetPayload<{
  include: typeof invoiceWithOrder;
}>;

class ReminderConflict extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Mahnungen 1–3 per invoice; level n requires an active level n−1 (legacy accounting tabs). */
export function createReminderRouter(
  config: Pick<AppConfig, "mail"> = { mail: null },
) {
  const router = Router();
  router.get("/", async (req, res, next) => {
    try {
      const invoiceId =
        typeof req.query.invoiceId === "string"
          ? req.query.invoiceId
          : undefined;
      const reminders = await prisma.reminderEvent.findMany({
        where: invoiceId ? { invoiceId } : { archivedAt: null },
        orderBy: [{ level: "asc" }, { createdAt: "asc" }],
        take: 100,
        include: { invoice: true },
      });
      res.json({
        data: {
          items: reminders.map((reminder) =>
            toReminderDto(
              reminder,
              previousDueDate(reminder, reminder.invoice, reminders),
            ),
          ),
        },
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/:id", async (req, res, next) => {
    try {
      const loaded = await loadReminder(req.params.id);
      if (!loaded) return notFound(res);
      res.json({
        data: toReminderDto(loaded.reminder, loaded.previousDueDate),
      });
    } catch (error) {
      next(error);
    }
  });
  router.post("/", async (req, res, next) => {
    try {
      const invoiceId =
        typeof req.body?.invoiceId === "string" ? req.body.invoiceId : "";
      const level = req.body?.level;
      if (!Number.isInteger(level) || level < 1 || level > MAX_REMINDER_LEVEL)
        return invalid(
          res,
          `Mahnstufe muss zwischen 1 und ${MAX_REMINDER_LEVEL} liegen.`,
        );
      const actorName = String(res.locals.staffUser.name);
      const created = await prisma.$transaction(async (tx) => {
        // Serialise reminder creation per invoice so two clicks cannot create the same level twice.
        const locked = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM invoice WHERE id = ${invoiceId} FOR UPDATE`;
        if (!locked[0]) return undefined;
        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: invoiceId },
          include: invoiceWithOrder,
        });
        if (invoice.archivedAt)
          throw new ReminderConflict(
            "INVOICE_ARCHIVED",
            "Archivierte Rechnungen müssen zuerst wiederhergestellt werden.",
          );
        const active = await tx.reminderEvent.findMany({
          where: { invoiceId, archivedAt: null },
          orderBy: { level: "asc" },
        });
        const expected = (active.at(-1)?.level ?? 0) + 1;
        if (level !== expected)
          throw new ReminderConflict(
            "REMINDER_LEVEL_INVALID",
            expected > MAX_REMINDER_LEVEL
              ? "Alle Mahnstufen sind bereits angelegt."
              : `Als Nächstes kann nur die ${expected}. Mahnung angelegt werden.`,
          );
        const dueDates = [
          invoiceDueDate(invoice),
          ...active.map((reminder) => isoDate(reminder.dueDate)),
        ];
        const dueDate = addIsoDays(dueDates.at(-1)!, REMINDER_WAITING_DAYS);
        const outstandingAmount = active.length
          ? Number(active.at(-1)!.outstandingAmount)
          : round(
              calculateInvoiceTotals(
                parseEntries(invoice.entries),
                Number(invoice.taxPercent),
              ).total,
            );
        if (!isIsoDate(dueDate) || !isInvoiceAmount(outstandingAmount)) {
          throw new ReminderConflict(
            "REMINDER_VALUES_OUT_OF_RANGE",
            "Datum oder Rechnungsbetrag überschreitet den unterstützten Bereich.",
          );
        }
        const text = reminderText({
          level,
          greeting: greetingFor(invoice),
          outstandingAmount,
          dueDates: [...dueDates, dueDate],
        });
        return tx.reminderEvent.create({
          data: {
            id: randomUUID(),
            invoiceId,
            invoiceNumberSnapshot: invoice.invoiceNumber,
            orderNumberSnapshot: invoice.orderNumberSnapshot,
            customerNameSnapshot: invoice.customerNameSnapshot,
            level,
            dueDate: dateFromIso(dueDate),
            outstandingAmount,
            fee: DEFAULT_REMINDER_FEE,
            text,
            actorName,
          },
        });
      });
      if (!created)
        return fail(res, 404, "INVOICE_NOT_FOUND", "Rechnung nicht gefunden.");
      const loaded = await loadReminder(created.id);
      res
        .status(201)
        .json({ data: toReminderDto(created, loaded!.previousDueDate) });
    } catch (error) {
      if (error instanceof ReminderConflict)
        return fail(res, 409, error.code, error.message);
      next(error);
    }
  });
  router.put("/:id", async (req, res, next) => {
    try {
      const input = validateReminder(req.body);
      if (!input.ok) return invalid(res, input.message);
      const existing = await prisma.reminderEvent.findUnique({
        where: { id: req.params.id },
        select: { archivedAt: true },
      });
      if (!existing) return notFound(res);
      if (existing.archivedAt) return reminderArchived(res);
      await prisma.reminderEvent.update({
        where: { id: req.params.id, archivedAt: null },
        data: {
          dueDate: dateFromIso(input.value.dueDate),
          fee: input.value.fee,
          outstandingAmount: input.value.outstandingAmount,
          text: input.value.text,
        },
      });
      const loaded = await loadReminder(req.params.id);
      res.json({
        data: toReminderDto(loaded!.reminder, loaded!.previousDueDate),
      });
    } catch (error) {
      if (isMissing(error)) return reminderArchived(res);
      next(error);
    }
  });
  router.delete("/:id", async (req, res, next) => {
    try {
      const reminder = await prisma.reminderEvent.findUnique({
        where: { id: req.params.id },
        select: { id: true, invoiceId: true, archivedAt: true },
      });
      if (!reminder) return notFound(res);
      if (reminder.archivedAt) return reminderArchived(res);
      const invoiceId = reminder.invoiceId;
      await prisma.$transaction(async (tx) => {
        // Same per-invoice lock as creation, so delete and create cannot interleave.
        if (invoiceId) {
          await tx.$queryRaw`SELECT id FROM invoice WHERE id = ${invoiceId} FOR UPDATE`;
          const invoice = await tx.invoice.findUnique({
            where: { id: invoiceId },
            select: { archivedAt: true },
          });
          if (invoice?.archivedAt)
            throw new ReminderConflict(
              "INVOICE_ARCHIVED",
              "Archivierte Rechnungen müssen zuerst wiederhergestellt werden.",
            );
          const highest = await tx.reminderEvent.findFirst({
            where: { invoiceId, archivedAt: null },
            orderBy: { level: "desc" },
            select: { id: true, level: true },
          });
          if (highest?.id !== reminder.id)
            throw new ReminderConflict(
              "REMINDER_NOT_HIGHEST",
              `Nur die höchste Mahnstufe (${highest?.level ?? 0}. Mahnung) kann gelöscht werden.`,
            );
        }
        await tx.reminderEvent.delete({ where: { id: reminder.id } });
      });
      res.json({ data: { id: reminder.id } });
    } catch (error) {
      if (error instanceof ReminderConflict)
        return fail(res, 409, error.code, error.message);
      if (isMissing(error)) return notFound(res);
      next(error);
    }
  });
  router.get("/:id/pdf", async (req, res, next) => {
    try {
      const loaded = await loadReminder(req.params.id);
      if (!loaded) return notFound(res);
      if (!loaded.invoice) return invoiceMissing(res);
      const pdf = await generateReminderPdf(
        loaded.reminder,
        loaded.invoice,
        loaded.previousDueDate,
      );
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(reminderPdfFilename(loaded.reminder, loaded.invoice.company))}`,
      );
      res.status(200).send(pdf);
    } catch (error) {
      next(error);
    }
  });
  router.get("/:id/email-draft", async (req, res, next) => {
    try {
      const context = await loadEmailContext(req.params.id);
      if (!context.ok) return context.respond(res);
      const { reminder, invoice } = context.loaded;
      const body: EmailDraft = {
        to: invoice.order?.customerEmail ?? "",
        ...reminderEmail(
          reminder.level,
          invoice.invoiceNumber,
          formatGermanDate(isoDate(reminder.dueDate)),
          greetingFor(invoice),
        ),
        attachmentNames: [reminderPdfFilename(reminder, invoice.company)],
      };
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: body });
    } catch (error) {
      next(error);
    }
  });
  router.post("/:id/emails/status", async (req, res, next) => {
    try {
      const reminder = await prisma.reminderEvent.findUnique({
        where: { id: req.params.id },
        select: { id: true, invoice: { select: { orderId: true } } },
      });
      if (!reminder) return notFound(res);
      await respondWithStaffEmailStatus(req, res, `reminder:${reminder.id}`, {
        reminderEventId: reminder.id,
        ...(reminder.invoice?.orderId
          ? { orderId: reminder.invoice.orderId }
          : {}),
      });
    } catch (error) {
      next(error);
    }
  });
  router.post("/:id/emails", async (req, res, next) => {
    try {
      const context = await loadEmailContext(req.params.id);
      if (!context.ok) return context.respond(res);
      const input = validateStaffEmailInput(req.body);
      if (!input.ok) return invalidEmail(res, input.issues);
      const mailService = createConfiguredMailService(config);
      if (!mailService) return mailNotConfigured(res);
      const { reminder, invoice, previousDueDate: previous } = context.loaded;
      const signature = await loadSignature(String(res.locals.staffUser.id));
      const { outboxId, result } = await sendStaffEmail(
        mailService,
        `reminder:${reminder.id}`,
        input.value.idempotencyKey,
        async () => ({
          ...(invoice.orderId ? { orderId: invoice.orderId } : {}),
          reminderEventId: reminder.id,
          kind: "PAYMENT_REMINDER",
          to: [input.value.to],
          subject: input.value.subject,
          contentHtml: input.value.contentHtml,
          attachments: [
            {
              filename: reminderPdfFilename(reminder, invoice.company),
              content: (
                await generateReminderPdf(reminder, invoice, previous)
              ).toString("base64"),
              contentType: "application/pdf",
            },
          ],
          actorName: String(res.locals.staffUser.name),
          ...signature,
        }),
      );
      respondWithSendResult(req, res, outboxId, result);
    } catch (error) {
      next(error);
    }
  });
  return router;
}

/** The invoice's own due date: first configured due date, otherwise invoice date + 10 days (legacy WAITING_DAYS). */
export function invoiceDueDate(
  invoice: Pick<Invoice, "invoiceDate" | "dueDates">,
): string {
  const first = Array.isArray(invoice.dueDates)
    ? invoice.dueDates[0]
    : undefined;
  const date =
    typeof first === "object" &&
    first !== null &&
    "date" in first &&
    typeof first.date === "string"
      ? first.date.slice(0, 10)
      : "";
  return isIsoDate(date)
    ? date
    : addIsoDays(isoDate(invoice.invoiceDate), REMINDER_WAITING_DAYS);
}

function previousDueDate(
  reminder: ReminderEvent,
  invoice: Pick<Invoice, "invoiceDate" | "dueDates"> | null,
  siblings: ReminderEvent[],
): string {
  if (reminder.level > 1) {
    const candidates = siblings.filter(
      (item) =>
        item.invoiceId === reminder.invoiceId &&
        item.level === reminder.level - 1,
    );
    const previous =
      candidates.find((item) => !item.archivedAt) ?? candidates.at(-1);
    if (previous) return isoDate(previous.dueDate);
  }
  return invoice ? invoiceDueDate(invoice) : isoDate(reminder.dueDate);
}

async function loadReminder(id: string) {
  const reminder = await prisma.reminderEvent.findUnique({
    where: { id },
    include: { invoice: { include: invoiceWithOrder } },
  });
  if (!reminder) return undefined;
  const siblings = reminder.invoiceId
    ? await prisma.reminderEvent.findMany({
        where: { invoiceId: reminder.invoiceId, level: reminder.level - 1 },
        orderBy: { createdAt: "asc" },
      })
    : [];
  return {
    reminder,
    invoice: reminder.invoice,
    previousDueDate: previousDueDate(reminder, reminder.invoice, siblings),
  };
}

async function loadEmailContext(id: string) {
  const loaded = await loadReminder(id);
  if (!loaded) return { ok: false as const, respond: notFound };
  if (loaded.reminder.archivedAt)
    return { ok: false as const, respond: reminderArchived };
  const invoice = loaded.invoice;
  if (!invoice) return { ok: false as const, respond: invoiceMissing };
  if (invoice.archivedAt)
    return {
      ok: false as const,
      respond: (res: Response) =>
        fail(
          res,
          409,
          "INVOICE_ARCHIVED",
          "Archivierte Rechnungen müssen zuerst wiederhergestellt werden.",
        ),
    };
  return { ok: true as const, loaded: { ...loaded, invoice } };
}

function greetingFor(invoice: InvoiceWithOrder): string {
  const customer = invoice.order
    ? (orderDataWithRelations(invoice.order) as CreateOrderInput).customer
    : undefined;
  return reminderGreeting({
    company: invoice.company,
    salutation: customer?.salutation,
    lastName: customer?.lastName,
  });
}
function notFound(res: Response) {
  fail(res, 404, "REMINDER_NOT_FOUND", "Mahnung nicht gefunden.");
}
function invalid(res: Response, message: string) {
  fail(res, 400, "INVALID_REMINDER", message);
}
function reminderArchived(res: Response) {
  fail(
    res,
    409,
    "REMINDER_ARCHIVED",
    "Archivierte Mahnungen müssen zuerst wiederhergestellt werden.",
  );
}
function invoiceMissing(res: Response) {
  fail(
    res,
    409,
    "INVOICE_MISSING",
    "Die zugehörige Rechnung existiert nicht mehr.",
  );
}
