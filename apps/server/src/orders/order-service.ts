import { randomUUID } from "node:crypto";
import type {
  AppSettingsDto,
  CreateOrderInput,
  OrderFurnitureInput,
  OrderServiceInput,
} from "@vega/domain";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma.js";
import { runTransaction } from "../transaction.js";
import { emailDefaults } from "../mail/email-template.js";
import { attachUploadClaims } from "../uploads/upload-service.js";
import { orderRelationCreates } from "./order-relations.js";
import { validateOrderWriteInput } from "./order-input.js";
import { validatePricingSnapshot } from "./order-pricing-service.js";
import { roundAmountToCents } from "@vega/domain";

export async function createOrder(
  input: CreateOrderInput,
  source: "public" | "admin",
  actorName = "-",
  settings?: AppSettingsDto,
) {
  let normalizedInput = await normalizeOrderCatalogInput(
    input,
    undefined,
    prisma,
    {
      allowHiddenCatalogItems: source === "admin",
    },
  );
  if (source === "admin")
    normalizedInput = roundChangedOrderConditions(normalizedInput);
  if (source === "public" && normalizedInput.details) {
    const furniture = normalizedInput.details.furniture;
    normalizedInput = {
      ...normalizedInput,
      details: {
        ...normalizedInput.details,
        furniture: {
          ...furniture,
          volumeComplete:
            !(furniture.boxes > 0 && !settings?.boxCbm) &&
            !(furniture.wardrobeBoxes > 0 && !settings?.kleiderboxCbm),
          volume:
            furniture.items.reduce(
              (volume, item) => volume + item.quantity * (item.volume ?? 0),
              0,
            ) +
            furniture.boxes * (settings?.boxCbm ?? 0) +
            furniture.wardrobeBoxes * (settings?.kleiderboxCbm ?? 0),
        },
      },
    };
  }
  normalizedInput = validateOrderWriteInput(normalizedInput);
  const customerName =
    `${normalizedInput.customer.firstName} ${normalizedInput.customer.lastName}`.trim();
  const { imageClaims = [], ...storedInput } = normalizedInput;

  return runTransaction(async (transaction) => {
    if (source === "admin" && normalizedInput.pricingSnapshot) {
      const pricingSnapshot = await validatePricingSnapshot(
        normalizedInput,
        undefined,
        transaction,
      );
      if (pricingSnapshot) {
        normalizedInput = { ...normalizedInput, pricingSnapshot };
        storedInput.pricingSnapshot = pricingSnapshot;
      }
    }
    const data = JSON.parse(
      JSON.stringify(storedInput),
    ) as Prisma.InputJsonValue;
    const sequence = await transaction.orderNumberSequence.update({
      where: { id: 1 },
      data: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });
    const orderNumber = sequence.nextValue - 1;
    const order = await transaction.order.create({
      data: {
        id: randomUUID(),
        orderNumber,
        customerName,
        customerEmail: normalizedInput.customer.email || null,
        customerPhone: normalizedInput.customer.phone,
        // `source` is the business-facing acquisition channel displayed in the
        // order list, never the technical caller type (public/admin).
        source:
          normalizedInput.orderSource ??
          (source === "public" ? "umzugruckzuck24.de" : "individuelle"),
        data,
        ...orderRelationCreates(storedInput),
      },
      select: { id: true },
    });
    await attachUploadClaims(transaction, order.id, imageClaims);
    await transaction.orderActivityEvent.create({
      data: {
        id: randomUUID(),
        orderId: order.id,
        action: source === "public" ? "CREATED_PUBLIC" : "CREATED_ADMIN",
        actorName,
      },
    });
    let outboxId: string | undefined;
    const outboxIds: string[] = [];
    if (source === "public" && normalizedInput.customer.email) {
      const draft = emailDefaults.inquiryReceived(customerName, orderNumber);
      const outbox = await transaction.emailOutbox.create({
        data: {
          id: randomUUID(),
          orderId: order.id,
          kind: "INQUIRY_RECEIVED",
          recipients: [normalizedInput.customer.email],
          subject: draft.subject,
          contentHtml: draft.contentHtml,
          idempotencyKey: `order:${order.id}:inquiry-received:customer`,
          nextAttemptAt: new Date(),
        },
        select: { id: true },
      });
      outboxId = outbox.id;
      outboxIds.push(outbox.id);
    }
    if (source === "public" && settings?.companyEmail) {
      const draft = emailDefaults.inquiryNotification(
        customerName,
        orderNumber,
      );
      const outbox = await transaction.emailOutbox.create({
        data: {
          id: randomUUID(),
          orderId: order.id,
          kind: "INQUIRY_RECEIVED",
          recipients: [settings.companyEmail],
          subject: draft.subject,
          contentHtml: draft.contentHtml,
          idempotencyKey: `order:${order.id}:inquiry-received:company`,
          nextAttemptAt: new Date(),
        },
        select: { id: true },
      });
      outboxIds.push(outbox.id);
    }
    return { orderNumber, outboxId, outboxIds };
  });
}

export function roundChangedOrderConditions(
  input: CreateOrderInput,
  previous?: CreateOrderInput,
): CreateOrderInput {
  if (!input.details) return input;
  return {
    ...input,
    details: {
      ...input.details,
      conditions: input.details.conditions.map((condition, index) => {
        const saved = previous?.details?.conditions[index];
        const unchanged =
          saved?.amount === condition.amount &&
          saved.kind === condition.kind &&
          saved.quantity === condition.quantity &&
          saved.unitPrice === condition.unitPrice;
        return unchanged
          ? condition
          : { ...condition, amount: roundAmountToCents(condition.amount) };
      }),
    },
  };
}

