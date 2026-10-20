import assert from "node:assert/strict";
import test from "node:test";
import {
  hasUnchangedCustomerDateRange,
  validateOrderCreateInput,
} from "../src/orders/order-input.js";
import { orderFixture } from "./fixtures/order.js";

const validOrder = {
  customer: {
    firstName: "Ada",
    lastName: "Beispiel",
    phone: "+49 89 123456",
    email: "ada@example.test",
    unexpected: "must not be retained",
  },
  from: { street: "Altstraße 1", postalCode: "80331", city: "München" },
  to: { street: "Neustraße 2", postalCode: "80333", city: "München" },
  movingDate: "2026-11-15",
  movingTime: "07:30",
  note: "Bitte vorher anrufen.",
  price: 0.01,
};

test("staff updates cannot set, replace or remove customer date ranges", () => {
  const range = { dateFrom: "2026-11-02", dateTo: "2026-11-04" };
  assert.equal(hasUnchangedCustomerDateRange(range, range), true);
  assert.equal(
    hasUnchangedCustomerDateRange({ ...range, dateFrom: "2026-11-03" }, range),
    false,
  );
  assert.equal(
    hasUnchangedCustomerDateRange({ ...range, dateTo: "2026-11-05" }, range),
    false,
  );
  assert.equal(hasUnchangedCustomerDateRange({}, range), false);
  assert.equal(hasUnchangedCustomerDateRange(range, {}), false);
  assert.equal(
    hasUnchangedCustomerDateRange({ dateFrom: "", dateTo: "" }, {}),
    true,
  );
  assert.equal(hasUnchangedCustomerDateRange({}, null), true);
  assert.equal(validateOrderCreateInput({ ...validOrder, ...range }).ok, true);
});

test("validates order submission and strips fields outside the approved input contract", () => {
  const result = validateOrderCreateInput(validOrder);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal("price" in result.value, false);
  assert.equal("unexpected" in result.value.customer, false);
  assert.deepEqual(result.value.from, validOrder.from);
});

