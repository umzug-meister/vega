import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateOrderPricing,
  calculateRoundedPercent,
  roundAmountToCents,
  roundAmountToNearestIncrement,
  OrderPricingError,
} from "@vega/domain";
import { validateOrderCreateInput } from "../src/orders/order-input.js";
import {
  PricePreviewStaleError,
  previewOrderPricing,
  validatePricingSnapshot,
} from "../src/orders/order-pricing-service.js";
import { orderFixture } from "./fixtures/order.js";

const offer = {
  id: 7,
  name: "3 Träger / 2 LKW",
  workers: 3,
  trucks: 2,
  includedHours: 4,
  sum: 1_000,
  hourPrice: 80,
  ridingCosts: 100,
  sort: 0,
};
const rates = [
  { key: "kmPrice" as const, price: 1.25 },
  { key: "hvzPrice" as const, price: 120 },
  { key: "ridingCostsTruck2" as const, price: 100 },
];

function pricingInput(
  overrides: Partial<Parameters<typeof calculateOrderPricing>[0]> = {},
) {
  return {
    addresses: [
      { street: "A", postalCode: "80331", city: "Berlin", parkingSlot: true },
      { street: "B", postalCode: "80333", city: "Berlin", parkingSlot: true },
    ],
    basis: {
      workers: 3,
      trucks: 2,
      hours: 4,
      basePrice: 1_000,
      extraHourPrice: 80,
      discountPercent: 10,
      offerId: 7,
    },
    distanceKm: 101.4,
    services: [
      {
        kind: "service" as const,
        catalogId: 9,
        name: "Bohrarbeiten",
        quantity: 2,
        price: 35.5,
      },
      {
        kind: "packaging" as const,
        catalogId: 10,
        name: "Umzugskarton",
        quantity: 10,
        price: 2.5,
      },
    ],
    offer,
    rates,
    calculatedAt: "2026-10-16T10:00:00.000Z",
    ...overrides,
  };
}

test("calculates gross conditions from the selected tariff and current catalog", () => {
  const result = calculateOrderPricing(pricingInput());
  assert.deepEqual(result.conditions, [
    {
      description:
        "3 Träger / 2 x LKW 3,5t\nMindestabnahme: 4 Stunden, jede weitere Stunde: 80 €/Std\nMaximale Abnahme: 5 Stunden",
      amount: 1_000,
      kind: "base",
    },
    { description: "Rabatt 10%", amount: -100, kind: "discount" },
    { description: "An-/Abfahrtskosten", amount: 255, kind: "travel" },
    {
      description: "Organisation von 2 Halteverbotszone(n)",
      amount: 240,
      kind: "parking",
    },
    { description: "Leistungen", amount: 71, kind: "services" },
    {
      description: "Verpackung (wird nach Verbrauch berechnet)",
      amount: 25,
      kind: "packaging",
    },
  ]);
  assert.equal(
    result.conditions.reduce((sum, condition) => sum + condition.amount, 0),
    1_491,
  );
  assert.equal(result.pricingSnapshot.offer?.id, 7);
  assert.equal(result.pricingSnapshot.services.length, 2);
});

