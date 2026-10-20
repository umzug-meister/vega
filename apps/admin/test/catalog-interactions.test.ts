import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";
import { mount } from "./dom-test-helpers.js";
import {
  furnitureCategoryChoices,
  FurniturePage,
} from "../src/catalog/FurniturePage.js";
import { ExtrasTab } from "../src/orders/ExtrasTab.js";
import { createEmptyOrder } from "../src/orders/order-form-types.js";

test("furniture categories follow configured order and ID without mutating the catalog", () => {
  const categories = [
    { id: 3, name: "Küche", sort: 20 },
    { id: 2, name: "Schlafzimmer", sort: 10 },
    { id: 1, name: "Wohnzimmer", sort: 10 },
  ];
  assert.deepEqual(
    furnitureCategoryChoices(categories).map((option) => option.value),
    [1, 2, 3],
  );
  assert.equal(categories[0]?.id, 3);
});

test("furniture editing sends selected category IDs and deletion requires confirmation", async () => {
  const originalFetch = globalThis.fetch;
  const categories = [
    { id: 2, name: "Küche", sort: 20 },
    { id: 1, name: "Wohnzimmer", sort: 10 },
  ];
  const furniture = {
    id: 7,
    name: "Sofa",
    volume: 2,
    step: 0.5,
    sortOrder: 0,
    categoryIds: [1],
    categoryRefs: [categories[1]],
  };
  const writes: Array<{ method: string; body?: unknown }> = [];
  globalThis.fetch = async (url, init) => {
    if (!init?.method || init.method === "GET")
      return Response.json({
        data: String(url).endsWith("/categories") ? categories : [furniture],
      });
    const body = init.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    writes.push({ method: init.method, ...(body ? { body } : {}) });
    return Response.json({
      data:
        init.method === "DELETE"
          ? { deleted: true }
          : { ...furniture, ...body },
    });
  };
  const app = await mount(createElement(FurniturePage));
  try {
    await app.click(
      app.container.querySelector('button[aria-haspopup="menu"]')!,
    );
    await app.click(
      [...app.window.document.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent === "Bearbeiten",
      )!,
    );
    const dialog = app.window.document.querySelector('[role="dialog"]')!;
    const stepInput = [
      ...dialog.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    ].find((input) => input.value === "0.5")!;
    assert.equal(stepInput.min, "0.5");
    assert.equal(stepInput.step, "0.5");
    const checkboxes = [
      ...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    assert.deepEqual(
      checkboxes.map((box) => box.closest("label")!.textContent),
      ["Wohnzimmer", "Küche"],
    );
    assert.deepEqual(
      checkboxes.map((box) => box.checked),
      [true, false],
    );
    await app.click(checkboxes[1]!);
    await app.click(
      [...dialog.querySelectorAll("button")].find(
        (button) => button.textContent === "Speichern",
      )!,
    );
    assert.deepEqual(writes, [
      {
        method: "PUT",
        body: {
          name: "Sofa",
          volume: 2,
          step: 0.5,
          sortOrder: 0,
          categoryIds: [1, 2],
        },
      },
    ]);
    await app.click(
      app.container.querySelector('button[aria-haspopup="menu"]')!,
    );
    app.window.confirm = () => false;
    await app.click(
      [...app.window.document.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent === "Löschen",
      )!,
    );
    assert.equal(writes.length, 1);
    assert.ok(app.container.textContent!.includes("Sofa"));
    await app.click(
      app.container.querySelector('button[aria-haspopup="menu"]')!,
    );
    app.window.confirm = () => true;
    await app.click(
      [...app.window.document.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent === "Löschen",
      )!,
    );
    assert.equal(writes.at(-1)!.method, "DELETE");
    assert.equal(
      app.container.querySelector("tbody")!.textContent!.includes("Sofa"),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await app.cleanup();
  }
});

test("admin order extras load the full staff catalogs, including entries hidden from the customer form", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    requested.push(path);
    const item = path.endsWith("/packings")
      ? {
          id: 21,
          name: "Interne Verpackung",
          price: 3,
          description: "",
          media: null,
          sort: 1,
          show: false,
        }
      : { id: 22, name: "Interne Leistung", price: 15, sort: 2, show: false };
    return Response.json({ data: [item] });
  };
  const app = await mount(
    createElement(ExtrasTab, {
      value: createEmptyOrder(),
      onExtrasChange: () => {},
    }),
  );
  try {
    assert.deepEqual(requested.sort(), [
      "/api/admin/catalog/packings",
      "/api/admin/catalog/services",
    ]);
    assert.ok(app.container.textContent?.includes("Packmaterial"));
    assert.ok(app.container.textContent?.includes("Leistungen"));
  } finally {
    globalThis.fetch = originalFetch;
    await app.cleanup();
  }
});
