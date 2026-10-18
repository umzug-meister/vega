import type { Request, Response, Router } from "express";
import type {
  AdminOrderFamilyMember,
  CreateOrderInput,
  EmailDraft,
  OrderEmailKind,
} from "@vega/domain";
import type { Prisma } from "../generated/prisma/client.js";
import type { AppConfig } from "../config.js";
import { prisma } from "../prisma.js";
import { createConfiguredMailService } from "../mail/configured-mail-service.js";
import {
  declineEmail,
  offerEmail,
  type EmailDraftContent,
} from "../mail/staff-email-templates.js";
import {
  invalidEmail,
  mailNotConfigured,
  respondWithSendResult,
  respondWithStaffEmailStatus,
  sendStaffEmail,
  validateStaffEmailInput,
} from "../mail/staff-email-service.js";
import { orderPdfFilename } from "../pdf/order-pdf.js";
import { orderDataWithRelations, orderRelations } from "./order-relations.js";
import { renderOrderPdf } from "./order-pdf-service.js";
import { loadSignature } from "../staff/signature-name.js";

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof orderRelations;
}>;

interface EmailContext {
  kind: OrderEmailKind;
  order: OrderWithRelations;
  partner?: OrderWithRelations;
  draft: EmailDraftContent;
}

type ContextResult =
  | { ok: true; value: EmailContext }
  | { ok: false; status: number; code: string; message: string };

const ORDER_EMAIL_KINDS: readonly OrderEmailKind[] = [
  "offer",
  "offer-pair",
  "decline",
];

/**
 * Staff mail routes for one order. "offer-pair" is only allowed from a copy
 * and combines it with exactly one other non-archived member of the same
 * family; the server rebuilds the family on every request.
 */