test("crew conditions match legacy hours, limits and fixed-price wording", () => {
  for (const [workers, hours, extraHourPrice, suffix] of [
    [5, 6, 265, "Mindestabnahme: 6 Stunden, jede weitere Stunde: 265 €/Std"],
    [2, 2, 80, "Maximale Abnahme: 3 Stunden"],
    [2, 3, 80, "Maximale Abnahme: 4 Stunden"],
    [2, 4, 80, "Maximale Abnahme: 5 Stunden"],
    [3, 4, 80, "Maximale Abnahme: 5 Stunden"],
    [4, 4, 0, "Maximale Abnahme: 5 Stunden"],
    [
      3,
      6,
      265.5,
      "Mindestabnahme: 6 Stunden, jede weitere Stunde: 265,5 €/Std",
    ],
  ] as const) {
    const input = pricingInput();
    input.basis = { ...input.basis, workers, hours, extraHourPrice };
    input.offer = {
      ...input.offer,
      workers,
      includedHours: hours,
      name: "Katalogname ohne Stunden",
    };
    const condition = calculateOrderPricing(input).conditions[0]!;
    assert.ok(
      condition.description.startsWith(`${workers} Träger / 2 x LKW 3,5t\n`),
    );
    assert.ok(condition.description.endsWith(suffix));
    assert.doesNotMatch(
      condition.description,
      /Umzugsgutvolumen|Umzugsvolumen/u,
    );
    assert.equal(condition.amount, 1_000);
    if (hours > 4) assert.doesNotMatch(condition.description, /Maximale/u);
    if (extraHourPrice === 0)
      assert.match(condition.description, /jede weitere Stunde: 0 €\/Std/u);
  }
  const input = pricingInput();
  input.basis = { ...input.basis, trucks: 0, hours: 0 };
  input.offer = { ...input.offer, trucks: 0, includedHours: 0 };
  assert.equal(
    calculateOrderPricing(input).conditions[0]!.description,
    "3 Träger",
  );
  input.basis = { ...input.basis, trucks: 2 };
  input.offer = { ...input.offer, trucks: 2 };
  assert.equal(
    calculateOrderPricing(input).conditions[0]!.description,
    "3 Träger / 2 x LKW 3,5t",
  );
});

test("pricing preview respects staff unit prices and catalog defaults", async () => {
  const input = orderFixture();
  const details = input.details!;
  details.showSecondaryFrom = false;
  details.showSecondaryTo = false;
  details.basis.trucks = 0;
  details.extras.services = [
    {
      kind: "service",
      catalogId: 9,
      name: "Bohrarbeiten",
      quantity: 2,
      unitPrice: 12,
    },
    { kind: "packaging", catalogId: 10, name: "Umzugskarton", quantity: 3 },
    { kind: "service", name: "Sonderleistung", quantity: 2, unitPrice: 4 },
  ];
  input.from.parkingSlot = false;
  input.to.parkingSlot = false;

  const client = {
    catalogOffer: { findUnique: async () => null },
    catalogService: {
      findMany: async () => [
        { id: 9, name: "Bohrarbeiten", price: "35.5", sort: 0 },
      ],
    },
    catalogPacking: {
      findMany: async () => [
        { id: 10, name: "Umzugskarton", price: "2.5", sort: 0 },
      ],
    },
    catalogServiceRate: { findMany: async () => [] },
  } as unknown as Parameters<typeof previewOrderPricing>[1];

  const preview = await previewOrderPricing(input, client);
  assert.equal(
    preview.conditions.find((condition) => condition.kind === "services")
      ?.amount,
    32,
  );
  assert.equal(
    preview.conditions.find((condition) => condition.kind === "packaging")
      ?.amount,
    7.5,
  );
  assert.deepEqual(preview.pricingSnapshot.source.services, [
    { kind: "service", catalogId: 9, quantity: 2, unitPrice: 12 },
    { kind: "packaging", catalogId: 10, quantity: 3, unitPrice: null },
    { kind: "service", catalogId: null, quantity: 2, unitPrice: 4 },
  ]);
});

test("pricing snapshot includes catalog entries hidden from the customer form", async () => {
  const input = orderFixture();
  input.details!.basis.trucks = 0;
  input.details!.extras.services = [];
  input.from.parkingSlot = false;
  input.to.parkingSlot = false;
  input.details!.showSecondaryFrom = false;
  input.details!.showSecondaryTo = false;
  let serviceQuery: unknown;
  let packingQuery: unknown;
  const client = {
    catalogOffer: { findUnique: async () => null },
    catalogService: {
      findMany: async (query: unknown) => {
        serviceQuery = query;
        return [{ id: 21, name: "Intern", price: "12", sort: 0 }];
      },
    },
    catalogPacking: {
      findMany: async (query: unknown) => {
        packingQuery = query;
        return [{ id: 22, name: "Spezialkarton", price: "3", sort: 0 }];
      },
    },
    catalogServiceRate: { findMany: async () => [] },
  } as unknown as Parameters<typeof previewOrderPricing>[1];

  const preview = await previewOrderPricing(input, client);
  assert.deepEqual(
    preview.pricingSnapshot.services.map(({ name }) => name),
    ["Intern", "Spezialkarton"],
  );
  assert.equal("where" in (serviceQuery as object), false);
  assert.equal("where" in (packingQuery as object), false);
});

