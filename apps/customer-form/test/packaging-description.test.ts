import assert from "node:assert/strict";
import { createElement, useState } from "react";
import test from "node:test";
import { mount } from "../../admin/test/dom-test-helpers.js";
import { Packaging } from "../src/FinalSteps.js";
import { initialDraft, type FormResources } from "../src/form-model.js";
import { PackingCard } from "../src/PackingCard.js";

const resources: FormResources = {
  config: {
    privacyUrl: null,
    boxCalculatorUrl: null,
    successUrl: null,
    boxVolume: null,
    wardrobeBoxVolume: null,
    uploadsAvailable: false,
    placesAvailable: false,
  },
  categories: [],
  furniture: [],
  packings: [
    {
      id: 1,
      name: "Kleiderbox",
      price: 4,
      description:
        "<p>Transportiert Kleidung <strong>knitterfrei</strong>.</p><ul><li>Stabil</li></ul>",
      media: "https://cdn.example.test/kleiderbox.png",
      sort: 1,
      show: true,
    },
  ],
  services: [],
  rates: [],
};

test("customer packaging renders formatted catalog descriptions", async () => {
  const draft = initialDraft();
  draft.packingRequested = true;
  const app = await mount(
    createElement(Packaging, {
      draft,
      setDraft: () => {},
      resources,
    }),
  );
  try {
    assert.equal(
      app.container.querySelector("strong")?.textContent,
      "knitterfrei",
    );
    assert.equal(app.container.querySelector("li")?.textContent, "Stabil");
    const image = app.container.querySelector<HTMLImageElement>("img");
    assert.equal(image?.src, "https://cdn.example.test/kleiderbox.png");
    assert.equal(image?.alt, "Kleiderbox");
    assert.equal(image?.getAttribute("referrerpolicy"), "no-referrer");
    assert.equal(app.window.getComputedStyle(image!).width, "100%");
    assert.equal(app.window.getComputedStyle(image!).height, "auto");
    assert.equal(app.window.getComputedStyle(image!).maxHeight, "360px");
    assert.equal(image?.parentElement?.querySelector("strong")?.textContent, "knitterfrei");
    const card = image?.closest(".MuiCard-root");
    assert.ok(card);
    const cardStyle = app.window.getComputedStyle(card);
    assert.equal(cardStyle.width, "100%");
    assert.equal(cardStyle.maxWidth, "900px");
    assert.equal(cardStyle.marginLeft, "auto");
    assert.equal(cardStyle.marginRight, "auto");
    assert.equal(cardStyle.alignSelf, "center");
    assert.ok(app.container.textContent?.includes("Transportiert Kleidung"));
  } finally {
    await app.cleanup();
  }
});

test("packing cards keep the description when no image is configured", async () => {
  const app = await mount(createElement(PackingCard, {
    name: "Karton", price: 4, description: "<p>Beschreibung</p>",
    media: null, quantity: null,
  }));
  try {
    assert.equal(app.container.querySelector("img"), null);
    assert.equal(app.container.querySelector("p")?.textContent, "Beschreibung");
  } finally {
    await app.cleanup();
  }
});

test("packing cards wrap names and make wide descriptions keyboard-scrollable", async () => {
  const app = await mount(createElement(PackingCard, {
    name: "Bodenschutzvliesrolle", price: 4, media: null, quantity: null,
    description: "<table><tbody><tr><td>SehrLangeArtikelbezeichnungOhneLeerzeichen</td><td>Weitere Spalte</td></tr></tbody></table>",
    action: createElement("button", { "aria-label": "Aktionen" }, "Menü"),
  }));
  try {
    const name = [...app.container.querySelectorAll("h5")].find((item) => item.textContent === "Bodenschutzvliesrolle")!;
    assert.equal(app.window.getComputedStyle(name).overflowWrap, "anywhere");
    const description = app.container.querySelector('[role="region"]')!;
    assert.equal(description.getAttribute("aria-label"), "Beschreibung: Bodenschutzvliesrolle");
    assert.equal(description.getAttribute("tabindex"), "0");
    assert.equal(app.window.getComputedStyle(description).overflowX, "auto");
    assert.equal(app.window.getComputedStyle(description).overflowWrap, "anywhere");
    assert.ok(description.querySelector("table"));
    assert.ok(app.container.querySelector('button[aria-label="Aktionen"]'));
  } finally {
    await app.cleanup();
  }
});

test("customer packaging quantities remain editable", async () => {
  function Form() {
    const [draft, setDraft] = useState(() => ({ ...initialDraft(), packingRequested: true }));
    return createElement(Packaging, { draft, setDraft, resources });
  }
  const app = await mount(createElement(Form));
  try {
    const input = app.container.querySelector<HTMLInputElement>('input[type="number"]')!;
    await app.input(input, "3");
    assert.equal(input.value, "3");
    assert.ok(app.container.querySelector('[data-testid="CheckOutlinedIcon"]'));
    await app.input(input, "0");
    assert.equal(input.value, "");
    assert.ok(app.container.querySelector('[data-testid="ShoppingCartCheckoutOutlinedIcon"]'));
  } finally {
    await app.cleanup();
  }
});
