import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";
import { mount } from "./dom-test-helpers.js";
import {
  furnitureCategoryChoices,
  FurniturePage,
} from "../src/catalog/FurniturePage.js";
import { PackingsPage } from "../src/catalog/PackingsPage.js";
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

test("packing description uses the rich-text editor and saves formatted HTML", async () => {
  const originalFetch = globalThis.fetch;
  const packing = {
    id: 8,
    name: "Kleiderbox",
    price: 4,
    description: "<p>Transportiert Kleidung <strong>knitterfrei</strong>.</p>",
    media: "https://cdn.example.test/kleiderbox.png",
    sort: 1,
    show: true,
  };
  const writes: Array<{ method: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (_url, init) => {
    if (!init?.method || init.method === "GET")
      return Response.json({ data: [packing] });
    const body = init.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    writes.push({ method: init.method, ...(body ? { body } : {}) });
    return Response.json({ data: { ...packing, ...body } });
  };
  const app = await mount(createElement(PackingsPage));
  try {
    await app.click(
      app.container.querySelector('button[aria-label="Aktionen für Eintrag 8"]')!,
    );
    await app.click(
      [...app.window.document.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent?.includes("Bearbeiten"),
      )!,
    );
    await app.flush();
    const dialog = app.window.document.querySelector('[role="dialog"]')!;
    assert.ok(dialog.classList.contains("MuiDialog-paperWidthLg"));
    const preview = dialog.querySelector(
      '[aria-label="Vorschau im Kundenformular"]',
    );
    assert.ok(preview);
    assert.equal(preview.querySelector("strong")?.textContent, "knitterfrei");
    const previewImage = preview.querySelector<HTMLImageElement>("img");
    assert.equal(previewImage?.src, packing.media);
    assert.equal(previewImage?.alt, packing.name);
    assert.equal(previewImage?.getAttribute("referrerpolicy"), "no-referrer");
    assert.equal(app.window.getComputedStyle(previewImage!).width, "100%");
    assert.equal(app.window.getComputedStyle(previewImage!).height, "auto");
    const nameInput = [...dialog.querySelectorAll<HTMLInputElement>("input")].find(
      (input) => input.value === "Kleiderbox",
    )!;
    await app.input(nameInput, "Neue Kleiderbox");
    assert.ok(preview.textContent?.includes("Neue Kleiderbox"));
    assert.ok(dialog.querySelector('button[aria-label="Fett"]'));
    assert.equal(dialog.querySelector("strong")?.textContent, "knitterfrei");
    await app.click(
      [...dialog.querySelectorAll("button")].find(
        (button) => button.textContent === "Speichern",
      )!,
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.method, "PUT");
    assert.equal(writes[0]?.body?.name, "Neue Kleiderbox");
    assert.match(String(writes[0]?.body?.description), /<strong>knitterfrei<\/strong>/u);
  } finally {
    globalThis.fetch = originalFetch;
    await app.cleanup();
  }
});

test("packing creation and edited sort order update the customer preview", async () => {
  const originalFetch = globalThis.fetch;
  const packings = [
    { id: 1, name: "Erster Karton", price: 4, description: "", media: null, sort: 1, show: true },
    { id: 2, name: "Zweiter Karton", price: 5, description: "", media: null, sort: 2, show: true },
  ];
  globalThis.fetch = async (url, init) => {
    if (!init?.method || init.method === "GET") return Response.json({ data: packings });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const original = packings.find((packing) => String(url).endsWith(`/${packing.id}`));
    return Response.json({ data: { ...(original ?? { id: 3 }), ...body } });
  };
  const app = await mount(createElement(PackingsPage));
  try {
    await app.click(app.container.querySelector('[aria-label="Aktionen für Eintrag 2"]')!);
    await app.click([...app.window.document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent?.includes("Bearbeiten"))!);
    let dialog = app.window.document.querySelector('[role="dialog"]')!;
    const sort = [...dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')].find((input) => input.value === "2")!;
    await app.input(sort, "0");
    await app.click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Speichern")!);
    const visible = app.container.querySelector('[aria-label="Im Kundenformular sichtbar"]')!;
    assert.deepEqual(
      [...visible.querySelectorAll('button[aria-haspopup="menu"]')].map((button) => button.getAttribute("aria-label")),
      ["Aktionen für Eintrag 2", "Aktionen für Eintrag 1"],
    );
    await app.click([...app.container.querySelectorAll("button")].find((button) => button.textContent?.includes("Eintrag anlegen"))!);
    dialog = app.window.document.querySelector('[role="dialog"]')!;
    const name = [...dialog.querySelectorAll<HTMLInputElement>("input")].find((input) => input.labels?.[0]?.textContent === "Name")!;
    await app.input(name, "Neuer Karton");
    await app.click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Speichern")!);
    assert.ok(visible.textContent?.includes("Neuer Karton"));
    assert.ok(visible.querySelector('[aria-label="Aktionen für Eintrag 3"]'));
  } finally {
    globalThis.fetch = originalFetch;
    await app.cleanup();
  }
});

test("packing cards show the customer order and retain actions for hidden entries", async () => {
  const originalFetch = globalThis.fetch;
  const packings = [
    { id: 2, name: "Später", price: 4, description: "<p>Beschreibung</p>", media: "https://cdn.example.test/box.png", sort: 2, show: true },
    { id: 3, name: "Intern", price: 5, description: "", media: null, sort: 0, show: false },
    { id: 1, name: "Zuerst", price: 3, description: "", media: null, sort: 1, show: true },
  ];
  const writes: string[] = [];
  globalThis.fetch = async (url, init) => {
    if (!init?.method || init.method === "GET") return Response.json({ data: packings });
    writes.push(`${init.method} ${String(url)}`);
    return Response.json({ data: { deleted: true } });
  };
  const app = await mount(createElement(PackingsPage));
  try {
    assert.equal(app.container.querySelector("table"), null);
    assert.ok([...app.container.querySelectorAll("button")].some((button) => button.textContent?.includes("Eintrag anlegen")));
    const visible = app.container.querySelector('[aria-label="Im Kundenformular sichtbar"]')!;
    const hidden = app.container.querySelector('[aria-label="Im Kundenformular ausgeblendet"]')!;
    assert.deepEqual(
      [...visible.querySelectorAll('button[aria-haspopup="menu"]')].map((button) => button.getAttribute("aria-label")),
      ["Aktionen für Eintrag 1", "Aktionen für Eintrag 2"],
    );
    assert.ok(hidden.textContent?.includes("Intern"));
    assert.ok(visible.textContent?.includes("4,00"));
    assert.equal(visible.querySelector("img")?.getAttribute("referrerpolicy"), "no-referrer");
    assert.equal(visible.querySelector("input")?.readOnly, true);
    await app.click(hidden.querySelector('button[aria-haspopup="menu"]')!);
    await app.click([...app.window.document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent?.includes("Löschen"))!);
    assert.deepEqual(writes, ["DELETE /api/admin/catalog/packings/3"]);
    assert.equal(app.container.querySelector('[aria-label="Im Kundenformular ausgeblendet"]'), null);
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
    const items = path.endsWith("/packings")
      ? [
          {
            id: 21,
            name: "Interne Verpackung",
            price: 3,
            description: "",
            media: null,
            sort: 1,
            show: false,
          },
          {
            id: 23,
            name: "Nicht ausgewählter Karton",
            price: 2,
            description: "",
            media: null,
            sort: 2,
            show: true,
          },
        ]
      : [{ id: 22, name: "Interne Leistung", price: 15, sort: 2, show: false }];
    return Response.json({ data: items });
  };
  const order = createEmptyOrder();
  order.details.extras.services = [
    {
      catalogId: 21,
      name: "Interne Verpackung",
      unitPrice: 3,
      quantity: 2,
      kind: "packaging",
    },
  ];
  const app = await mount(
    createElement(ExtrasTab, {
      value: order,
      onExtrasChange: () => {},
    }),
  );
  try {
    await app.flush();
    assert.deepEqual(requested.sort(), [
      "/api/admin/catalog/packings",
      "/api/admin/catalog/services",
    ]);
    assert.ok(app.container.textContent?.includes("Packmaterial"));
    assert.ok(app.container.textContent?.includes("Leistungen"));
    const labels = [...app.container.querySelectorAll("p")];
    const selectedPacking = labels.find(
      (label) => label.textContent === "Interne Verpackung",
    );
    const unselectedPacking = labels.find(
      (label) => label.textContent === "Nicht ausgewählter Karton",
    );
    assert.ok(selectedPacking);
    assert.ok(unselectedPacking);
    assert.equal(app.window.getComputedStyle(selectedPacking).fontWeight, "700");
    assert.equal(app.window.getComputedStyle(unselectedPacking).fontWeight, "400");
  } finally {
    globalThis.fetch = originalFetch;
    await app.cleanup();
  }
});
