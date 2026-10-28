import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { Router, type Response } from "express";
import { prisma } from "../prisma.js";
import { isTransactionConflict } from "../transaction.js";
import { createAdminRateLimit } from "../http-rate-limit.js";
import {
  hasUnchangedCustomerDateRange,
  OrderInputError,
  validateOrderCreateInput,
  validateOrderWriteInput,
} from "./order-input.js";
import {
  normalizeOrderCatalogInput,
  roundChangedOrderConditions,
} from "./order-service.js";
import {
  orderPricingErrorIssue,
  PricePreviewStaleError,
  previewOrderPricing,
  validatePricingSnapshot,
} from "./order-pricing-service.js";
import {
  orderDataWithRelations,
  orderRelationCreates,
  orderRelations,
} from "./order-relations.js";
import { renderOrderPdf } from "./order-pdf-service.js";
import { registerOrderEmailRoutes } from "./order-email-routes.js";
import type { AppConfig } from "../config.js";
import { normalizeOrderSearch, orderListWhere } from "./order-search.js";

const PAGE_SIZE_MAX = 100;
const ARCHIVE_RETENTION_DAYS = 60;

export function createAdminOrderRouter(
  config: Pick<AppConfig, "mail"> = { mail: null },
) {
  const router = Router();
  // Standard per-staff limiter at the router boundary (app-level admin
  // limiter also applies; both use generous quotas for staff workflows).
  router.use(createAdminRateLimit());
  registerOrderEmailRoutes(router, config);

  router.post("/pricing-preview", async (req, res, next) => {
    try {
      const validation = validateOrderCreateInput(req.body, {
        allowStaffPricing: true,
        allowIncomplete: true,
      });
      if (!validation.ok) return invalidOrder(res, validation.issues);
      const normalized = await normalizeOrderCatalogInput(
        validation.value,
        undefined,
        prisma,
        { allowHiddenCatalogItems: true },
      );
      const preview = await previewOrderPricing(normalized, prisma);
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: preview });
    } catch (error) {
      const issue = orderPricingErrorIssue(error);
      if (issue) return invalidOrder(res, [issue]);
      if (error instanceof Error && error.message === "PRICE_CATALOG_CHANGED") {
        res.status(409).json({
          error: {
            code: "PRICE_CATALOG_CHANGED",
            message:
              "Der Preiskatalog wurde seit der Vorschau geändert. Bitte berechnen Sie das Angebot erneut.",
          },
        });
        return;
      }
      if (error instanceof Error && error.message === "PRICE_PREVIEW_STALE") {
        res.status(409).json({
          error: {
            code: "PRICE_PREVIEW_STALE",
            message:
              "Preisrelevante Angaben wurden seit der Vorschau geändert. Bitte berechnen Sie das Angebot erneut.",
          },
        });
        return;
      }
      if (
        error instanceof Error &&
        error.message === "INVALID_ORDER_CATALOG_REFERENCE"
      ) {
        res.status(400).json({
          error: {
            code: "INVALID_ORDER_CATALOG_REFERENCE",
            message:
              "Eine ausgewählte Katalogposition ist nicht mehr verfügbar.",
          },
        });
        return;
      }
      next(error);
    }
  });

  router.get("/", async (req, res, next) => {
    const archived = req.query.archived === "true";
    const { search, kind, orderNumber } = normalizeOrderSearch(
      req.query.search,
    );
    const page = parsePositiveInteger(req.query.page) ?? 1;
    const pageSize = Math.min(
      parsePositiveInteger(req.query.pageSize) ?? 25,
      PAGE_SIZE_MAX,
    );
    try {
      const where = orderListWhere({ archived, search, orderNumber });
      const [total, orders] = await prisma.$transaction([
        prisma.order.count({ where }),
        prisma.order.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: orderListSelect,
        }),
      ]);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        data: { items: orders.map(toOrderListItem), page, pageSize, total },
      });
    } catch (error) {
      res.locals.failureContext = {
        operation: "orders.list",
        searchKind: kind,
        searchLength: search.length,
        archived,
        page,
        pageSize,
      };
      next(error);
    }
  });

  router.get("/:orderNumber", async (req, res, next) => {
    try {
      const orderNumber = parseOrderNumber(req.params.orderNumber);
      if (orderNumber === null) return notFound(res);
      const order = await prisma.order.findUnique({
        where: { orderNumber },
        select: orderDetailSelect,
      });
      if (!order) return notFound(res);
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: toOrderDetail(order) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:orderNumber/journal", async (req, res, next) => {
    try {
      const orderNumber = parseOrderNumber(req.params.orderNumber);
      if (orderNumber === null) return notFound(res);
      const order = await prisma.order.findUnique({
        where: { orderNumber },
        select: { id: true },
      });
      if (!order) return notFound(res);
      const [activities, emailEvents] = await Promise.all([
        prisma.orderActivityEvent.findMany({
          where: { orderId: order.id },
          orderBy: { createdAt: "desc" },
          select: { id: true, action: true, actorName: true, createdAt: true },
        }),
        prisma.emailEvent.findMany({
          where: { orderId: order.id },
          orderBy: { sentAt: "desc" },
          select: { id: true, kind: true, actorName: true, sentAt: true },
        }),
      ]);
      const entries = [
        ...activities.map((entry) => ({
          id: entry.id,
          action: entry.action,
          actorName: entry.actorName || "-",
          occurredAt: entry.createdAt,
        })),
        ...emailEvents.map((entry) => ({
          id: entry.id,
          action: `EMAIL_SENT_${entry.kind}`,
          actorName: entry.actorName || "-",
          occurredAt: entry.sentAt,
        })),
      ].sort(
        (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
      );
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: { items: entries } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:orderNumber/pdf", async (req, res, next) => {
    try {
      const orderNumber = parseOrderNumber(req.params.orderNumber);
      if (orderNumber === null) return notFound(res);
      const order = await prisma.order.findUnique({
        where: { orderNumber },
        include: orderRelations,
      });
      if (!order) return notFound(res);
      const { pdf, filename } = await renderOrderPdf(order);
      await prisma.orderActivityEvent.create({
        data: {
          id: randomUUID(),
          orderId: order.id,
          action: "PDF_EXPORTED",
          actorName: String(res.locals.staffUser.name),
        },
      });
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      res.status(200).send(pdf);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:orderNumber/copy", async (req, res, next) => {
    try {
      const orderNumber = parseOrderNumber(req.params.orderNumber);
      if (orderNumber === null) return notFound(res);
      const actorName = String(res.locals.staffUser.name);
      const copy = await prisma
        .$transaction(async (tx) => {
          const active = await tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT id FROM \`order\` WHERE orderNumber = ${orderNumber} AND archivedAt IS NULL FOR UPDATE`;
          if (!active.length) throw new Error("ORDER_NOT_FOUND");
          const source = await tx.order.findFirst({
            where: { orderNumber, archivedAt: null },
            include: orderRelations,
          });
          if (!source) throw new Error("ORDER_NOT_FOUND");
          const input = validateOrderWriteInput(orderDataWithRelations(source));
          const sequence = await tx.orderNumberSequence.update({
            where: { id: 1 },
            data: { nextValue: { increment: 1 } },
            select: { nextValue: true },
          });
          const copied = await tx.order.create({
            data: {
              id: randomUUID(),
              orderNumber: sequence.nextValue - 1,
              customerName: source.customerName,
              customerEmail: source.customerEmail,
              customerPhone: source.customerPhone,
              source: source.source,
              data: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
              edited: true,
              originOrderId: source.originOrderId ?? source.id,
              ...orderRelationCreates(input),
            },
            select: { id: true, orderNumber: true },
          });
          const images = await tx.orderImage.findMany({
            where: { orderId: source.id },
          });
          if (images.length)
            await tx.orderImage.createMany({
              data: images.map((image) => ({
                ...image,
                id: randomUUID(),
                orderId: copied.id,
                tokenHash: "",
              })),
            });
          await tx.orderActivityEvent.create({
            data: {
              id: randomUUID(),
              orderId: copied.id,
              action: "COPIED",
              actorName,
            },
          });
          return copied;
        })
        .catch((error: unknown) =>
          error instanceof Error && error.message === "ORDER_NOT_FOUND"
            ? null
            : Promise.reject(error),
        );
      if (!copy) return notFound(res);
      res.status(201).json({ data: { orderNumber: copy.orderNumber } });
    } catch (error) {
      if (error instanceof OrderInputError)
        return invalidOrder(res, error.issues);
      if (isInvalidStoredOrder(error))
        return invalidOrder(res, [
          {
            field: "details",
            message:
              "Die gespeicherten Auftragsdaten sind ungültig und können nicht kopiert werden.",
          },
        ]);
      if (isTransactionConflict(error)) return orderConflict(res);
      next(error);
    }
  });

  router.put("/:orderNumber", async (req, res, next) => {
    try {
      const orderNumber = parseOrderNumber(req.params.orderNumber);
      if (orderNumber === null) return notFound(res);
      const revision: unknown = req.body?.revision;
      if (
        typeof revision !== "number" ||
        !Number.isInteger(revision) ||
        revision < 0 ||
        revision >= 2_147_483_647
      ) {
        return invalidOrder(res, [
          {
            field: "revision",
            message:
              "Bitte laden Sie den aktuellen Auftragsstand vor dem Speichern.",
          },
        ]);
      }
      const validation = validateOrderCreateInput(req.body, {
        allowStaffPricing: true,
        allowIncomplete: true,
      });
      if (!validation.ok) return invalidOrder(res, validation.issues);
      if (validation.value.imageClaims?.length)
        return invalidOrder(res, [
          {
            field: "imageClaims",
            message:
              "Bilder können nur bei der Anfrageanlage zugeordnet werden.",
          },
        ]);
      const actorName = String(res.locals.staffUser.name);
      try {
        const order = await prisma.$transaction(async (tx) => {
          const existing = await tx.order.findUnique({
            where: { orderNumber },
            include: orderRelations,
          });
          if (!existing) throw new Error("ORDER_NOT_FOUND");
          if (existing.archivedAt) throw new Error("ORDER_ARCHIVED");
          if (existing.revision !== revision) throw new Error("ORDER_CONFLICT");
          if (!hasUnchangedCustomerDateRange(validation.value, existing.data))
            throw new Error("CUSTOMER_DATE_RANGE_READ_ONLY");
          const storedInput = orderDataWithRelations(existing);
          const normalized = roundChangedOrderConditions(
            await normalizeOrderCatalogInput(
              validation.value,
              storedInput,
              tx,
              {
                allowHiddenCatalogItems: true,
              },
            ),
            storedInput,
          );
          const pricingSnapshot = await validatePricingSnapshot(
            normalized,
            storedInput.pricingSnapshot,
            tx,
          );
          if (pricingSnapshot) normalized.pricingSnapshot = pricingSnapshot;
          const customerName =
            `${normalized.customer.firstName} ${normalized.customer.lastName}`.trim();
          const relations = orderRelationCreates(normalized);
          // Claim and lock the parent before Prisma can execute nested relation writes.
          const claimed = await tx.order.updateMany({
            where: { id: existing.id, revision, archivedAt: null },
            data: {
              revision: { increment: 1 },
              customerName,
              customerEmail: normalized.customer.email || null,
              customerPhone: normalized.customer.phone,
              source: normalized.orderSource ?? "individuelle",
              data: JSON.parse(
                JSON.stringify(normalized),
              ) as Prisma.InputJsonValue,
              edited: true,
            },
          });
          if (claimed.count !== 1) throw new Error("ORDER_CONFLICT");
          const updated = await tx.order.update({
            where: { id: existing.id },
            data: {
              addresses: { deleteMany: {}, ...relations.addresses },
              positions: { deleteMany: {}, ...relations.positions },
            },
            select: orderDetailSelect,
          });
          await tx.orderActivityEvent.create({
            data: {
              id: randomUUID(),
              orderId: updated.id,
              action: "UPDATED",
              actorName,
            },
          });
          return updated;
        });
        res.setHeader("Cache-Control", "no-store");
        res.json({ data: toOrderDetail(order) });
      } catch (error) {
        if (
          isMissingOrder(error) ||
          isTransactionConflict(error) ||
          (error instanceof Error && error.message === "ORDER_CONFLICT")
        )
          return orderConflict(res);
        if (error instanceof Error && error.message === "ORDER_NOT_FOUND")
          return notFound(res);
        if (error instanceof OrderInputError)
          return invalidOrder(res, error.issues);
        const pricingIssue = orderPricingErrorIssue(error);
        if (pricingIssue) return invalidOrder(res, [pricingIssue]);
        if (
          error instanceof Error &&
          error.message === "PRICE_CATALOG_CHANGED"
        ) {
          res.status(409).json({
            error: {
              code: "PRICE_CATALOG_CHANGED",
              message:
                "Der Preiskatalog wurde seit der Vorschau geändert. Bitte berechnen Sie das Angebot erneut.",
            },
          });
          return;
        }
        if (error instanceof PricePreviewStaleError) {
          res.status(409).json({
            error: {
              code: "PRICE_PREVIEW_STALE",
              message:
                "Preisrelevante Angaben wurden seit der Vorschau geändert. Bitte berechnen Sie das Angebot erneut.",
              changedFields: error.changedFields,
            },
          });
          return;
        }
        if (
          error instanceof Error &&
          error.message === "INVALID_ORDER_CATALOG_REFERENCE"
        ) {
          res.status(400).json({
            error: {
              code: "INVALID_ORDER_CATALOG_REFERENCE",
              message:
                "Eine ausgewählte Katalogposition ist nicht mehr verfügbar.",
            },
          });
          return;
        }
        if (
          error instanceof Error &&
          error.message === "CUSTOMER_DATE_RANGE_READ_ONLY"
        ) {
          return invalidOrder(res, [
            {
              field: "dateFrom",
              message: "Von/Bis können nur im Kundenformular gesetzt werden.",
            },
          ]);
        }
        if (error instanceof Error && error.message === "ORDER_ARCHIVED") {
          res.status(409).json({
            error: {
              code: "ORDER_ARCHIVED",
              message:
                "Archivierte Aufträge müssen vor der Bearbeitung wiederhergestellt werden.",
            },
          });
          return;
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  router.post("/:orderNumber/archive", async (req, res, next) => {
    try {
      const orderNumber = parseOrderNumber(req.params.orderNumber);
      if (orderNumber === null) return notFound(res);
      const now = new Date();
      const purgeAt = new Date(
        now.getTime() + ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const actorName = String(res.locals.staffUser.name);
      const updated = await prisma
        .$transaction(async (tx) => {
          const existing = await tx.order.findFirst({
            where: { orderNumber, archivedAt: null },
            select: { id: true, updatedAt: true, revision: true },
          });
          if (!existing) throw new Error("ORDER_NOT_FOUND");
          const order = await tx.order.update({
            where: {
              id: existing.id,
              archivedAt: null,
              revision: existing.revision,
              updatedAt: existing.updatedAt,
            },
            data: {
              archivedAt: now,
              purgeAt,
              updatedAt: existing.updatedAt,
              revision: { increment: 1 },
            },
            select: {
              id: true,
              orderNumber: true,
              archivedAt: true,
              purgeAt: true,
            },
          });
          await tx.orderActivityEvent.create({
            data: {
              id: randomUUID(),
              orderId: order.id,
              action: "ARCHIVED",
              actorName,
            },
          });
          return order;
        })
        .catch((error: unknown) =>
          error instanceof Error && error.message === "ORDER_NOT_FOUND"
            ? null
            : Promise.reject(error),
        );
      if (!updated) return notFound(res);
      res.json({ data: updated });
    } catch (error) {
      if (isMissingOrder(error) || isTransactionConflict(error))
        return orderConflict(res);
      next(error);
    }
  });

  router.post("/:orderNumber/restore", async (req, res, next) => {
    try {
      const orderNumber = parseOrderNumber(req.params.orderNumber);
      if (orderNumber === null) return notFound(res);
      const actorName = String(res.locals.staffUser.name);
      const updated = await prisma
        .$transaction(async (tx) => {
          const existing = await tx.order.findFirst({
            where: { orderNumber, archivedAt: { not: null } },
            select: { id: true, updatedAt: true, revision: true },
          });
          if (!existing) throw new Error("ORDER_NOT_FOUND");
          const order = await tx.order.update({
            where: {
              id: existing.id,
              archivedAt: { not: null },
              revision: existing.revision,
              updatedAt: existing.updatedAt,
            },
            data: {
              archivedAt: null,
              purgeAt: null,
              updatedAt: existing.updatedAt,
              revision: { increment: 1 },
            },
            select: { id: true, orderNumber: true },
          });
          await tx.orderActivityEvent.create({
            data: {
              id: randomUUID(),
              orderId: order.id,
              action: "RESTORED",
              actorName,
            },
          });
          return order;
        })
        .catch((error: unknown) =>
          error instanceof Error && error.message === "ORDER_NOT_FOUND"
            ? null
            : Promise.reject(error),
        );
      if (!updated) return notFound(res);
      res.json({ data: updated });
    } catch (error) {
      if (isMissingOrder(error) || isTransactionConflict(error))
        return orderConflict(res);
      next(error);
    }
  });
  return router;
}

const orderListSelect = {
  orderNumber: true,
  customerName: true,
  source: true,
  createdAt: true,
  updatedAt: true,
  edited: true,
  archivedAt: true,
  purgeAt: true,
  originOrderId: true,
  data: true,
  ...orderRelations,
} satisfies Prisma.OrderSelect;
const orderDetailSelect = {
  id: true,
  revision: true,
  ...orderListSelect,
  data: true,
  originOrderId: true,
} satisfies Prisma.OrderSelect;

function toOrderListItem(
  order: Prisma.OrderGetPayload<{ select: typeof orderListSelect }>,
) {
  const data = asRecord(orderDataWithRelations(order));
  const from = asRecord(data?.from);
  const to = asRecord(data?.to);
  const basis = asRecord(asRecord(data?.details)?.basis);
  return {
    orderNumber: order.orderNumber,
    source: order.source,
    customerName: order.customerName,
    movingDate: stringValue(data?.movingDate),
    fromAddress: addressValue(from),
    fromParkingSlot: from?.parkingSlot === true,
    toAddress: addressValue(to),
    toParkingSlot: to?.parkingSlot === true,
    workers: numberValue(basis?.workers),
    trucks: numberValue(basis?.trucks),
    hours: numberValue(basis?.hours),
    createdAt: order.createdAt,
    editedAt: order.edited ? order.updatedAt : null,
    isCopy: order.originOrderId !== null,
    archivedAt: order.archivedAt,
  };
}
function toOrderDetail(
  order: Prisma.OrderGetPayload<{ select: typeof orderDetailSelect }>,
) {
  const { addresses: _addresses, positions: _positions, ...detail } = order;
  return {
    ...detail,
    isCopy: order.originOrderId !== null,
    data: orderDataWithRelations(order),
  };
}
function parsePositiveInteger(value: unknown): number | null {
  return typeof value === "string" && /^\d+$/u.test(value) && Number(value) > 0
    ? Number(value)
    : null;
}
function parseOrderNumber(value: unknown): number | null {
  const parsed = parsePositiveInteger(value);
  return parsed && parsed <= 2_147_483_647 ? parsed : null;
}
function notFound(res: Response) {
  res.status(404).json({
    error: { code: "ORDER_NOT_FOUND", message: "Auftrag nicht gefunden." },
  });
}
function invalidOrder(res: Response, issues: unknown) {
  res.status(400).json({
    error: {
      code: "INVALID_ORDER",
      message: "Bitte prüfen Sie die Auftragsdaten.",
      issues,
    },
  });
}
function orderConflict(res: Response) {
  res.status(409).json({
    error: {
      code: "ORDER_CONFLICT",
      message:
        "Der Auftrag wurde zwischenzeitlich geändert. Ihr Entwurf bleibt erhalten. Bitte laden Sie den aktuellen Stand neu und gleichen Sie Ihre Änderungen ab.",
    },
  });
}
function isMissingOrder(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  );
}
function isInvalidStoredOrder(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^INVALID_STORED_ORDER(?:_RELATIONS)?$/u.test(error.message)
  );
}
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function addressValue(address: Record<string, unknown> | undefined): string {
  return [
    stringValue(address?.street),
    stringValue(address?.postalCode),
    stringValue(address?.city),
  ]
    .filter(Boolean)
    .join(", ");
}
