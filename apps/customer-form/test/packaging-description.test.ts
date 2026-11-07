import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";
import { mount } from "../../admin/test/dom-test-helpers.js";
import { Packaging } from "../src/FinalSteps.js";
import { initialDraft, type FormResources } from "../src/form-model.js";

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
    assert.ok(app.container.textContent?.includes("Transportiert Kleidung"));
  } finally {
    await app.cleanup();
  }
});
