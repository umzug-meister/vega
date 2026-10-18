import { Router, type Response } from "express";
import type {
  AdminInvoiceOrderOverview,
  CreateOrderInput,
  EmailDraft,
  InvoiceInput,
} from "@vega/domain";
import type { AppConfig } from "../config.js";
import type { Prisma } from "../generated/prisma/client.js";
import { createConfiguredMailService } from "../mail/configured-mail-service.js";
import { invoiceEmail } from "../mail/staff-email-templates.js";
import {
  invalidEmail,
  mailNotConfigured,
  respondWithSendResult,
  respondWithStaffEmailStatus,
  sendStaffEmail,
  validateStaffEmailInput,
} from "../mail/staff-email-service.js";
import { prisma } from "../prisma.js";
import { generateInvoicePdf, invoicePdfFilename } from "../pdf/invoice-pdf.js";
import {
  orderDataWithRelations,
  orderRelations,
} from "../orders/order-relations.js";
import { toInvoiceDto, validateInvoice } from "./invoice-input.js";
import { loadSignature } from "../staff/signature-name.js";
import {
  archiveInvoice,
  createInvoice,
  InvoiceOrderError,
  InvoiceUpdateConflict,
  recordInvoicePdfExport,
  restoreInvoice,
  updateInvoice,
} from "./invoice-service.js";

