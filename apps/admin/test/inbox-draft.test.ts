import assert from "node:assert/strict";
import test from "node:test";
import { draftToFormValue } from "../src/inbox/draft-to-form.js";

test("draftToFormValue keeps defaults and applies draft fields", () => {
  const value = draftToFormValue({
    customer: {
      firstName: "Max",
      lastName: "Mustermann",
      email: "max@example.com",
      phone: "0171 1",
    },
    from: { city: "Berlin" },
    to: {},
    movingDate: "2026-05-01",
    note: "Halteverbot nötig",
    furniture: {
      items: [{ name: "Couch", quantity: 2, volume: 1.5, catalogId: 1 }],
      volume: 3,
      volumeComplete: false,
    },
  });

  assert.equal(value.customer.email, "max@example.com");
  assert.equal(value.from.city, "Berlin");
  assert.equal(value.from.runningDistance, "10 m.");
  assert.equal(value.movingDate, "2026-05-01");
  assert.equal(value.movingTime, "07:00");
  assert.equal(value.details.furniture.volumeComplete, false);
  assert.equal(value.details.furniture.items.length, 1);
});

test("draftToFormValue transfers additional fields without losing form defaults", () => {
  const value = draftToFormValue({
    customer: { firstName: "", lastName: "", email: "", phone: "" },
    from: { movementObject: "Haus", stockwerke: ["1.OG"] },
    to: {},
    secondaryFrom: { city: "Berlin" },
    secondaryTo: { city: "Potsdam" },
    movingDate: "2026-11-16",
    dateFixed: true,
    visitWanted: true,
    costsAssumption: true,
    note: "",
    furniture: {
      items: [],
      volume: 0,
      volumeComplete: true,
      boxes: 25,
      wardrobeBoxes: 2,
      heavy: true,
      heavyText: "Tresor",
    },
    extras: {
      packingRequested: true,
      services: [
        { kind: "service", catalogId: 7, name: "Einpacken", quantity: 2 },
      ],
    },
  });
  assert.deepEqual(value.from.stockwerke, ["1.OG"]);
  assert.equal(value.details.showSecondaryFrom, true);
  assert.equal(value.details.secondaryFrom?.city, "Berlin");
  assert.equal(value.details.secondaryFrom?.street, "");
  assert.equal(value.details.showSecondaryTo, true);
  assert.equal(value.dateFixed, true);
  assert.equal(value.visitWanted, true);
  assert.equal(value.costsAssumption, true);
  assert.equal(value.details.furniture.boxes, 25);
  assert.equal(value.details.furniture.heavyText, "Tresor");
  assert.equal(value.details.extras.services[0]?.catalogId, 7);
});
