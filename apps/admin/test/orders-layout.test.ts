import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { AddressesTab } from "../src/orders/AddressesTab.js";
import { BasisTab } from "../src/orders/BasisTab.js";
import { ConditionsTab } from "../src/orders/ConditionsTab.js";
import {
  calculateFurnitureVolume,
  FurnitureTab,
} from "../src/orders/FurnitureTab.js";
import { createEmptyOrder } from "../src/orders/order-form-types.js";

function render(element: React.ReactElement) {
  const previous = Reflect.get(globalThis, "React");
  Reflect.set(globalThis, "React", React);
  try {
    return renderToStaticMarkup(element);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "React");
    else Reflect.set(globalThis, "React", previous);
  }
}

test("order cards use aligned responsive columns without squeezing list controls", () => {
  const value = createEmptyOrder();
  value.details.furniture.items = [{ name: "Sofa", quantity: 1, volume: 1.7 }];
  const addresses = render(
    createElement(AddressesTab, {
      value,
      update: () => {},
      onDetailsChange: () => {},
    }),
  );
  assert.equal([...addresses.matchAll(/MuiGrid-grid-md-6/gu)].length, 2);
  assert.equal([...addresses.matchAll(/MuiGrid-grid-xl-6/gu)].length, 2);
  const fourAddresses = render(
    createElement(AddressesTab, {
      value: {
        ...value,
        details: {
          ...value.details,
          showSecondaryFrom: true,
          secondaryFrom: createEmptyOrder().from,
          showSecondaryTo: true,
          secondaryTo: createEmptyOrder().to,
        },
      },
      update: () => {},
      onDetailsChange: () => {},
    }),
  );
  assert.equal([...fourAddresses.matchAll(/MuiGrid-grid-md-6/gu)].length, 4);
  assert.equal([...fourAddresses.matchAll(/MuiGrid-grid-xl-3/gu)].length, 4);
  assert.equal([...addresses.matchAll(/MuiGrid-grid-xl-6/gu)].length, 2);
  const allAddressCards = render(
    createElement(AddressesTab, {
      value: {
        ...value,
        details: {
          ...value.details,
          showSecondaryFrom: true,
          secondaryFrom: createEmptyOrder().from,
          showSecondaryTo: true,
          secondaryTo: createEmptyOrder().to,
        },
      },
      update: () => {},
      onDetailsChange: () => {},
    }),
  );
  assert.equal([...allAddressCards.matchAll(/MuiGrid-grid-md-6/gu)].length, 4);
  assert.equal([...allAddressCards.matchAll(/MuiGrid-grid-xl-3/gu)].length, 4);
  for (const label of [
    "Beladestelle",
    "2. Beladestelle",
    "Entladestelle",
    "2. Entladestelle",
  ]) {
    assert.ok(allAddressCards.includes(label), label);
  }
  const furniture = render(
    createElement(FurnitureTab, {
      value,
      update: () => {},
      onFurnitureChange: () => {},
    }),
  );
  assert.match(furniture, /align-items:stretch/u);
  assert.equal(
    [...furniture.matchAll(/align-items:stretch/gu)].length >= 4,
    true,
  );
  assert.equal([...furniture.matchAll(/flex:1;/gu)].length, 4);
  assert.equal([...furniture.matchAll(/MuiGrid-grid-lg-4/gu)].length, 4);
  assert.equal([...furniture.matchAll(/MuiGrid-grid-lg-8/gu)].length, 1);
  assert.equal([...furniture.matchAll(/MuiGrid-grid-sm-6/gu)].length, 2);
  assert.match(furniture, /MuiGrid-grid-md-7/u);
  assert.match(furniture, /MuiGrid-grid-md-5/u);
  assert.match(furniture, /Volumen neu berechnen/u);
  assert.match(furniture, /Möbel \/ Beschreibung/u);
  assert.doesNotMatch(furniture, /Katalogmöbel \(optional\)/u);
  assert.equal([...furniture.matchAll(/min="0"/gu)].length, 5);
  assert.match(furniture, /Schränke-Gesamtbreite/u);
  assert.match(furniture, /Küche-Gesamtbreite/u);
  const basis = render(
    createElement(BasisTab, {
      value,
      update: () => {},
      onBasisChange: () => {},
    }),
  );
  assert.equal([...basis.matchAll(/MuiGrid-grid-lg-4/gu)].length, 3);
  assert.ok([...basis.matchAll(/align-items:stretch/gu)].length >= 4);
  assert.equal([...basis.matchAll(/flex:1;/gu)].length, 3);
  assert.equal([...basis.matchAll(/MuiGrid-grid-md-6/gu)].length, 2);
  value.details.conditions = [
    { description: "Brutto", amount: 425, kind: "base" },
  ];
  const conditions = render(
    createElement(ConditionsTab, { value, onConditionsChange: () => {} }),
  );
  assert.match(conditions, /aria-label="Angebotsbasis"/u);
  assert.equal([...conditions.matchAll(/<tr/gu)].length, 3);
  assert.match(conditions, /GroupsOutlinedIcon/u);
  assert.match(conditions, /LocalShippingOutlinedIcon/u);
  assert.match(conditions, /ScheduleOutlinedIcon/u);
  assert.match(conditions, /Netto:[\s\S]*357,14/u);
  assert.match(conditions, /MwSt\. \(19 %\):[\s\S]*67,86/u);
  assert.match(conditions, /Summe:[\s\S]*425,00/u);
  assert.match(
    conditions,
    /@media \(min-width:900px\)[^}]*grid-template-columns:minmax\(0, 1\.3fr\) minmax\(0, 4\.7fr\)/u,
  );
});

test("volume recalculation sums furniture snapshots and configured box volumes", () => {
  const furniture = createEmptyOrder().details.furniture;
  furniture.items = [
    { name: "Sofa", quantity: 2, volume: 1.5 },
    { name: "Tisch", quantity: 1, volume: 2 },
  ];
  furniture.boxes = 2;
  furniture.wardrobeBoxes = 1;

  const complete = calculateFurnitureVolume(furniture, {
    boxVolume: 0.13,
    wardrobeBoxVolume: 0.6,
  });
  assert.ok(Math.abs(complete.volume - 5.86) < 1e-9);
  assert.equal(complete.volumeComplete, true);
  assert.deepEqual(
    calculateFurnitureVolume(furniture, {
      boxVolume: null,
      wardrobeBoxVolume: 0.6,
    }),
    { volume: 5.6, volumeComplete: false },
  );
});