test("stale pricing preview reports changed field paths without field values", async () => {
  const input = orderFixture();
  input.details!.basis.trucks = 0;
  input.details!.extras.services = [];
  input.from.parkingSlot = false;
  input.to.parkingSlot = false;
  input.details!.showSecondaryFrom = false;
  input.details!.showSecondaryTo = false;
  const client = {
    catalogOffer: { findUnique: async () => null },
    catalogService: { findMany: async () => [] },
    catalogPacking: { findMany: async () => [] },
    catalogServiceRate: { findMany: async () => [] },
  } as unknown as Parameters<typeof previewOrderPricing>[1];
  const preview = await previewOrderPricing(input, client);
  input.pricingSnapshot = preview.pricingSnapshot;
  input.details!.basis.hours += 1;
  await assert.rejects(
    validatePricingSnapshot(input, undefined, client),
    (error: unknown) => {
      assert.ok(error instanceof PricePreviewStaleError);
      assert.deepEqual(error.changedFields, ["hours"]);
      assert.equal(error.message, "PRICE_PREVIEW_STALE");
      return true;
    },
  );
});

test("pricing preview prices a saved unit price even when the catalog row is gone", async () => {
  const input = orderFixture();
  const details = input.details!;
  details.showSecondaryFrom = false;
  details.showSecondaryTo = false;
  details.basis.trucks = 0;
  details.extras.services = [
    {
      kind: "service",
      catalogId: 9,
      name: "Bohrarbeiten",
      quantity: 2,
      unitPrice: 12,
    },
  ];
  input.from.parkingSlot = false;
  input.to.parkingSlot = false;

  const client = {
    catalogOffer: { findUnique: async () => null },
    catalogService: { findMany: async () => [] },
    catalogPacking: { findMany: async () => [] },
    catalogServiceRate: { findMany: async () => [] },
  } as unknown as Parameters<typeof previewOrderPricing>[1];

  const preview = await previewOrderPricing(input, client);
  assert.equal(
    preview.conditions.find((condition) => condition.kind === "services")
      ?.amount,
    24,
  );

  const withoutPrice = orderFixture();
  withoutPrice.details!.showSecondaryFrom = false;
  withoutPrice.details!.showSecondaryTo = false;
  withoutPrice.details!.basis.trucks = 0;
  withoutPrice.details!.extras.services = [
    { kind: "service", catalogId: 9, name: "Bohrarbeiten", quantity: 2 },
  ];
  withoutPrice.from.parkingSlot = false;
  withoutPrice.to.parkingSlot = false;
  await assert.rejects(
    previewOrderPricing(withoutPrice, client),
    (error: unknown) =>
      error instanceof Error && error.message === "PRICE_NOT_CONFIGURED",
  );
});

test("uses exact cent rounding for discounts and nearest-five rounding for kilometers", () => {
  assert.equal(calculateRoundedPercent(123.45, 10), 12.35);
  assert.equal(roundAmountToCents(1.005), 1.01);
  assert.equal(roundAmountToNearestIncrement(252.49, 5), 250);
  assert.equal(roundAmountToNearestIncrement(252.5, 5), 255);
});

test("rejects derived condition amounts outside the order input limit", () => {
  assert.throws(
    () =>
      calculateOrderPricing(
        pricingInput({
          services: [
            {
              kind: "service",
              catalogId: 9,
              name: "Leistung",
              quantity: 2,
              price: 10_000_000,
            },
          ],
        }),
      ),
    (error: unknown) =>
      error instanceof OrderPricingError &&
      error.message === "PRICE_LIMIT_EXCEEDED",
  );
});

