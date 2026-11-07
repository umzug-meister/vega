import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCategoryInput,
  validateFurnitureInput,
  validateOfferInput,
  validatePackingInput,
  validateServiceInput,
  validateServiceRateInput,
} from "../src/catalog/catalog-input.js";

test("catalog category names and sorting are validated and only approved fields are returned", () => {
  const result = validateCategoryInput({ name: "Wohnzimmer", sort: 3, legacyField: "ignored" });
  assert.deepEqual(result, { ok: true, value: { name: "Wohnzimmer", sort: 3 } });
  assert.equal(validateCategoryInput({ name: " ", sort: -1 }).ok, false);
});

test("furniture uses only required catalog fields with step and sorting defaults", () => {
  assert.deepEqual(validateFurnitureInput({ name: "Sofa", categoryIds: [2, 2, 3], volume: 1.5, weight: "unused", montagePrice: 99, montage: true }), {
    ok: true, value: { name: "Sofa", categoryIds: [2, 3], volume: 1.5, step: 1, sortOrder: 0 },
  });
  assert.deepEqual(validateFurnitureInput({ name: "Stuhl", categoryIds: [], volume: 0.5, step: 2, sortOrder: 7 }), {
    ok: true, value: { name: "Stuhl", categoryIds: [], volume: 0.5, step: 2, sortOrder: 7 },
  });
  assert.deepEqual(validateFurnitureInput({ name: "Regalboden", categoryIds: [], volume: 0.5, step: 0.5 }), {
    ok: true, value: { name: "Regalboden", categoryIds: [], volume: 0.5, step: 0.5, sortOrder: 0 },
  });
  for (const step of [null, 0, -1, 0.25, 1.25, "1"]) assert.equal(validateFurnitureInput({ name: "Stuhl", categoryIds: [], volume: 1, step }).ok, false);
});

test("furniture rejects malformed category references, negative measures, and invalid steps", () => {
  const result = validateFurnitureInput({
    name: "Sofa",
    categoryIds: [2, "3"],
    volume: -1,
    step: null,
    sortOrder: 0,
  });
  assert.equal(result.ok, false);
});

test("service and packing data validate customer-visible prices and safe media URLs", () => {
  assert.equal(validateServiceInput({ name: "Bohrarbeiten", price: 12.5, sort: 1, show: true }).ok, true);
  assert.equal(validateServiceInput({ name: "Bohrarbeiten", price: -1, sort: 1, show: true }).ok, false);
  assert.equal(validatePackingInput({ name: "Karton", price: 2.5, description: "Doppelwellig", media: "https://assets.example.test/box.png", sort: 1, show: true }).ok, true);
  assert.equal(validatePackingInput({ name: "Karton", price: 2.5, description: "", media: "javascript:alert(1)", sort: 1, show: true }).ok, false);
});

test("packing descriptions keep safe rich formatting and strip executable markup", () => {
  const result = validatePackingInput({
    name: "Karton",
    price: 2.5,
    description:
      '<p onclick="alert(1)">Doppelwellig <strong>stabil</strong><script>alert(2)</script><span style="color: rgb(198, 40, 40); font-size: 80px">rot</span><a href="javascript:alert(3)">Link</a></p>',
    media: null,
    sort: 1,
    show: true,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.description, /<strong>stabil<\/strong>/u);
  assert.match(result.value.description, /<span style="color:#c62828">rot<\/span>/u);
  assert.doesNotMatch(
    result.value.description,
    /onclick|<script|javascript:|font-size/u,
  );
});

test("offers validate bounded workforce and prices; service rates only accept allowlisted keys", () => {
  assert.equal(validateOfferInput({ name: "3 Träger · 1 LKW", workers: 3, trucks: 1, includedHours: 4, sum: 850, hourPrice: 120, ridingCosts: 20, sort: 0 }).ok, true);
  assert.equal(validateOfferInput({ name: "Bad offer", workers: 0, trucks: 1, includedHours: 4, sum: 850, hourPrice: 120, ridingCosts: 20, sort: 0 }).ok, false);
  assert.equal(validateOfferInput({ name: "7 Träger · 4 LKW", workers: 7, trucks: 4, includedHours: 4, sum: 850, hourPrice: 120, ridingCosts: 20, sort: 0 }).ok, true);
  assert.equal(validateOfferInput({ name: "5 LKW ohne Tarif", workers: 3, trucks: 5, includedHours: 4, sum: 850, hourPrice: 120, ridingCosts: 20, sort: 0 }).ok, false);
  assert.equal(validateServiceRateInput("kmPrice", { price: 2.5 }).ok, true);
  assert.equal(validateServiceRateInput("ridingCostsTruck4", { price: 85 }).ok, true);
  assert.equal(validateServiceRateInput("databaseUrl", { price: 2.5 }).ok, false);
  assert.equal(validateServiceRateInput("hvzPrice", { price: -2 }).ok, false);
});