export function registerOrderEmailRoutes(
  router: Router,
  config: Pick<AppConfig, "mail">,
): void {
  router.get("/:orderNumber/family", async (req, res, next) => {
    try {
      const orderNumber = parseOrderNumber(req.params.orderNumber);
      if (orderNumber === null) return notFound(res);
      const order = await prisma.order.findUnique({
        where: { orderNumber },
        select: { id: true, originOrderId: true },
      });
      if (!order) return notFound(res);
      const rootId = order.originOrderId ?? order.id;
      const members = await prisma.order.findMany({
        where: { OR: [{ id: rootId }, { originOrderId: rootId }] },
        orderBy: { orderNumber: "asc" },
        select: { id: true, orderNumber: true, archivedAt: true, data: true },
      });
      const items: AdminOrderFamilyMember[] = members.map((member) => {
        const data = asRecord(member.data);
        const basis = asRecord(asRecord(data?.details)?.basis);
        return {
          orderNumber: member.orderNumber,
          isOrigin: member.id === rootId,
          archived: member.archivedAt !== null,
          movingDate:
            typeof data?.movingDate === "string" ? data.movingDate : "",
          workers: numberValue(basis?.workers),
          trucks: numberValue(basis?.trucks),
        };
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: { items } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:orderNumber/email-draft", async (req, res, next) => {
    try {
      const context = await resolveContext(
        req.params.orderNumber,
        req.query.kind,
        req.query.partner,
      );
      if (!context.ok) return fail(res, context);
      const { order, partner, draft } = context.value;
      const attachmentNames =
        context.value.kind === "decline"
          ? []
          : [order, ...(partner ? [partner] : [])].map((entry) =>
              orderPdfFilename({
                orderNumber: entry.orderNumber,
                data: orderDataWithRelations(entry),
              }),
            );
      const body: EmailDraft = {
        to: order.customerEmail ?? "",
        subject: draft.subject,
        contentHtml: draft.contentHtml,
        attachmentNames,
      };
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: body });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:orderNumber/emails/status", async (req, res, next) => {
    try {
      const orderNumber = parseOrderNumber(req.params.orderNumber);
      if (orderNumber === null) return notFound(res);
      const order = await prisma.order.findUnique({
        where: { orderNumber },
        select: { id: true },
      });
      if (!order) return notFound(res);
      await respondWithStaffEmailStatus(
        req as Request,
        res,
        `order:${order.id}`,
        { orderId: order.id },
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/:orderNumber/emails", async (req, res, next) => {
    try {
      const body = asRecord(req.body) ?? {};
      const partnerParam =
        typeof body.partnerOrderNumber === "number"
          ? String(body.partnerOrderNumber)
          : undefined;
      const context = await resolveContext(
        req.params.orderNumber,
        body.kind,
        partnerParam,
      );
      if (!context.ok) return fail(res, context);
      const input = validateStaffEmailInput(body);
      if (!input.ok) return invalidEmail(res, input.issues);
      const mailService = createConfiguredMailService(config);
      if (!mailService) return mailNotConfigured(res);
      const { kind, order, partner } = context.value;
      const actorName = String(res.locals.staffUser.name);
      const signature = await loadSignature(String(res.locals.staffUser.id));
      const { outboxId, result } = await sendStaffEmail(
        mailService,
        `order:${order.id}`,
        input.value.idempotencyKey,
        async () => {
          const pdfs =
            kind === "decline"
              ? []
              : await Promise.all(
                  [order, ...(partner ? [partner] : [])].map(renderOrderPdf),
                );
          return {
            orderId: order.id,
            ...(partner ? { optionOrderId: partner.id } : {}),
            kind: kind === "decline" ? "INQUIRY_DECLINED" : "OFFER",
            to: [input.value.to],
            subject: input.value.subject,
            contentHtml: input.value.contentHtml,
            ...(pdfs.length
              ? {
                  attachments: pdfs.map(({ pdf, filename }) => ({
                    filename,
                    content: pdf.toString("base64"),
                    contentType: "application/pdf",
                  })),
                }
              : {}),
            actorName,
            ...signature,
          };
        },
      );
      respondWithSendResult(req as Request, res, outboxId, result);
    } catch (error) {
      next(error);
    }
  });
}

async function resolveContext(
  orderNumberParam: unknown,
  kindParam: unknown,
  partnerParam: unknown,
): Promise<ContextResult> {
  const orderNumber = parseOrderNumber(orderNumberParam);
  if (orderNumber === null) return orderNotFound;
  if (
    typeof kindParam !== "string" ||
    !ORDER_EMAIL_KINDS.includes(kindParam as OrderEmailKind)
  ) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_EMAIL_KIND",
      message: "Unbekannte E-Mail-Art.",
    };
  }
  const kind = kindParam as OrderEmailKind;
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: orderRelations,
  });
  if (!order) return orderNotFound;
  if (order.archivedAt)
    return {
      ok: false,
      status: 409,
      code: "ORDER_ARCHIVED",
      message:
        "Archivierte Aufträge müssen vor dem Versand wiederhergestellt werden.",
    };
  const data = orderDataWithRelations(order) as CreateOrderInput;
  if (kind === "decline")
    return {
      ok: true,
      value: {
        kind,
        order,
        draft: declineEmail(order.orderNumber, data.customer),
      },
    };
  if (kind === "offer") {
    return {
      ok: true,
      value: {
        kind,
        order,
        draft: offerEmail({
          option: { orderNumber: order.orderNumber, data },
          referenceNumber: order.orderNumber,
          now: new Date(),
        }),
      },
    };
  }
  if (!order.originOrderId) {
    return {
      ok: false,
      status: 400,
      code: "OFFER_PAIR_REQUIRES_COPY",
      message:
        "Zwei Angebote können nur aus einer Auftragskopie versendet werden.",
    };
  }
  const partnerNumber = parseOrderNumber(partnerParam);
  const partner =
    partnerNumber === null
      ? null
      : await prisma.order.findUnique({
          where: { orderNumber: partnerNumber },
          include: orderRelations,
        });
  const sameFamily =
    partner !== null &&
    partner.id !== order.id &&
    (partner.id === order.originOrderId ||
      partner.originOrderId === order.originOrderId);
  if (!partner || !sameFamily || partner.archivedAt) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_OFFER_PARTNER",
      message:
        "Bitte wählen Sie einen anderen, nicht archivierten Auftrag derselben Auftragsfamilie.",
    };
  }
  const root =
    partner.id === order.originOrderId
      ? partner
      : await prisma.order.findUniqueOrThrow({
          where: { id: order.originOrderId },
          select: { orderNumber: true },
        });
  const draft = offerEmail({
    option: { orderNumber: order.orderNumber, data },
    secondOption: {
      orderNumber: partner.orderNumber,
      data: orderDataWithRelations(partner) as CreateOrderInput,
    },
    referenceNumber: root.orderNumber,
    now: new Date(),
  });
  return { ok: true, value: { kind, order, partner, draft } };
}

const orderNotFound = {
  ok: false,
  status: 404,
  code: "ORDER_NOT_FOUND",
  message: "Auftrag nicht gefunden.",
} as const;

function fail(
  res: Response,
  error: { status: number; code: string; message: string },
) {
  res
    .status(error.status)
    .json({ error: { code: error.code, message: error.message } });
}
function notFound(res: Response) {
  fail(res, orderNotFound);
}
function parseOrderNumber(value: unknown): number | null {
  return typeof value === "string" &&
    /^\d+$/u.test(value) &&
    Number(value) > 0 &&
    Number(value) <= 2_147_483_647
    ? Number(value)
    : null;
}
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
