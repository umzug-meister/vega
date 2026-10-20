import type {
  CatalogOfferDto,
  CatalogServiceRateDto,
  CreateOrderInput,
  OrderPricingPreview,
  OrderPricingSnapshot,
  OrderServiceInput,
  ServiceRateKey,
} from "@vega/domain";
import {
  calculateOrderPricing,
  OrderPricingError,
  SERVICE_RATE_KEYS,
} from "@vega/domain";
import type { Prisma } from "../generated/prisma/client.js";
import type { OrderInputIssue } from "./order-input.js";

type PricingClient = Pick<
  Prisma.TransactionClient,
  "catalogOffer" | "catalogService" | "catalogPacking" | "catalogServiceRate"
>;

export class PricePreviewStaleError extends Error {
  constructor(readonly changedFields: string[]) {
    super("PRICE_PREVIEW_STALE");
    this.name = "PricePreviewStaleError";
  }
}

export async function previewOrderPricing(
  input: CreateOrderInput,
  client: PricingClient,
): Promise<OrderPricingPreview> {
  const details = input.details;
  if (!details) throw new OrderPricingError("PRICE_NOT_CONFIGURED");
  if (
    details.extras.services.some(
      (service) =>
        service.catalogId === undefined && service.unitPrice === undefined,
    )
  ) {
    throw new Error("UNPRICED_ORDER_SERVICE");
  }

  const [offerRow, services, packings, rateRows] = await Promise.all([
    details.basis.hours <= 0 || details.basis.offerId === undefined
      ? Promise.resolve(null)
      : client.catalogOffer.findUnique({
          where: { id: details.basis.offerId },
        }),
    client.catalogService.findMany({
      orderBy: [{ sort: "asc" }, { id: "asc" }],
      select: { id: true, name: true, price: true, sort: true },
    }),
    client.catalogPacking.findMany({
      orderBy: [{ sort: "asc" }, { id: "asc" }],
      select: { id: true, name: true, price: true, sort: true },
    }),
    client.catalogServiceRate.findMany({
      where: { key: { in: [...SERVICE_RATE_KEYS] } },
      orderBy: { key: "asc" },
      select: { key: true, price: true },
    }),
  ]);
  if (
    details.basis.hours > 0 &&
    details.basis.offerId !== undefined &&
    !offerRow
  )
    throw new Error("PRICE_NOT_CONFIGURED");
  if (
    offerRow &&
    (offerRow.workers !== details.basis.workers ||
      offerRow.trucks !== details.basis.trucks ||
      offerRow.includedHours !== details.basis.hours)
  ) {
    throw new Error("OFFER_MISMATCH");
  }

  const serviceByKind = {
    service: new Map(services.map((service) => [service.id, service])),
    packaging: new Map(packings.map((packing) => [packing.id, packing])),
  };
  const pricedServices = details.extras.services.map((service) => {
    if (service.catalogId === undefined) {
      return { ...service, price: service.unitPrice! };
    }
    const catalogItem = serviceByKind[service.kind].get(service.catalogId);
    // A hidden or removed catalog item can still be priced by a staff-entered
    // unit price; the catalog price is only the fallback when a row is available.
    if (!catalogItem) {
      if (service.unitPrice === undefined)
        throw new Error("PRICE_NOT_CONFIGURED");
      return { ...service, price: service.unitPrice };
    }
    return {
      ...service,
      name: catalogItem.name,
      price: service.unitPrice ?? Number(catalogItem.price),
    };
  });
  const catalogServices = [
    ...services.map((service) => ({
      id: service.id,
      kind: "service" as const,
      name: service.name,
      price: Number(service.price),
      sort: service.sort,
    })),
    ...packings.map((packing) => ({
      id: packing.id,
      kind: "packaging" as const,
      name: packing.name,
      price: Number(packing.price),
      sort: packing.sort,
    })),
  ];
  if (catalogServices.length > 1000) throw new Error("PRICE_CATALOG_TOO_LARGE");
  const offer: CatalogOfferDto | null = offerRow
    ? {
        id: offerRow.id,
        name: offerRow.name,
        workers: offerRow.workers,
        trucks: offerRow.trucks,
        includedHours: offerRow.includedHours,
        sum: Number(offerRow.sum),
        hourPrice: Number(offerRow.hourPrice),
        ridingCosts: Number(offerRow.ridingCosts),
        sort: offerRow.sort,
      }
    : null;
  const rates: CatalogServiceRateDto[] = rateRows.map((row) => ({
    key: row.key as ServiceRateKey,
    price: Number(row.price),
  }));
  return calculateOrderPricing({
    addresses: [
      input.from,
      input.to,
      ...(details.showSecondaryFrom && details.secondaryFrom
        ? [details.secondaryFrom]
        : []),
      ...(details.showSecondaryTo && details.secondaryTo
        ? [details.secondaryTo]
        : []),
    ],
    basis: details.basis,
    distanceKm: details.distanceKm,
    ...(details.distanceSource
      ? { distanceSource: details.distanceSource }
      : {}),
    services: pricedServices,
    catalogServices,
    offer,
    rates,
  });
}

