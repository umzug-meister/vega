import type {
  CatalogOfferDto,
  CatalogServiceRateDto,
  OrderConditionInput,
  OrderPricingPreview,
  OrderServiceInput,
  OrderAddressInput,
} from "./index.js";
import {
  addInvoiceAmounts,
  calculateRoundedPercent,
  calculateRoundedSubtotal,
  roundAmountToCents,
  roundProductToNearestIncrement,
} from "./invoice-calculation.js";

export {
  calculateRoundedPercent,
  calculateRoundedSubtotal,
  roundAmountToCents,
  roundAmountToNearestIncrement,
  roundProductToNearestIncrement,
} from "./invoice-calculation.js";

export interface PricedOrderService extends OrderServiceInput {
  price: number;
}

export interface CalculateOrderPricingInput {
  addresses: OrderAddressInput[];
  basis: {
    workers: number;
    trucks: number;
    hours: number;
    basePrice: number;
    extraHourPrice: number;
    discountPercent: number;
    offerId?: number;
  };
  distanceKm: number;
  distanceSource?: "manual" | "route";
  services: PricedOrderService[];
  catalogServices?: Array<{
    id: number;
    kind: "service" | "packaging";
    name: string;
    price: number;
    sort: number;
  }>;
  offer: CatalogOfferDto | null;
  rates: CatalogServiceRateDto[];
  calculatedAt?: string;
}

export class OrderPricingError extends Error {
  constructor(
    readonly code:
      | "PRICE_NOT_CONFIGURED"
      | "DISTANCE_REQUIRED"
      | "INVALID_TOTAL"
      | "OFFER_MISMATCH"
      | "PRICE_LIMIT_EXCEEDED",
  ) {
    super(code);
  }
}

export function calculateOrderPricing(
  input: CalculateOrderPricingInput,
): OrderPricingPreview {
  const { basis } = input;
  if (basis.offerId !== undefined && input.offer?.id !== basis.offerId)
    throw new OrderPricingError("PRICE_NOT_CONFIGURED");
  if (
    input.offer &&
    (input.offer.workers !== basis.workers ||
      input.offer.trucks !== basis.trucks ||
      input.offer.includedHours !== basis.hours)
  ) {
    throw new OrderPricingError("OFFER_MISMATCH");
  }
  const source = {
    offerId: input.offer?.id ?? null,
    workers: basis.workers,
    trucks: basis.trucks,
    hours: basis.hours,
    basePrice: basis.basePrice,
    extraHourPrice: basis.extraHourPrice,
    discountPercent: basis.discountPercent,
    distanceKm: input.distanceKm,
    ...(input.distanceSource ? { distanceSource: input.distanceSource } : {}),
    addresses: input.addresses.map(({ city, parkingSlot }) => ({
      city,
      parkingSlot: parkingSlot === true,
    })),
    services: input.services.map(
      ({ kind, catalogId, quantity, unitPrice }) => ({
        kind,
        catalogId: catalogId ?? null,
        quantity,
        unitPrice: unitPrice ?? null,
      }),
    ),
  };
  const snapshot: OrderPricingPreview["pricingSnapshot"] = {
    version: 1,
    calculatedAt: input.calculatedAt ?? new Date().toISOString(),
    source,
    offer: input.offer,
    rates: input.rates,
    services:
      input.catalogServices ??
      input.services.flatMap((service) =>
        service.catalogId === undefined
          ? []
          : [
              {
                id: service.catalogId,
                kind: service.kind,
                name: service.name,
                price: service.price,
                sort: 0,
              },
            ],
      ),
  };

  const description = [
    `${basis.workers} Träger${basis.trucks > 0 ? ` / ${basis.trucks} x LKW 3,5t` : ""}`,
  ];
  if (basis.hours > 0) {
    description.push(
      `Mindestabnahme: ${basis.hours} Stunden, jede weitere Stunde: ${new Intl.NumberFormat("de-DE").format(basis.extraHourPrice)} €/Std`,
    );
    if (basis.hours <= 4)
      description.push(`Maximale Abnahme: ${basis.hours + 1} Stunden`);
  }
  const conditions: OrderConditionInput[] = [
    {
      description: description.join("\n"),
      amount: roundAmountToCents(basis.basePrice),
      kind: "base",
    },
  ];
  const discount = calculateRoundedPercent(
    basis.basePrice,
    basis.discountPercent,
  );
  if (discount > 0)
    conditions.push({
      description: `Rabatt ${basis.discountPercent}%`,
      amount: -discount,
      kind: "discount",
    });

  const local =
    input.addresses.length > 0 &&
    input.addresses.every((address) =>
      ["munchen", "muenchen"].includes(
        address.city
          .trim()
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toLocaleLowerCase("de-DE"),
      ),
    );
  if (basis.trucks > 0) {
    if (!input.offer) throw new OrderPricingError("PRICE_NOT_CONFIGURED");
    const truckRate = input.rates.find(
      (rate) => rate.key === `ridingCostsTruck${basis.trucks}`,
    )?.price;
    if (truckRate === undefined)
      throw new OrderPricingError("PRICE_NOT_CONFIGURED");
    const ridingCosts = truckRate;
    let travel = ridingCosts;
    if (!local) {
      const kmRate = input.rates.find((rate) => rate.key === "kmPrice")?.price;
      if (kmRate === undefined)
        throw new OrderPricingError("PRICE_NOT_CONFIGURED");
      if (input.distanceSource === undefined && input.distanceKm === 0)
        throw new OrderPricingError("DISTANCE_REQUIRED");
      const distanceCosts = roundProductToNearestIncrement(
        [input.distanceKm, basis.trucks, kmRate],
        5,
      );
      travel = Math.max(ridingCosts, distanceCosts);
    }
    conditions.push({
      description: "An-/Abfahrtskosten",
      amount: roundAmountToCents(travel),
      kind: "travel",
    });
  }

  const parkingCount = input.addresses.filter(
    (address) => address.parkingSlot === true,
  ).length;
  if (parkingCount > 0) {
    const hvzRate = input.rates.find((rate) => rate.key === "hvzPrice")?.price;
    if (hvzRate === undefined)
      throw new OrderPricingError("PRICE_NOT_CONFIGURED");
    conditions.push({
      description: `Organisation von ${parkingCount} Halteverbotszone(n)`,
      amount: calculateRoundedSubtotal([
        { quantity: parkingCount, unitPrice: hvzRate },
      ]),
      kind: "parking",
    });
  }

  for (const kind of ["service", "packaging"] as const) {
    const selected = input.services.filter((service) => service.kind === kind);
    if (selected.length === 0) continue;
    conditions.push({
      description:
        kind === "service"
          ? "Leistungen"
          : "Verpackung (wird nach Verbrauch berechnet)",
      amount: calculateRoundedSubtotal(
        selected.map(({ quantity, price }) => ({ quantity, unitPrice: price })),
      ),
      kind: kind === "service" ? "services" : "packaging",
    });
  }

  if (
    conditions.some(
      (condition) =>
        !Number.isFinite(condition.amount) ||
        Math.abs(condition.amount) > 10_000_000,
    )
  ) {
    throw new OrderPricingError("PRICE_LIMIT_EXCEEDED");
  }
  if (addInvoiceAmounts(conditions.map((condition) => condition.amount)) < 0)
    throw new OrderPricingError("INVALID_TOTAL");
  return { conditions, pricingSnapshot: snapshot };
}