export async function normalizeOrderCatalogInput(
  input: CreateOrderInput,
  storedInput?: CreateOrderInput,
  catalog: Pick<
    Prisma.TransactionClient,
    "catalogFurniture" | "catalogService" | "catalogPacking"
  > = prisma,
  {
    allowHiddenCatalogItems = false,
  }: { allowHiddenCatalogItems?: boolean } = {},
): Promise<CreateOrderInput> {
  input = validateOrderWriteInput(input);
  let normalizedInput = input;
  const storedFurniture = [...(storedInput?.details?.furniture.items ?? [])];
  const furnitureSnapshots = new Map<
    OrderFurnitureInput,
    OrderFurnitureInput
  >();
  // Only persisted snapshots qualify as historical, at most once per saved row.
  // A quantity edit keeps that snapshot; replacing its metadata uses today's catalog.
  for (const item of input.details?.furniture.items ?? []) {
    if (item.catalogId === undefined) continue;
    const index = storedFurniture.findIndex(
      (stored) =>
        stored.catalogId === item.catalogId &&
        stored.name === item.name &&
        stored.volume === item.volume &&
        stored.category === item.category,
    );
    if (index >= 0) {
      const [stored] = storedFurniture.splice(index, 1);
      furnitureSnapshots.set(item, { ...stored!, quantity: item.quantity });
    }
  }
  const catalogIds = [
    ...new Set(
      input.details?.furniture.items.flatMap((item) =>
        item.catalogId === undefined || furnitureSnapshots.has(item)
          ? []
          : [item.catalogId],
      ) ?? [],
    ),
  ];
  if (catalogIds.length > 0) {
    const catalogFurniture = await catalog.catalogFurniture.findMany({
      where: { id: { in: catalogIds } },
      include: {
        categories: { include: { category: { select: { name: true } } } },
      },
    });
    if (catalogFurniture.length !== catalogIds.length)
      throw new Error("INVALID_ORDER_CATALOG_REFERENCE");
    const byId = new Map(catalogFurniture.map((item) => [item.id, item]));
    normalizedInput = {
      ...input,
      details: {
        ...input.details!,
        furniture: {
          ...input.details!.furniture,
          items: input.details!.furniture.items.map((item) => {
            const snapshot = furnitureSnapshots.get(item);
            if (snapshot) return snapshot;
            if (item.catalogId === undefined) return item;
            const catalogItem = byId.get(item.catalogId);
            if (!catalogItem)
              throw new Error("INVALID_ORDER_CATALOG_REFERENCE");
            const { category: _untrustedCategory, ...itemWithoutCategory } =
              item;
            const category =
              catalogItem.categories.find(
                (entry) => entry.category.name === item.category,
              )?.category.name ?? catalogItem.categories[0]?.category.name;
            return {
              ...itemWithoutCategory,
              name: catalogItem.name,
              volume: Number(catalogItem.volume),
              ...(category !== undefined ? { category } : {}),
            };
          }),
        },
      },
    };
  }

  const submittedServices = normalizedInput.details?.extras.services ?? [];
  const storedServices = [...(storedInput?.details?.extras.services ?? [])];
  const serviceSnapshots = new Map<OrderServiceInput, OrderServiceInput>();
  for (const service of submittedServices) {
    if (service.catalogId === undefined) continue;
    const index = storedServices.findIndex(
      (stored) =>
        stored.catalogId === service.catalogId &&
        stored.name === service.name &&
        stored.kind === service.kind,
    );
    if (index >= 0) {
      const [stored] = storedServices.splice(index, 1);
      serviceSnapshots.set(service, {
        ...stored!,
        quantity: service.quantity,
        ...(service.unitPrice !== undefined
          ? { unitPrice: service.unitPrice }
          : {}),
      });
    }
  }
  const selectedServiceIds = [
    ...new Set(
      submittedServices.flatMap((service) =>
        service.catalogId === undefined || serviceSnapshots.has(service)
          ? []
          : [service.catalogId],
      ),
    ),
  ];
  if (selectedServiceIds.length > 0) {
    const [serviceItems, packingItems] = await Promise.all([
      catalog.catalogService.findMany({
        where: {
          id: { in: selectedServiceIds },
          ...(!allowHiddenCatalogItems ? { show: true } : {}),
        },
        select: { id: true, name: true },
      }),
      catalog.catalogPacking.findMany({
        where: {
          id: { in: selectedServiceIds },
          ...(!allowHiddenCatalogItems ? { show: true } : {}),
        },
        select: { id: true, name: true },
      }),
    ]);
    const namesByKind = {
      service: new Map(serviceItems.map((item) => [item.id, item.name])),
      packaging: new Map(packingItems.map((item) => [item.id, item.name])),
    };
    normalizedInput = {
      ...normalizedInput,
      details: {
        ...normalizedInput.details!,
        extras: {
          ...normalizedInput.details!.extras,
          services: submittedServices.map((service) => {
            const snapshot = serviceSnapshots.get(service);
            if (snapshot) return snapshot;
            if (service.catalogId === undefined) return service;
            const catalogName = namesByKind[service.kind].get(
              service.catalogId,
            );
            if (!catalogName)
              throw new Error("INVALID_ORDER_CATALOG_REFERENCE");
            return { ...service, name: catalogName };
          }),
        },
      },
    };
  }
  return validateOrderWriteInput(normalizedInput);
}