test("uses the central truck-count travel rate as the minimum and local rides do not require distance", () => {
  const longDistance = calculateOrderPricing(pricingInput({ distanceKm: 0.1 }));
  assert.equal(
    longDistance.conditions.find((condition) => condition.kind === "travel")
      ?.amount,
    100,
  );

  const local = calculateOrderPricing(
    pricingInput({
      distanceKm: 0,
      addresses: [{ street: "A", postalCode: "80331", city: "Muenchen" }],
    }),
  );
  assert.equal(
    local.conditions.find((condition) => condition.kind === "travel")?.amount,
    100,
  );
});

test("truck counts above the configured automatic travel rates are accepted for manual travel pricing", () => {
  const base = pricingInput();
  const result = calculateOrderPricing({
    ...base,
    addresses: [{ street: "A", postalCode: "80331", city: "München" }],
    basis: { ...base.basis, workers: 20, trucks: 8, hours: 0 },
    offer: null,
  });
  assert.equal(result.conditions[0]?.description, "20 Träger / 8 x LKW 3,5t");
  assert.equal(result.conditions[0]?.amount, 1_000);
  assert.equal(
    result.conditions.some((condition) => condition.kind === "travel"),
    false,
  );
});

test("central travel rate is independent of worker count and legacy offer rates", () => {
  const travelCosts = [3, 6].map((workers) => {
    const base = pricingInput();
    return calculateOrderPricing({
      ...base,
      addresses: [{ street: "A", postalCode: "80331", city: "München" }],
      distanceKm: 0,
      basis: { ...base.basis, workers },
      offer: { ...offer, workers, ridingCosts: workers === 3 ? 25 : 900 },
    }).conditions.find((condition) => condition.kind === "travel")?.amount;
  });

  assert.deepEqual(travelCosts, [100, 100]);
});

test("requires the central travel rate for the selected truck count", () => {
  assert.throws(
    () =>
      calculateOrderPricing(
        pricingInput({
          addresses: [{ street: "A", postalCode: "80331", city: "München" }],
          distanceKm: 0,
          rates: [
            { key: "kmPrice", price: 1.25 },
            { key: "hvzPrice", price: 120 },
          ],
        }),
      ),
    (error: unknown) =>
      error instanceof OrderPricingError &&
      error.message === "PRICE_NOT_CONFIGURED",
  );
});

test("requires distance for non-local priced routes and allows fixed price without an offer", () => {
  assert.throws(
    () =>
      calculateOrderPricing(
        pricingInput({
          addresses: [{ street: "A", postalCode: "10115", city: "Berlin" }],
          distanceKm: 0,
        }),
      ),
    (error: unknown) =>
      error instanceof OrderPricingError &&
      error.message === "DISTANCE_REQUIRED",
  );
  assert.throws(
    () =>
      calculateOrderPricing(
        pricingInput({ basis: { ...pricingInput().basis, workers: 2 } }),
      ),
    (error: unknown) =>
      error instanceof Error && error.message === "OFFER_MISMATCH",
  );
  const fixedBasis = { ...pricingInput().basis, hours: 0, basePrice: 300 };
  const fixedPrice = calculateOrderPricing(
    pricingInput({
      addresses: [{ street: "A", postalCode: "80331", city: "München" }],
      basis: fixedBasis,
      offer: null,
    }),
  );
  assert.equal(fixedPrice.pricingSnapshot.offer, null);
  assert.equal(fixedPrice.conditions[0]?.amount, 300);
  assert.equal(
    fixedPrice.conditions.find((condition) => condition.kind === "travel")
      ?.amount,
    100,
  );
  assert.doesNotMatch(
    fixedPrice.conditions[0]!.description,
    /Stunden|Mindestabnahme/u,
  );
});