export async function validatePricingSnapshot(
  input: CreateOrderInput,
  storedSnapshot: OrderPricingSnapshot | undefined,
  client: PricingClient,
): Promise<OrderPricingSnapshot | undefined> {
  const submittedSnapshot = input.pricingSnapshot;
  if (!submittedSnapshot) return storedSnapshot;
  if (storedSnapshot && sameSnapshot(submittedSnapshot, storedSnapshot))
    return storedSnapshot;
  const latest = await previewOrderPricing(input, client);
  if (!sameSnapshot(submittedSnapshot, latest.pricingSnapshot)) {
    if (
      canonical(submittedSnapshot.source) !==
      canonical(latest.pricingSnapshot.source)
    )
      throw new PricePreviewStaleError(
        changedPricingSourceFields(
          submittedSnapshot.source,
          latest.pricingSnapshot.source,
        ),
      );
    throw new Error("PRICE_CATALOG_CHANGED");
  }
  return latest.pricingSnapshot;
}

export function orderPricingErrorIssue(error: unknown): OrderInputIssue | null {
  if (error instanceof Error && error.message === "DISTANCE_REQUIRED") {
    return {
      field: "details.distanceKm",
      message:
        "Bitte geben Sie für die automatische Fahrtkostenberechnung zuerst die Entfernung ein.",
    };
  }
  if (error instanceof Error && error.message === "UNPRICED_ORDER_SERVICE") {
    return {
      field: "details.extras.services",
      message:
        "Bitte geben Sie für jede Freitextposition einen Einzelpreis ein oder erfassen Sie das Angebot manuell.",
    };
  }
  if (error instanceof Error && error.message === "OFFER_MISMATCH") {
    return {
      field: "details.basis.offerId",
      message:
        "Der ausgewählte Tarif passt nicht mehr zu Trägern, LKW und Stunden.",
    };
  }
  if (error instanceof Error && error.message === "PRICE_NOT_CONFIGURED") {
    return {
      field: "details",
      message:
        "Ein benötigter Tarif oder Leistungspreis ist nicht mehr verfügbar. Bitte prüfen Sie die Katalogauswahl oder erstellen Sie ein manuelles Angebot.",
    };
  }
  if (error instanceof Error && error.message === "PRICE_CATALOG_TOO_LARGE") {
    return {
      field: "details",
      message:
        "Der Katalog enthält zu viele Positionen für einen Preis-Snapshot. Bitte reduzieren Sie den Katalog zuerst.",
    };
  }
  if (error instanceof Error && error.message === "INVALID_TOTAL") {
    return {
      field: "details.conditions",
      message: "Die berechnete Angebotssumme darf nicht negativ sein.",
    };
  }
  if (error instanceof Error && error.message === "PRICE_LIMIT_EXCEEDED") {
    return {
      field: "details.conditions",
      message:
        "Ein berechneter Konditionsbetrag überschreitet die zulässige Grenze von 10.000.000 EUR.",
    };
  }
  return null;
}

function sameSnapshot(
  left: OrderPricingSnapshot,
  right: OrderPricingSnapshot,
): boolean {
  const { calculatedAt: _leftCalculatedAt, ...leftValue } = left;
  const { calculatedAt: _rightCalculatedAt, ...rightValue } = right;
  return canonical(leftValue) === canonical(rightValue);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function changedPricingSourceFields(left: unknown, right: unknown): string[] {
  const changes: string[] = [];
  function visit(a: unknown, b: unknown, path: string) {
    if (canonical(a) === canonical(b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let index = 0; index < Math.max(a.length, b.length); index++)
        visit(a[index], b[index], `${path}[${index}]`);
      return;
    }
    if (
      typeof a === "object" &&
      a !== null &&
      !Array.isArray(a) &&
      typeof b === "object" &&
      b !== null &&
      !Array.isArray(b)
    ) {
      const keys = new Set([
        ...Object.keys(a as Record<string, unknown>),
        ...Object.keys(b as Record<string, unknown>),
      ]);
      for (const key of keys)
        visit(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key,
        );
      return;
    }
    changes.push(path || "source");
  }
  visit(left, right, "");
  return changes;
}
