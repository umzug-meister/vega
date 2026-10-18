import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateVolume,
  createPayload,
  EMAIL_PATTERN,
  initialDraft,
  localDate,
  suggestVisit,
  validateStep,
  validationFieldLabel,
  type FormResources,
} from "../src/form-model.js";
import {
  validateCustomerFormInput,
  validateOrderCreateInput,
} from "../../server/src/orders/order-input.js";
import { imageDimensions } from "../src/ImageUploader.js";

const resources: FormResources = {
  config: {
    privacyUrl: "https://example.test/privacy",
    boxCalculatorUrl: null,
    successUrl: null,
    boxVolume: 0.1,
    wardrobeBoxVolume: 0.5,
    uploadsAvailable: false,
    placesAvailable: false,
  },
  categories: [{ id: 1, name: "Wohnzimmer", sort: 1 }],
  furniture: [
    {
      id: 2,
      name: "Sofa",
      categoryIds: [1],
      categoryRefs: [{ id: 1, name: "Wohnzimmer" }],
      volume: 3,
      step: 1,
      sortOrder: 0,
    },
  ],
  packings: [
    {
      id: 3,
      name: "Karton",
      price: 4,
      description: "",
      media: null,
      sort: 1,
      show: true,
    },
  ],
  services: [
    { id: 4, name: "Lampe aufhängen", price: 20, sort: 1, show: true },
  ],
  rates: [],
};
function completeDraft() {
  const draft = initialDraft();
  draft.customer = {
    salutation: "Frau",
    firstName: "Ada",
    lastName: "Beispiel",
    email: "ada@example.test",
    phone: "+49 89 123456",
  };
  draft.from = {
    ...draft.from,
    street: "Altstraße 1",
    postalCode: "80331",
    city: "München",
    runningDistance: "10 m.",
    movementObject: "Wohnung",
    floor: "EG",
    liftType: "kein Aufzug",
    roomsNumber: "4",
    area: "80 m²",
  };
  draft.to = {
    ...draft.to,
    street: "Neustraße 2",
    postalCode: "80333",
    city: "München",
    runningDistance: "20 m.",
    movementObject: "Haus",
    stockwerke: ["EG", "1.OG"],
  };
  return draft;
}
test("initial contact defaults and all five long-form steps match the legacy flow", () => {
  const draft = initialDraft();
  assert.equal(draft.dateFixed, true);
  assert.equal(draft.movingDate, localDate());
  assert.equal(draft.privacyAccepted, false);
  assert.match(validateStep(draft, 0)!, /Vorname/);
  const complete = completeDraft();
  for (const step of [0, 1, 2, 3, 4])
    assert.equal(validateStep(complete, step), null);
});
test("validates full contact, date ranges, addresses and conditional lift fields", () => {
  const draft = completeDraft();
  draft.customer.email = "invalid";
  assert.match(validateStep(draft, 0)!, /E-Mail/);
  draft.customer.email = "ada@example.test";
  draft.dateFixed = false;
  draft.dateFrom = "2099-11-20";
  draft.dateTo = "2099-11-19";
  assert.match(validateStep(draft, 0)!, /späteste/);
  draft.dateTo = "2099-11-21";
  assert.equal(validateStep(draft, 0), null);
  draft.from.street = "Straße ohne Hausnummer";
  assert.match(validateStep(draft, 1)!, /Hausnummer/);
  draft.from.street = "Straße 1";
  delete draft.from.liftType;
  assert.match(validateStep(draft, 1)!, /Fahrstuhl/);
  draft.from.movementObject = "Haus";
  assert.equal(validateStep(draft, 1), null);
});
test("maps validation messages to the corresponding visible form field", () => {
  const empty = initialDraft();
  const firstNameError = validateStep(empty, 0)!;
  assert.equal(validationFieldLabel(empty, 0, firstNameError), "Vorname");

  const complete = completeDraft();
  complete.customer.email = "invalid";
  assert.equal(
    validationFieldLabel(complete, 0, validateStep(complete, 0)!),
    "E-Mail",
  );

  complete.customer.email = "ada@example.test";
  complete.dateFixed = false;
  complete.dateFrom = "not-a-date";
  assert.equal(
    validationFieldLabel(complete, 0, validateStep(complete, 0)!),
    "frühester Umzugstermin",
  );

  complete.dateFrom = "2099-11-20";
  complete.dateTo = "2099-11-19";
  assert.equal(
    validationFieldLabel(complete, 0, validateStep(complete, 0)!),
    "spätester Umzugstermin",
  );
});
test("email input pattern rejects malformed addresses while accepting ordinary ones", () => {
  const pattern = new RegExp(EMAIL_PATTERN);
  for (const email of [
    "ada@example.test",
    "nka@gmx.net",
    "first.last+tag@example.co.uk",
  ]) {
    assert.equal(pattern.test(email), true, email);
  }
  for (const email of [
    "",
    "missing-at.example.test",
    "name@localhost",
    "name @example.test",
    "name@example.test.",
  ]) {
    assert.equal(pattern.test(email), false, email);
  }
});
test("visit recommendation is shown only when moving out of a house", () => {
  const draft = completeDraft();
  assert.equal(draft.from.movementObject, "Wohnung");
  assert.equal(suggestVisit(draft), false);
  draft.from.roomsNumber = "4";
  assert.equal(suggestVisit(draft), false);
  draft.from.roomsNumber = "3";
  assert.equal(suggestVisit(draft), false);
  draft.from.movementObject = "Haus";
  assert.equal(suggestVisit(draft), true);
  draft.from.roomsNumber = "1";
  assert.equal(suggestVisit(draft), true);
  draft.to.movementObject = "Wohnung";
  assert.equal(suggestVisit(draft), true);
});
test("payload carries every active field and never sends prices or public image URLs", () => {
  const draft = completeDraft();
  draft.dateFixed = false;
  draft.dateFrom = "2099-11-20";
  draft.dateTo = "2099-11-21";
  draft.visitWanted = true;
  draft.privacyAccepted = true;
  draft.costsAssumption = true;
  draft.from.demontage = true;
  draft.from.kitchenWidth = "4";
  draft.from.wardrobeWidth = "6";
  draft.from.bedNumber = "2";
  draft.furniture["2:1"] = 2;
  draft.boxes = 5;
  draft.wardrobeBoxes = 2;
  draft.packingRequested = true;
  draft.quantities["packaging:3"] = 5;
  draft.quantities["service:4"] = 1;
  draft.heavy = true;
  draft.heavyItems[0] = {
    ...draft.heavyItems[0]!,
    name: "Tresor",
    width: "80",
    depth: "60",
    height: "90",
    weight: "120",
    quantity: "1",
  };
  draft.images = [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      token: "a".repeat(43),
      preview: "blob:local",
    },
  ];
  const payload = createPayload(draft, resources);
  const validation = validateOrderCreateInput(payload);
  assert.equal(validation.ok, true, JSON.stringify(validation));
  assert.deepEqual(validateCustomerFormInput(payload), []);
  assert.equal(payload.movingDate, draft.dateFrom);
  assert.equal(payload.visitWanted, false);
  assert.equal(payload.privacyAccepted, true);
  assert.equal(payload.from.kitchenWidth, 4);
  assert.equal(payload.details?.furniture.volume, 7.5);
  assert.match(payload.details!.furniture.heavyText, /120 kg/);
  assert.equal(payload.details?.extras.services.length, 2);
  assert.deepEqual(payload.imageClaims, [
    { id: draft.images[0]!.id, token: draft.images[0]!.token },
  ]);
  assert.equal(JSON.stringify(payload).includes("blob:local"), false);
  assert.equal(payload.details?.basis.basePrice, 0);
});
test("switching off optional fields excludes stale hidden values without losing the draft", () => {
  const draft = completeDraft();
  draft.from.kitchenWidth = "4";
  draft.from.demontage = false;
  draft.from.stockwerke = ["EG"];
  draft.to.floor = "2. Etage";
  draft.to.liftType = "4 Personen";
  draft.quantities["packaging:3"] = 10;
  draft.packingRequested = false;
  draft.heavyItems[0]!.name = "Tresor";
  draft.heavy = false;
  const payload = createPayload(draft, resources);
  assert.equal("kitchenWidth" in payload.from, false);
  assert.equal("stockwerke" in payload.from, false);
  assert.equal("floor" in payload.to, false);
  assert.equal(payload.details!.furniture.heavyText, "");
  assert.equal(payload.details!.extras.services.length, 0);
  assert.equal(draft.from.kitchenWidth, "4");
});
test("calculator sums category-specific furniture and explicitly marks missing box configuration", () => {
  const draft = completeDraft();
  draft.furniture["2:1"] = 3;
  draft.boxes = 2;
  assert.equal(calculateVolume(draft, resources), 9.2);
  const unconfigured = {
    ...resources,
    config: { ...resources.config, boxVolume: null },
  };
  assert.equal(calculateVolume(draft, unconfigured), null);
  assert.equal(
    createPayload(draft, unconfigured).details?.furniture.volumeComplete,
    false,
  );
});
test("JPEG compression dimensions enforce 2000 px without upscaling", () => {
  assert.deepEqual(imageDimensions(6000, 4000), { width: 2000, height: 1333 });
  assert.deepEqual(imageDimensions(1000, 5000), { width: 400, height: 2000 });
  assert.deepEqual(imageDimensions(640, 480), { width: 640, height: 480 });
});
