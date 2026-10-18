import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import {
  calculateInvoiceTotals,
  isInvoiceAmount,
  type CreateOrderInput,
  type CreditNoteInput,
  type EmailDraft,
} from "@vega/domain";
import type { AppConfig } from "../config.js";
import type { Invoice } from "../generated/prisma/client.js";
import { createConfiguredMailService } from "../mail/configured-mail-service.js";
import { creditNoteEmail } from "../mail/staff-email-templates.js";
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
import {
  creditNotePdfFilename,
  generateCreditNotePdf,
} from "../pdf/credit-note-pdf.js";
import { prisma } from "../prisma.js";
import { loadSignature } from "../staff/signature-name.js";
import {
  dateFromIso,
  toCreditNoteDto,
  validateCreditNote,
} from "./accounting-input.js";
import {
  archiveRecord,
  fail,
  isMissing,
  isUnique,
  restoreRecord,
} from "./accounting-shared.js";

/** Gutschriften: at most one per invoice, freely chosen unique number (ADR 0005). */
export function createCreditNoteRouter(
  config: Pick<AppConfig, "mail"> = { mail: null },
) {
  const router = Router();
  router.get("/", async (req, res, next) => {
    try {
      const invoiceId =
        typeof req.query.invoiceId === "string"
          ? req.query.invoiceId
          : undefined;
      const credits = await prisma.creditNote.findMany({
        where: invoiceId ? { invoiceId } : { archivedAt: null },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      res.json({ data: { items: credits.map(toCreditNoteDto) } });
    } catch (error) {
      next(error);
    }
  });
  router.get("/:id", async (req, res, next) => {
    try {
      const credit = await prisma.creditNote.findUnique({
        where: { id: req.params.id },
      });
      if (!credit) return notFound(res);
      res.json({ data: toCreditNoteDto(credit) });
    } catch (error) {
      next(error);
    }
  });
  router.post("/", async (req, res, next) => {
    try {
      const input = validateCreditNote(req.body);
      if (!input.ok) return invalid(res, input.message);
      const invoiceId =
        typeof req.body?.invoiceId === "string" ? req.body.invoiceId : "";
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
      });
      if (!invoice)
        return fail(res, 404, "INVOICE_NOT_FOUND", "Rechnung nicht gefunden.");
      if (invoice.archivedAt) return invoiceArchived(res);
      if (
        !isInvoiceAmount(
          calculateInvoiceTotals(
            input.value.entries,
            Number(invoice.taxPercent),
          ).total,
        )
      )
        return invalid(
          res,
          "Gutschriftbetrag überschreitet den unterstützten Bereich.",
        );
      if (
        await prisma.creditNote.findUnique({
          where: { invoiceId: invoice.id },
          select: { id: true },
        })
      )
        return creditExists(res);
      const credit = await prisma.creditNote.create({
        data: {
          id: randomUUID(),
          invoiceId: invoice.id,
          ...creditData(input.value, invoice),
        },
      });
      res.status(201).json({ data: toCreditNoteDto(credit) });
    } catch (error) {
      if (isUnique(error)) {
        await uniqueConflict(res, req.body?.invoiceId).catch(next);
        return;
      }
      next(error);
    }
  });
  router.put("/:id", async (req, res, next) => {
    try {
      const input = validateCreditNote(req.body);
      if (!input.ok) return invalid(res, input.message);
      const existing = await prisma.creditNote.findUnique({
        where: { id: req.params.id },
        include: { invoice: true },
      });
      if (!existing) return notFound(res);
      if (existing.archivedAt) return creditArchived(res);
      if (
        !isInvoiceAmount(
          calculateInvoiceTotals(
            input.value.entries,
            Number(existing.invoice?.taxPercent ?? existing.taxPercent),
          ).total,
        )
      )
        return invalid(
          res,
          "Gutschriftbetrag überschreitet den unterstützten Bereich.",
        );
      const snapshot = existing.invoice
        ? creditData(input.value, existing.invoice)
        : {
            creditNumber: input.value.creditNumber,
            creditDate: dateFromIso(input.value.creditDate),
            text: input.value.text,
            entries: input.value.entries as object[],
          };
      const credit = await prisma.creditNote.update({
        where: { id: existing.id, archivedAt: null },
        data: snapshot,
      });
      res.json({ data: toCreditNoteDto(credit) });
    } catch (error) {
      if (isMissing(error)) return creditArchived(res);
      if (isUnique(error))
        return fail(
          res,
          409,
          "CREDIT_NUMBER_IN_USE",
          "Diese Gutschriftnummer wird bereits verwendet.",
        );
      next(error);
    }
  });
  router.get("/:id/pdf", async (req, res, next) => {
    try {
      const credit = await prisma.creditNote.findUnique({
        where: { id: req.params.id },
      });
      if (!credit) return notFound(res);
      const pdf = await generateCreditNotePdf(credit);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(creditNotePdfFilename(credit))}`,
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
      const body: EmailDraft = {
        to: context.to,
        ...context.draft,
        attachmentNames: [creditNotePdfFilename(context.credit)],
      };
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: body });
    } catch (error) {
      next(error);
    }
  });
  router.post("/:id/emails/status", async (req, res, next) => {
    try {
      const credit = await prisma.creditNote.findUnique({
        where: { id: req.params.id },
        select: { id: true, invoice: { select: { orderId: true } } },
      });
      if (!credit) return notFound(res);
      await respondWithStaffEmailStatus(
        req,
        res,
        `credit-note:${credit.id}`,
        credit.invoice?.orderId ? { orderId: credit.invoice.orderId } : {},
      );
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
      const { credit, orderId } = context;
      const signature = await loadSignature(String(res.locals.staffUser.id));
      const { outboxId, result } = await sendStaffEmail(
        mailService,
        `credit-note:${credit.id}`,
        input.value.idempotencyKey,
        async () => ({
          ...(orderId ? { orderId } : {}),
          kind: "CREDIT_NOTE",
          to: [input.value.to],
          subject: input.value.subject,
          contentHtml: input.value.contentHtml,
          attachments: [
            {
              filename: creditNotePdfFilename(credit),
              content: (await generateCreditNotePdf(credit)).toString("base64"),
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
  router.post("/:id/archive", async (req, res, next) => {
    try {
      res.json({
        data: toCreditNoteDto(
          await archiveRecord(prisma.creditNote, req.params.id),
        ),
      });
    } catch (error) {
      if (isMissing(error)) return notFound(res);
      next(error);
    }
  });
  router.post("/:id/restore", async (req, res, next) => {
    try {
      res.json({
        data: toCreditNoteDto(
          await restoreRecord(prisma.creditNote, req.params.id),
        ),
      });
    } catch (error) {
      if (isMissing(error)) return notFound(res);
      next(error);
    }
  });
  return router;
}

function creditData(input: CreditNoteInput, invoice: Invoice) {
  return {
    creditNumber: input.creditNumber,
    creditDate: dateFromIso(input.creditDate),
    text: input.text,
    entries: input.entries as object[],
    invoiceNumberSnapshot: invoice.invoiceNumber,
    orderNumberSnapshot: invoice.orderNumberSnapshot,
    customerNameSnapshot: invoice.customerNameSnapshot,
    company: invoice.company,
    customerStreet: invoice.customerStreet,
    customerPostalCity: invoice.customerPostalCity,
    taxPercent: invoice.taxPercent,
  };
}

async function loadEmailContext(id: string) {
  const credit = await prisma.creditNote.findUnique({
    where: { id },
    include: { invoice: { include: { order: { include: orderRelations } } } },
  });
  if (!credit) return { ok: false as const, respond: notFound };
  if (credit.archivedAt) return { ok: false as const, respond: creditArchived };
  const order = credit.invoice?.order;
  const customer = order
    ? (orderDataWithRelations(order) as CreateOrderInput).customer
    : undefined;
  return {
    ok: true as const,
    credit,
    orderId: order?.id,
    to: order?.customerEmail ?? "",
    draft: creditNoteEmail(
      credit.creditNumber,
      credit.invoiceNumberSnapshot,
      customer,
      credit.customerNameSnapshot,
    ),
  };
}

async function uniqueConflict(res: Response, invoiceId: unknown) {
  if (
    typeof invoiceId === "string" &&
    (await prisma.creditNote.findUnique({
      where: { invoiceId },
      select: { id: true },
    }))
  )
    return creditExists(res);
  fail(
    res,
    409,
    "CREDIT_NUMBER_IN_USE",
    "Diese Gutschriftnummer wird bereits verwendet.",
  );
}
function creditExists(res: Response) {
  fail(
    res,
    409,
    "CREDIT_NOTE_EXISTS",
    "Für diese Rechnung existiert bereits eine Gutschrift (auch archivierte zählen).",
  );
}
function notFound(res: Response) {
  fail(res, 404, "CREDIT_NOTE_NOT_FOUND", "Gutschrift nicht gefunden.");
}
function invalid(res: Response, message: string) {
  fail(res, 400, "INVALID_CREDIT_NOTE", message);
}
function invoiceArchived(res: Response) {
  fail(
    res,
    409,
    "INVOICE_ARCHIVED",
    "Archivierte Rechnungen müssen zuerst wiederhergestellt werden.",
  );
}
function creditArchived(res: Response) {
  fail(
    res,
    409,
    "CREDIT_NOTE_ARCHIVED",
    "Archivierte Gutschriften müssen zuerst wiederhergestellt werden.",
  );
}
