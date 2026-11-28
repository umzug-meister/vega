import assert from "node:assert/strict";
import test from "node:test";
import { buildLegacyCatalogImportPlan } from "../src/catalog/legacy-import.js";

const PAYLOAD = {
  boxCbm: "0.13",
  kleiderboxCbm: "0.6",
  categories: [
    { id: 69, slug: "keller-garage", name: "Keller, Garage, Dach" },
    { id: 75, slug: "wohnung", name: "Wohnung" },
  ],
  items: [
    { id: 3786, name: "Schrank zerlegbar, je Laufmeter", volume: "1", sortOrder: "7", step: "0.5", categoryRefs: [{ id: 75, name: "Wohnung" }] },
    { id: 3272, name: "Fahrrad", volume: 0.6, colli: "0", extraPrice: "", montagePrice: "0", bulky: true, m100: true, categoryRefs: [{ id: 69, name: "Keller, Garage, Dach" }] },
    { id: 3283, name: "", volume: 1, sortOrder: 9, categoryRefs: [{ id: 75, name: "Wohnung" }] },
    { id: 3999, name: "Ohne Kategorie", volume: 1, categoryRefs: [] },
  ],
  services: [
    { tag: "Price", id: 24427, hourPrice: "495", ridingCosts: "180", t35: 4, workers: 9, includedHours: "5", sum: "2225", name: "" },
    { tag: "Bohrarbeiten", id: 23211, name: "Gardinenstangen anbringen, pro Stück", price: "30", sort: "160", show: "on" },
    { tag: "Bohrarbeiten", id: 7149, name: "Entsorgung Elektrogeräte, pro Stück", price: "30", sort: 20, show: false },
    { tag: "Packmaterial", id: 478, name: "Luftpolsterfolie, Lfm", price: "1.8", description: "Luftpolsterfolie nach Verbrauch.", show: "on", sort: "3", imgUrl: "https://example.test/folie.jpg" },
    { tag: "Packmaterial", id: 6398, name: "Kleiderbox kaufen", price: "25", desc: "Professionelle Kleiderbox.", show: true },
    { tag: "Counter", type: "Lead", id: 18688, name: "", data: { "#2024": [] } },
    { tag: "Counter", type: "Offer", id: 18689, name: "", data: { "#2024": [] } },
  ],
};

test("legacy import maps categories, furniture, services, packing, offers and box volumes onto the target structure", () => {
  const plan = buildLegacyCatalogImportPlan(PAYLOAD);

  assert.equal(plan.boxCbm, 0.13);
  assert.equal(plan.kleiderboxCbm, 0.6);

  assert.deepEqual(plan.categories.map((entry) => entry.input), [
    { name: "Keller, Garage, Dach", sort: 0 },
    { name: "Wohnung", sort: 10 },
  ]);
  assert.ok(plan.categories.every((entry) => !("slug" in entry.input)));

  assert.equal(plan.furniture.length, 2);
  const wardrobe = plan.furniture[0];
  assert.equal(wardrobe.input.name, "Schrank zerlegbar, je Laufmeter");
  assert.equal(wardrobe.input.volume, 1);
  assert.equal(wardrobe.input.step, 0.5);
  assert.equal(wardrobe.input.sortOrder, 7);
  assert.deepEqual(wardrobe.categoryNames, ["Wohnung"]);
  const bicycle = plan.furniture[1];
  assert.equal(bicycle.input.volume, 0.6);
  assert.deepEqual(bicycle.categoryNames, ["Keller, Garage, Dach"]);
  assert.ok(!("colli" in bicycle.input) && !("bulky" in bicycle.input) && !("m100" in bicycle.input));

  assert.equal(plan.offers.length, 1);
  assert.deepEqual(plan.offers[0].input, { name: "9 Träger · 4 LKW", workers: 9, trucks: 4, includedHours: 5, sum: 2225, hourPrice: 495, ridingCosts: 180, sort: 0 });

  assert.deepEqual(plan.services.map((entry) => entry.input), [
    { name: "Gardinenstangen anbringen, pro Stück", price: 30, sort: 160, show: true },
    { name: "Entsorgung Elektrogeräte, pro Stück", price: 30, sort: 20, show: false },
  ]);

  assert.equal(plan.packings.length, 2);
  assert.deepEqual(plan.packings[0].input, {
    name: "Luftpolsterfolie, Lfm", price: 1.8, description: "Luftpolsterfolie nach Verbrauch.", media: "https://example.test/folie.jpg", sort: 3, show: true,
  });
  // Legacy "desc" and boolean "on" flags map onto the target fields.
  assert.equal(plan.packings[1].input.description, "Professionelle Kleiderbox.");
  assert.equal(plan.packings[1].input.media, null);
  assert.equal(plan.packings[1].input.show, true);
});

test("legacy import skips invalid records and reports every decision", () => {
  const plan = buildLegacyCatalogImportPlan(PAYLOAD);

  assert.equal(plan.furniture.some((entry) => entry.legacyId === 3283), false);
  assert.equal(plan.furniture.some((entry) => entry.legacyId === 3999), false);
  assert.ok(plan.skipped.some((line) => line.includes("3283") && line.includes("ohne Namen")));
  assert.ok(plan.skipped.some((line) => line.includes("Ohne Kategorie")));
  assert.ok(!plan.skipped.some((line) => line.includes("Schrittgröße 0.5")));
  assert.ok(plan.skipped.some((line) => line.includes("2 Zähler-Datensätze")));
});

test("legacy import defaults steps other than half or one to one with a warning", () => {
  for (const step of ["0.25", "1.5", "2"]) {
    const plan = buildLegacyCatalogImportPlan({
      ...PAYLOAD,
      items: [
        { name: "Sondermaß", volume: 1, step, categoryRefs: [{ name: "Wohnung" }] },
      ],
    });
    assert.equal(plan.furniture[0]?.input.step, 1);
    assert.ok(plan.skipped.some((line) => line.includes(`ungültige Schrittgröße ${step}`)));
  }
});

test("legacy import rejects malformed payloads, comma decimals and invalid volumes", () => {
  const plan = buildLegacyCatalogImportPlan({
    boxCbm: "0,13",
    kleiderboxCbm: 15,
    categories: null,
    items: "not-a-list",
    services: [null, { tag: "Price", id: 1, workers: 2, t35: 1, includedHours: "5", sum: "abc", hourPrice: "1", ridingCosts: "1" }],
  });
  assert.equal(plan.boxCbm, null);
  assert.equal(plan.kleiderboxCbm, null);
  assert.equal(plan.categories.length, 0);
  assert.equal(plan.furniture.length, 0);
  assert.equal(plan.offers.length, 0);
  assert.ok(plan.skipped.some((line) => line.includes("Umzugskarton")));
  assert.ok(plan.skipped.some((line) => line.includes("Kleiderbox")));
  assert.ok(plan.skipped.some((line) => line.includes("Kategorien: Antwort ist keine Liste")));
  assert.ok(plan.skipped.some((line) => line.includes("Möbel: Antwort ist keine Liste")));
  assert.ok(plan.skipped.some((line) => line.includes("Angebot 2 Träger · 1 LKW")));
});