test("rejects missing contact/address data, invalid email, and impossible dates", () => {
  const result = validateOrderCreateInput({
    ...validOrder,
    customer: { ...validOrder.customer, firstName: "", email: "nope" },
    from: { street: "", postalCode: "", city: "" },
    movingDate: "2026-02-31",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(
    result.issues.some((issue) => issue.field === "customer.firstName"),
  );
  assert.ok(result.issues.some((issue) => issue.field === "customer.email"));
  assert.ok(result.issues.some((issue) => issue.field === "from.street"));
  assert.ok(result.issues.some((issue) => issue.field === "movingDate"));
});

test("rejects malformed and oversized payload sections", () => {
  const result = validateOrderCreateInput({
    ...validOrder,
    note: "x".repeat(5001),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((issue) => issue.field === "note"));
  assert.equal(validateOrderCreateInput(null).ok, false);
});

test("catalog references must be positive integer IDs for furniture, services and packing", () => {
  for (const catalogId of [0, 0.5, -1, 2_147_483_648]) {
    const input = orderFixture();
    input.details!.furniture.items[0]!.catalogId = catalogId;
    input.details!.extras.services[0]!.catalogId = catalogId;
    input.details!.extras.services[1]!.catalogId = catalogId;
    const result = validateOrderCreateInput(input, { allowStaffPricing: true });
    assert.equal(result.ok, false);
    if (result.ok) continue;
    for (const field of [
      "details.furniture.items.0.catalogId",
      "details.extras.services.0.catalogId",
      "details.extras.services.1.catalogId",
    ]) {
      assert.ok(result.issues.some((issue) => issue.field === field));
    }
  }
});

test("validates and persists secondary addresses while keeping prices staff-only", () => {
  const details = {
    showSecondaryFrom: true,
    showSecondaryTo: true,
    secondaryFrom: {
      street: "Weitere Straße 3",
      postalCode: "80335",
      city: "München",
    },
    secondaryTo: {
      street: "Zweite Zielstraße 4",
      postalCode: "80336",
      city: "München",
    },
    distanceKm: 17,
    furniture: {
      volume: 30,
      boxes: 12,
      wardrobeBoxes: 2,
      ownItems: "",
      items: [{ name: "Sofa", quantity: 1, volume: 3 }],
      expensive: false,
      expensiveText: "",
      heavy: false,
      heavyText: "",
      bulky: false,
      bulkyText: "",
    },
    extras: { packingRequested: false, services: [] },
    basis: {
      workers: 3,
      trucks: 1,
      hours: 4,
      basePrice: 0,
      extraHourPrice: 0,
      discountPercent: 0,
    },
    conditions: [],
  };
  const publicResult = validateOrderCreateInput({ ...validOrder, details });
  assert.equal(publicResult.ok, true);
  if (publicResult.ok) {
    assert.equal(
      publicResult.value.details?.secondaryFrom?.street,
      "Weitere Straße 3",
    );
    assert.equal(
      publicResult.value.details?.secondaryTo?.street,
      "Zweite Zielstraße 4",
    );
  }

  const pricedDetails = {
    ...details,
    basis: { ...details.basis, basePrice: 800 },
  };
  assert.equal(
    validateOrderCreateInput({ ...validOrder, details: pricedDetails }).ok,
    false,
  );
  assert.equal(
    validateOrderCreateInput(
      { ...validOrder, details: pricedDetails },
      { allowStaffPricing: true },
    ).ok,
    true,
  );
});

test("order basis rejects a truck count above the configured riding-cost rates", () => {
  const input = orderFixture();
  input.details!.basis.trucks = 5;
  const rejected = validateOrderCreateInput(input, { allowStaffPricing: true });
  assert.equal(rejected.ok, false);
  if (!rejected.ok)
    assert.ok(
      rejected.issues.some((issue) => issue.field === "details.basis.trucks"),
    );

  input.details!.basis.trucks = 4;
  assert.equal(
    validateOrderCreateInput(input, { allowStaffPricing: true }).ok,
    true,
  );
});

test("allows a staff draft with empty legacy fields but still requires public submissions to be complete", () => {
  const draft = {
    customer: { firstName: "", lastName: "", phone: "" },
    from: { street: "", postalCode: "", city: "" },
    to: { street: "", postalCode: "", city: "" },
    movingDate: "",
  };
  const staffResult = validateOrderCreateInput(draft, {
    allowIncomplete: true,
    allowStaffPricing: true,
  });
  assert.equal(staffResult.ok, true);
  if (staffResult.ok) assert.equal(staffResult.value.customer.firstName, "");
  assert.equal(validateOrderCreateInput(draft).ok, false);
});

test("anonymous orders cannot forge staff distance provenance", () => {
  const input = orderFixture();
  input.details!.distanceKm = 0;
  input.details!.distanceSource = "route";
  const result = validateOrderCreateInput(input);
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.ok(
      result.issues.some((issue) => issue.field === "details.distanceSource"),
    );
  assert.equal(
    validateOrderCreateInput(input, { allowStaffPricing: true }).ok,
    true,
  );
});

test("route snapshots persist validated legs for staff and are rejected for public orders", () => {
  const input = orderFixture();
  const routeSnapshot = {
    calculatedAt: "2026-10-18T12:00:00.000Z",
    origin: "Depot 1, 80331 München",
    addresses: ["A-Straße 1, 80332 München", "B-Straße 2, 80333 München"],
    distanceKm: 9,
    durationMinutes: 15,
    legs: [
      { distanceKm: 5, durationMinutes: 8 },
      { distanceKm: 0, durationMinutes: 0 },
      { distanceKm: 4, durationMinutes: 7 },
    ],
  };
  input.details!.distanceKm = 9;
  input.details!.distanceSource = "route";
  input.details!.routeSnapshot = routeSnapshot;

  const staff = validateOrderCreateInput(input, {
    allowStaffPricing: true,
    allowIncomplete: true,
  });
  assert.equal(staff.ok, true);
  if (staff.ok)
    assert.deepEqual(staff.value.details?.routeSnapshot, routeSnapshot);

  const publicInput = validateOrderCreateInput(input);
  assert.equal(publicInput.ok, false);
  if (!publicInput.ok)
    assert.ok(
      publicInput.issues.some(
        (issue) => issue.field === "details.routeSnapshot",
      ),
    );

  const malformed = structuredClone(input);
  malformed.details!.routeSnapshot!.legs.pop();
  const invalid = validateOrderCreateInput(malformed, {
    allowStaffPricing: true,
    allowIncomplete: true,
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok)
    assert.ok(
      invalid.issues.some(
        (issue) => issue.field === "details.routeSnapshot.legs",
      ),
    );
});

test("preserves the complete normalized payload for public and staff orders", () => {
  const staffInput = orderFixture();
  const staffResult = validateOrderCreateInput(staffInput, {
    allowStaffPricing: true,
  });
  assert.deepEqual(staffResult, { ok: true, value: staffInput });

  const publicInput = orderFixture();
  if (!publicInput.details)
    throw new Error("Order fixture must include details");
  publicInput.details.basis = {
    ...publicInput.details.basis,
    basePrice: 0,
    extraHourPrice: 0,
    discountPercent: 0,
  };
  const publicResult = validateOrderCreateInput(publicInput);
  assert.deepEqual(publicResult, { ok: true, value: publicInput });
});

test("preserves the ordered validation issues for malformed order details", () => {
  const input = orderFixture();
  if (!input.details) throw new Error("Order fixture must include details");
  input.customer.firstName = " ";
  input.customer.email = "not-an-email";
  input.from.street = "";
  input.movingDate = "2026-02-31";
  input.movingTime = "25:61";
  input.details.distanceKm = -1;
  input.details.secondaryFrom = {
    street: "",
    postalCode: "80335",
    city: "Muenchen",
  };
  input.details.furniture.volume = -1;
  input.details.furniture.items = [{ name: "", quantity: -1 }];
  input.details.extras.services = [{ name: "", kind: "service", quantity: -1 }];
  input.details.basis.basePrice = 800;
  input.details.conditions = [{ description: "", amount: 100 }];

  const result = validateOrderCreateInput({
    ...input,
    details: { ...input.details, showSecondaryFrom: "yes" },
  });
  assert.deepEqual(result, {
    ok: false,
    issues: [
      { field: "customer.firstName", message: "Dieses Feld ist erforderlich." },
      {
        field: "customer.email",
        message: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
      },
      { field: "from.street", message: "Dieses Feld ist erforderlich." },
      { field: "details.showSecondaryFrom", message: "Ungültiger Wert." },
      {
        field: "details.distanceKm",
        message: "Bitte geben Sie eine Zahl zwischen 0 und 10000 ein.",
      },
      {
        field: "details.secondaryFrom.street",
        message: "Dieses Feld ist erforderlich.",
      },
      {
        field: "details.furniture.volume",
        message: "Bitte geben Sie eine Zahl zwischen 0 und 100000 ein.",
      },
      {
        field: "details.furniture.items.0.name",
        message: "Dieses Feld ist erforderlich.",
      },
      {
        field: "details.furniture.items.0.quantity",
        message: "Bitte geben Sie eine Zahl zwischen 0 und 100000 ein.",
      },
      {
        field: "details.extras.services.0.name",
        message: "Dieses Feld ist erforderlich.",
      },
      {
        field: "details.extras.services.0.quantity",
        message: "Bitte geben Sie eine Zahl zwischen 0 und 100000 ein.",
      },
      {
        field: "details.basis",
        message:
          "Preis- und Rabattangaben sind nur für angemeldete Mitarbeiter verfügbar.",
      },
      {
        field: "details.conditions.0.description",
        message: "Dieses Feld ist erforderlich.",
      },
      {
        field: "details.conditions.0.amount",
        message: "Preisangaben sind nur für angemeldete Mitarbeiter verfügbar.",
      },
      {
        field: "movingDate",
        message: "Bitte geben Sie ein gültiges Datum ein.",
      },
      {
        field: "movingTime",
        message: "Bitte geben Sie eine gültige Uhrzeit ein.",
      },
    ],
  });
});

test("calculates condition amount from quantity and unit price on the server", () => {
  const input = orderFixture();
  input.details!.conditions = [
    { description: "Möbelmontage", quantity: 2, unitPrice: 15.255, amount: 0 },
  ];
  const result = validateOrderCreateInput(input, { allowStaffPricing: true });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.details!.conditions, [
    {
      description: "Möbelmontage",
      quantity: 2,
      unitPrice: 15.255,
      amount: 30.51,
    },
  ]);

  input.details!.conditions[0]!.quantity = 100_000;
  input.details!.conditions[0]!.unitPrice = 1_000_000;
  const tooLarge = validateOrderCreateInput(input, { allowStaffPricing: true });
  assert.equal(tooLarge.ok, false);
  if (!tooLarge.ok)
    assert.ok(
      tooLarge.issues.some(
        (issue) => issue.field === "details.conditions.0.amount",
      ),
    );
});

test("preserves exact normalization and defaults for an incomplete staff draft", () => {
  const result = validateOrderCreateInput(
    {
      customer: { firstName: "", lastName: "", phone: "" },
      from: { street: "", postalCode: "", city: "" },
      to: { street: "", postalCode: "", city: "" },
      movingDate: "",
    },
    { allowIncomplete: true, allowStaffPricing: true },
  );

  assert.deepEqual(result, {
    ok: true,
    value: {
      customer: { firstName: "", lastName: "", phone: "" },
      from: { street: "", postalCode: "", city: "" },
      to: { street: "", postalCode: "", city: "" },
      movingDate: "",
    },
  });
});
