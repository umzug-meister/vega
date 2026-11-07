import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import test from "node:test";
import { FurnitureTab } from "../src/orders/FurnitureTab.js";
import { createEmptyOrder } from "../src/orders/order-form-types.js";
import { mount } from "./dom-test-helpers.js";

test("furniture input supports both free text and catalog suggestions", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "/api/catalog/furniture") {
      return Response.json({
        data: [
          {
            id: 41,
            name: "Sofa",
            categoryIds: [3],
            categoryRefs: [{ id: 3, name: "Wohnzimmer" }],
            volume: 1.7,
            step: 1,
            sortOrder: 0,
          },
        ],
      });
    }
    if (url === "/api/customer-form/config") {
      return Response.json({
        data: {
          privacyUrl: null,
          boxCalculatorUrl: null,
          successUrl: null,
          boxVolume: 0.13,
          wardrobeBoxVolume: 0.6,
          uploadsAvailable: false,
          placesAvailable: false,
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const initial = createEmptyOrder();
  initial.details.furniture.items = [{ name: "", quantity: 1, volume: 0 }];
  function Harness() {
    const [value, setValue] = React.useState(initial);
    return createElement(
      React.Fragment,
      null,
      createElement(FurnitureTab, {
        value,
        update: (patch) => setValue((current) => ({ ...current, ...patch })),
        onFurnitureChange: (furniture) =>
          setValue((current) => ({
            ...current,
            details: { ...current.details, furniture },
          })),
      }),
      createElement(
        "pre",
        { "data-testid": "furniture-items" },
        JSON.stringify(value.details.furniture.items),
      ),
    );
  }

  const view = await mount(createElement(Harness));
  try {
    await view.flush();
    const input = view.container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    assert.ok(input);

    await view.input(input, "Custom bookcase");
    await view.flush();
    let items = JSON.parse(
      view.container.querySelector('[data-testid="furniture-items"]')!
        .textContent!,
    ) as Array<Record<string, unknown>>;
    assert.equal(items[0]?.name, "Custom bookcase");
    assert.equal("catalogId" in items[0]!, false);

    await view.input(input, "Sofa");
    await view.flush();
    const option = [
      ...view.window.document.querySelectorAll('[role="option"]'),
    ].find((entry) => entry.textContent?.trim() === "Sofa");
    assert.ok(option);
    await view.click(option);
    await view.flush();
    items = JSON.parse(
      view.container.querySelector('[data-testid="furniture-items"]')!
        .textContent!,
    ) as Array<Record<string, unknown>>;
    assert.deepEqual(items[0], {
      name: "Sofa",
      quantity: 1,
      volume: 1.7,
      catalogId: 41,
      category: "Wohnzimmer",
    });
  } finally {
    globalThis.fetch = originalFetch;
    await view.cleanup();
  }
});

test("furniture numeric inputs start empty and accept explicit zero or cleared values", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input) === "/api/catalog/furniture")
      return Response.json({ data: [] });
    if (String(input) === "/api/customer-form/config") {
      return Response.json({
        data: {
          privacyUrl: null,
          boxCalculatorUrl: null,
          successUrl: null,
          boxVolume: 0.13,
          wardrobeBoxVolume: 0.6,
          uploadsAvailable: false,
          placesAvailable: false,
        },
      });
    }
    throw new Error(`Unexpected request: ${String(input)}`);
  };

  function Harness() {
    const [value, setValue] = React.useState(createEmptyOrder);
    return createElement(
      React.Fragment,
      null,
      createElement(FurnitureTab, {
        value,
        update: (patch) => setValue((current) => ({ ...current, ...patch })),
        onFurnitureChange: (furniture) =>
          setValue((current) => ({
            ...current,
            details: { ...current.details, furniture },
          })),
      }),
      createElement(
        "pre",
        { "data-testid": "numeric-state" },
        JSON.stringify({
          volume: value.details.furniture.volume,
          boxes: value.details.furniture.boxes,
          wardrobeBoxes: value.details.furniture.wardrobeBoxes,
          bedNumber: value.from.bedNumber,
          wardrobeWidth: value.from.wardrobeWidth,
          kitchenWidth: value.from.kitchenWidth,
        }),
      ),
    );
  }

  const view = await mount(createElement(Harness));
  try {
    await view.flush();
    assert.equal(
      view.container.querySelectorAll(".MuiInputAdornment-root").length,
      2,
    );
    const getInput = (labelText: string) => {
      const label = [...view.container.querySelectorAll("label")].find(
        (entry) => entry.textContent?.trim() === labelText,
      );
      assert.ok(label, `Missing field ${labelText}`);
      const input = view.container.querySelector<HTMLInputElement>(
        `#${label.htmlFor}`,
      );
      assert.ok(input, `Missing input ${labelText}`);
      return input;
    };

    for (const label of [
      "Berechnetes Umzugsvolumen (m³)",
      "Betten",
      "Schränke-Gesamtbreite",
      "Küche-Gesamtbreite",
      "Kartons",
      "Kleiderboxen",
    ]) {
      assert.equal(getInput(label).value, "", `${label} should start empty`);
    }

    const cartons = getInput("Kartons");
    await view.input(cartons, "0");
    await view.flush();
    assert.equal(cartons.value, "0");
    assert.equal(
      JSON.parse(
        view.container.querySelector('[data-testid="numeric-state"]')!
          .textContent!,
      ).boxes,
      0,
    );

    await view.input(cartons, "5");
    await view.flush();
    await view.input(cartons, "");
    await view.flush();
    assert.equal(cartons.value, "");
    assert.equal(
      JSON.parse(
        view.container.querySelector('[data-testid="numeric-state"]')!
          .textContent!,
      ).boxes,
      0,
    );

    const volume = getInput("Berechnetes Umzugsvolumen (m³)");
    await view.input(volume, "12");
    await view.flush();
    assert.equal(volume.value, "12");
    assert.equal(
      JSON.parse(
        view.container.querySelector('[data-testid="numeric-state"]')!
          .textContent!,
      ).volume,
      12,
    );

    await view.input(volume, "");
    await view.flush();
    assert.equal(volume.value, "");
    assert.equal(
      JSON.parse(
        view.container.querySelector('[data-testid="numeric-state"]')!
          .textContent!,
      ).volume,
      0,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await view.cleanup();
  }
});