export function createInvoiceRouter(
  config: Pick<AppConfig, "mail"> = { mail: null },
) {
  const router = Router();
  router.get("/", async (req, res, next) => {
    try {
      const archived = req.query.archived === "true";
      const search =
        typeof req.query.search === "string"
          ? req.query.search.trim().slice(0, 100)
          : "";
      const page = pageInteger(req.query.page, 1);
      const pageSize = pageInteger(req.query.pageSize, 25);
      if (
        !page ||
        !pageSize ||
        pageSize > 100 ||
        (page - 1) * pageSize > 2_147_483_647
      ) {
        res.status(400).json({
          error: {
            code: "INVALID_INVOICE_QUERY",
            message: "Ungültige Seitennummer oder Seitengröße (1–100).",
          },
        });
        return;
      }
      const orderNumber = /^\d+$/u.test(search) ? Number(search) : undefined;
      const where: Prisma.InvoiceWhereInput = {
        archivedAt: archived ? { not: null } : null,
        ...(search
          ? {
              OR: [
                { invoiceNumber: { contains: search } },
                { customerNameSnapshot: { contains: search } },
                ...(orderNumber !== undefined &&
                Number.isSafeInteger(orderNumber) &&
                orderNumber <= 2_147_483_647
                  ? [{ orderNumberSnapshot: orderNumber }]
                  : []),
              ],
            }
          : {}),
      };
      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.invoice.count({ where }),
      ]);
      res.json({
        data: { items: invoices.map(toInvoiceDto), total, page, pageSize },
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/next-number", async (_req, res, next) => {
    try {
      const sequence = await prisma.invoiceNumberSequence.findUniqueOrThrow({
        where: { id: 1 },
        select: { nextValue: true },
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: { nextValue: sequence.nextValue } });
    } catch (error) {
      next(error);
    }
  });
  router.get("/:id", async (req, res, next) => {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: req.params.id },
      });
      if (!invoice) return notFound(res);
      const order = invoice.orderId
        ? await prisma.order.findUnique({
            where: { id: invoice.orderId },
            include: orderRelations,
          })
        : null;
      const orderData = order ? orderDataWithRelations(order) : undefined;
      res.json({
        data: {
          ...toInvoiceDto(invoice),
          ...(order && orderData
            ? { orderOverview: toOrderOverview(order.orderNumber, orderData) }
            : {}),
        },
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/:id/pdf", async (req, res, next) => {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: req.params.id },
      });
      if (!invoice) return notFound(res);
      const pdf = await generateInvoicePdf(invoice);
      if (invoice.orderId)
        await recordInvoicePdfExport(
          invoice.orderId,
          String(res.locals.staffUser.name),
        );
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(invoicePdfFilename(invoice))}`,
      );
      res.status(200).send(pdf);
    } catch (error) {
      next(error);
    }
  });
  router.get("/:id/email-draft", async (req, res, next) => {
    try {
      const context = await loadInvoiceEmailContext(req.params.id);
      if (!context.ok) return context.respond(res);
      const { invoice, draft } = context;
      const body: EmailDraft = {
        to: invoice.order?.customerEmail ?? "",
        subject: draft.subject,
        contentHtml: draft.contentHtml,
        attachmentNames: [invoicePdfFilename(invoice)],
      };
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: body });
    } catch (error) {
      next(error);
    }
  });
  router.post("/:id/emails/status", async (req, res, next) => {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: req.params.id },
        select: { id: true, orderId: true },
      });
      if (!invoice) return notFound(res);
      await respondWithStaffEmailStatus(
        req,
        res,
        `invoice:${invoice.id}`,
        invoice.orderId ? { orderId: invoice.orderId } : {},
      );
    } catch (error) {
      next(error);
    }
  });
  router.post("/:id/emails", async (req, res, next) => {
    try {
      const context = await loadInvoiceEmailContext(req.params.id);
      if (!context.ok) return context.respond(res);
      const input = validateStaffEmailInput(req.body);
      if (!input.ok) return invalidEmail(res, input.issues);
      const mailService = createConfiguredMailService(config);
      if (!mailService) return mailNotConfigured(res);
      const { invoice } = context;
      const signature = await loadSignature(String(res.locals.staffUser.id));
      const { outboxId, result } = await sendStaffEmail(
        mailService,
        `invoice:${invoice.id}`,
        input.value.idempotencyKey,
        async () => ({
          ...(invoice.orderId ? { orderId: invoice.orderId } : {}),
          kind: "INVOICE",
          to: [input.value.to],
          subject: input.value.subject,
          contentHtml: input.value.contentHtml,
          attachments: [
            {
              filename: invoicePdfFilename(invoice),
              content: (await generateInvoicePdf(invoice)).toString("base64"),
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
  router.post("/", async (req, res, next) => {
    try {
      const input = validateInvoice(req.body, true);
      if (!input.ok) return invalid(res, input.message);
      const invoice = await createInvoice(input.value);
      res.status(201).json({ data: toInvoiceDto(invoice) });
    } catch (error) {
      if (isUnique(error)) return numberInUse(res);
      next(error);
    }
  });
  router.get("/from-order/:orderNumber", async (req, res, next) => {
    try {
      const orderNumber = Number(req.params.orderNumber);
      if (!Number.isSafeInteger(orderNumber) || orderNumber < 1)
        return notFound(res);
      const order = await prisma.order.findUnique({
        where: { orderNumber },
        include: orderRelations,
      });
      if (!order) return notFound(res);
      if (order.archivedAt) return archivedOrder(res);
      const existing = await prisma.invoice.findUnique({
        where: { orderId: order.id },
      });
      if (existing) {
        res.status(409).json({
          error: {
            code: "INVOICE_ALREADY_EXISTS",
            message: "Für diesen Auftrag existiert bereits eine Rechnung.",
          },
        });
        return;
      }
      const data = orderDataWithRelations(order);
      const customer = data.customer;
      const destination = data.to;
      const input: InvoiceInput = {
        invoiceDate: new Date().toISOString().slice(0, 10),
        company: stringValue(customer?.company),
        customerName: order.customerName,
        customerStreet: stringValue(destination?.street),
        customerPostalCity: [
          stringValue(destination?.postalCode),
          stringValue(destination?.city),
        ]
          .filter(Boolean)
          .join(" "),
        taxPercent: 19,
        text: "",
        entries: [],
        dueDates: [],
      };
      res.setHeader("Cache-Control", "no-store");
      res.json({
        data: { ...input, orderOverview: toOrderOverview(orderNumber, data) },
      });
    } catch (error) {
      next(error);
    }
  });
  router.post("/from-order/:orderNumber", async (req, res, next) => {
    try {
      const orderNumber = Number(req.params.orderNumber);
      if (!Number.isSafeInteger(orderNumber) || orderNumber < 1)
        return notFound(res);
      const input = validateInvoice(req.body, true);
      if (!input.ok) return invalid(res, input.message);
      const order = await prisma.order.findUnique({
        where: { orderNumber },
        select: { id: true, orderNumber: true, archivedAt: true },
      });
      if (!order) return notFound(res);
      if (order.archivedAt) return archivedOrder(res);
      const existing = await prisma.invoice.findUnique({
        where: { orderId: order.id },
      });
      if (existing) {
        res.status(409).json({
          error: {
            code: "INVOICE_ALREADY_EXISTS",
            message: "Für diesen Auftrag existiert bereits eine Rechnung.",
          },
        });
        return;
      }
      const invoice = await createInvoice(input.value, order);
      res.status(201).json({ data: toInvoiceDto(invoice) });
    } catch (error) {
      if (error instanceof InvoiceOrderError) {
        if (error.code === "ORDER_ARCHIVED") return archivedOrder(res);
        return notFound(res);
      }
      if (isUnique(error)) {
        res.status(409).json({
          error: {
            code: "INVOICE_CONFLICT",
            message:
              "Die Rechnungsnummer oder der Auftrag ist bereits einer Rechnung zugeordnet.",
          },
        });
        return;
      }
      next(error);
    }
  });
  router.put("/:id", async (req, res, next) => {
    try {
      const revision: unknown = req.body?.revision;
      if (
        typeof revision !== "number" ||
        !Number.isInteger(revision) ||
        revision < 0 ||
        revision >= 2_147_483_647
      ) {
        return invalid(
          res,
          "Eine gültige Rechnungsrevision ist erforderlich. Bitte laden Sie die Rechnung neu.",
        );
      }
      const input = validateInvoice(req.body);
      if (!input.ok) return invalid(res, input.message);
      const existing = await prisma.invoice.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) return notFound(res);
      if (existing.archivedAt) return archivedInvoice(res);
      const invoice = await updateInvoice(
        existing.id,
        input.value,
        existing.invoiceNumber,
        revision,
      );
      res.json({ data: toInvoiceDto(invoice) });
    } catch (error) {
      if (isMissing(error) || error instanceof InvoiceUpdateConflict) {
        const latest = await prisma.invoice.findUnique({
          where: { id: req.params.id },
          select: { archivedAt: true },
        });
        if (!latest) return notFound(res);
        res.status(409).json({
          error: latest.archivedAt
            ? {
                code: "INVOICE_ARCHIVED",
                message:
                  "Archivierte Rechnungen müssen zuerst wiederhergestellt werden.",
              }
            : {
                code: "INVOICE_CONFLICT",
                message:
                  "Die Rechnung wurde zwischenzeitlich geändert. Bitte laden Sie sie neu.",
              },
        });
        return;
      }
      if (isUnique(error)) return numberInUse(res);
      next(error);
    }
  });
  router.post("/:id/archive", async (req, res, next) => {
    try {
      const invoice = await archiveInvoice(req.params.id, new Date());
      res.json({ data: toInvoiceDto(invoice) });
    } catch (error) {
      if (isMissing(error)) return notFound(res);
      next(error);
    }
  });
  router.post("/:id/restore", async (req, res, next) => {
    try {
      const invoice = await restoreInvoice(req.params.id);
      res.json({ data: toInvoiceDto(invoice) });
    } catch (error) {
      if (isMissing(error)) return notFound(res);
      next(error);
    }
  });
  return router;
}
async function loadInvoiceEmailContext(id: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { order: { include: orderRelations } },
  });
  if (!invoice) return { ok: false as const, respond: notFound };
  if (invoice.archivedAt)
    return { ok: false as const, respond: archivedInvoice };
  const customer = invoice.order
    ? (orderDataWithRelations(invoice.order) as CreateOrderInput).customer
    : undefined;
  return {
    ok: true as const,
    invoice,
    draft: invoiceEmail(
      invoice.invoiceNumber,
      customer,
      invoice.customerNameSnapshot,
    ),
  };
}
function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function toOrderOverview(
  orderNumber: number,
  order: CreateOrderInput,
): AdminInvoiceOrderOverview {
  return {
    orderNumber,
    movingDate: order.movingDate,
    conditions: order.details?.conditions ?? [],
  };
}
function notFound(res: Response) {
  res.status(404).json({
    error: { code: "INVOICE_NOT_FOUND", message: "Rechnung nicht gefunden." },
  });
}
function archivedOrder(res: Response) {
  res.status(409).json({
    error: {
      code: "ORDER_ARCHIVED",
      message:
        "Archivierte Aufträge müssen vor der Rechnungserstellung wiederhergestellt werden.",
    },
  });
}
function invalid(res: Response, message: string) {
  res.status(400).json({ error: { code: "INVALID_INVOICE", message } });
}
function archivedInvoice(res: Response) {
  res.status(409).json({
    error: {
      code: "INVOICE_ARCHIVED",
      message: "Archivierte Rechnungen müssen zuerst wiederhergestellt werden.",
    },
  });
}
function numberInUse(res: Response) {
  res.status(409).json({
    error: {
      code: "INVOICE_NUMBER_IN_USE",
      message: "Diese Rechnungsnummer wird bereits verwendet.",
    },
  });
}
function pageInteger(value: unknown, fallback: number): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}
function isMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  );
}
function isUnique(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