test("fixed-price preview skips a stale selected offer when hours are blank", async () => {
  const input = orderFixture();
  input.details!.basis = {
    workers: 2,
    trucks: 1,
    hours: 0,
    basePrice: 300,
    extraHourPrice: 0,
    discountPercent: 0,
    offerId: 999,
  };
  input.details!.showSecondaryFrom = false;
  input.details!.showSecondaryTo = false;
  input.details!.extras.services = [];
  input.from.parkingSlot = false;
  input.to.parkingSlot = false;
  const client = {
    catalogOffer: {
      findUnique: async () => {
        assert.fail("Fixed-price preview must not require or query a tariff");
      },
    },
    catalogService: { findMany: async () => [] },
    catalogPacking: { findMany: async () => [] },
    catalogServiceRate: {
      findMany: async () => [{ key: "ridingCostsTruck1", price: 90 }],
    },
  } as unknown as Parameters<typeof previewOrderPricing>[1];

  const preview = await previewOrderPricing(input, client);
  assert.equal(preview.pricingSnapshot.offer, null);
  assert.equal(preview.conditions[0]?.amount, 300);
  assert.equal(
    preview.conditions.find((condition) => condition.kind === "travel")?.amount,
    90,
  );
  assert.doesNotMatch(
    preview.conditions[0]!.description,
    /Stunden|Mindestabnahme|weitere Stunde/u,
  );
});

test("accepts typed discount conditions for staff but not in anonymous requests", () => {
  const staff = orderFixture();
  staff.details!.conditions = [
    { description: "Basis", amount: 100, kind: "base" },
    { description: "Rabatt 10%", amount: -10, kind: "discount" },
  ];
  assert.equal(
    validateOrderCreateInput(staff, { allowStaffPricing: true }).ok,
    true,
  );
  assert.equal(validateOrderCreateInput(staff).ok, false);

  staff.details!.conditions = [
    { description: "Manuelle Gutschrift", amount: -10 },
  ];
  assert.equal(
    validateOrderCreateInput(staff, { allowStaffPricing: true }).ok,
    false,
  );
});

test("per-order service unit prices are staff-only and bounded", () => {
  const input = orderFixture();
  input.details!.extras.services[0] = {
    ...input.details!.extras.services[0]!,
    unitPrice: 12.5,
  };
  assert.equal(
    validateOrderCreateInput(input, { allowStaffPricing: true }).ok,
    true,
  );

  const anonymous = validateOrderCreateInput(input);
  assert.equal(anonymous.ok, false);
  if (!anonymous.ok) {
    assert.ok(
      anonymous.issues.some(
        (issue) => issue.field === "details.extras.services.0.unitPrice",
      ),
    );
  }

  input.details!.extras.services[0]!.unitPrice = 1_000_000.01;
  const invalid = validateOrderCreateInput(input, { allowStaffPricing: true });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.ok(
      invalid.issues.some(
        (issue) => issue.field === "details.extras.services.0.unitPrice",
      ),
    );
  }
});

test("pricing snapshots are staff-only and survive validated order reads", () => {
  const input = orderFixture();
  const { offerId: _offerId, ...manualBasis } = pricingInput().basis;
  manualBasis.trucks = 0;
  const { from, to } = input;
  const calculated = calculateOrderPricing(
    pricingInput({
      addresses: [
        { ...from, city: "München" },
        { ...to, city: "München" },
      ],
      basis: manualBasis,
      services: [],
      offer: null,
      rates: [
        { key: "kmPrice", price: 0 },
        { key: "hvzPrice", price: 0 },
        { key: "ridingCostsTruck2", price: 0 },
      ],
    }),
  );
  input.pricingSnapshot = calculated.pricingSnapshot;
  const staff = validateOrderCreateInput(input, { allowStaffPricing: true });
  assert.equal(staff.ok, true);
  if (staff.ok)
    assert.deepEqual(staff.value.pricingSnapshot, calculated.pricingSnapshot);
  assert.equal(validateOrderCreateInput(input).ok, false);
});
