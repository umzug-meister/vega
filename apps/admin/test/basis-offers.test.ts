import assert from "node:assert/strict";
import * as React from "react";
import test, { type TestContext } from "node:test";
import type { CatalogOfferDto } from "@vega/domain";
import { BasisTab, filterOffersByBasis } from "../src/orders/BasisTab.js";
import { createEmptyOrder } from "../src/orders/order-form-types.js";
import { mount } from "./dom-test-helpers.js";

const offers: CatalogOfferDto[] = [
  {
    id: 1,
    name: "3 Träger · 2 LKW",
    workers: 3,
    trucks: 2,
    includedHours: 4,
    sum: 800,
    hourPrice: 170,
    ridingCosts: 90,
    sort: 1,
  },
  {
    id: 2,
    name: "4 Träger · 2 LKW",
    workers: 4,
    trucks: 2,
    includedHours: 4,
    sum: 1000,
    hourPrice: 220,
    ridingCosts: 90,
    sort: 2,
  },
  {
    id: 3,
    name: "3 Träger · 1 LKW",
    workers: 3,
    trucks: 1,
    includedHours: 6,
    sum: 600,
    hourPrice: 110,
    ridingCosts: 45,
    sort: 3,
  },
];

function futureDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("offer filters use only positive worker, truck, and hour inputs", () => {
  const basis = createEmptyOrder().details.basis;
  assert.equal(filterOffersByBasis(offers, basis).length, 3);
  assert.deepEqual(
    filterOffersByBasis(offers, { ...basis, workers: 3 }).map(
      (offer) => offer.id,
    ),
    [1, 3],
  );
  assert.deepEqual(
    filterOffersByBasis(offers, {
      ...basis,
      workers: 3,
      trucks: 2,
      hours: 4,
    }).map((offer) => offer.id),
    [1],
  );
});

test("Basis tab filters as quantities are entered and offers one-click selection for one match", async (context: TestContext) => {
  context.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ data: offers }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  const view = await mount(null);
  try {
    function Harness() {
      const [value, setValue] = React.useState(() => ({
        ...createEmptyOrder(),
        movingDate: futureDate(60),
      }));
      return React.createElement(BasisTab, {
        value,
        update: (patch) => setValue((current) => ({ ...current, ...patch })),
        onBasisChange: (basis) =>
          setValue((current) => ({
            ...current,
            details: { ...current.details, basis },
          })),
      });
    }
    await view.render(React.createElement(Harness));
    await view.flush();

    for (const labelText of [
      "Träger",
      "LKW 3,5",
      "Stunden",
      "Betrag",
      "Stundenpreis",
      "Rabatt",
    ]) {
      const label = [...view.container.querySelectorAll("label")].find(
        (entry) => entry.textContent?.trim() === labelText,
      );
      assert.ok(label, `Missing field ${labelText}`);
      const input = view.container.querySelector<HTMLInputElement>(
        `#${label.htmlFor}`,
      );
      assert.ok(input, `Missing input ${labelText}`);
      assert.equal(input.value, "", `${labelText} should initially be empty`);
    }
    assert.equal(
      view.container.querySelectorAll(".MuiInputAdornment-root").length,
      3,
    );
    assert.match(view.container.textContent ?? "", /€.*€/u);
    assert.match(view.container.textContent ?? "", /%/u);
    assert.ok(
      [...view.container.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "10 % übernehmen",
      ),
    );
    assert.doesNotMatch(
      view.container.textContent ?? "",
      /Empfehlung nach Vorlaufzeit/u,
    );
    assert.equal(view.container.querySelectorAll(".MuiChip-root").length, 0);

    const setNumber = async (labelText: string, value: string) => {
      const label = [...view.container.querySelectorAll("label")].find(
        (entry) => entry.textContent?.trim() === labelText,
      );
      assert.ok(label, `Missing field ${labelText}`);
      const input = view.container.querySelector<HTMLInputElement>(
        `#${label.htmlFor}`,
      );
      assert.ok(input, `Missing input ${labelText}`);
      await view.input(input, value);
      await view.flush();
    };

    assert.equal(view.container.querySelectorAll("tbody tr").length, 3);
    await setNumber("Träger", "3");
    assert.equal(view.container.querySelectorAll("tbody tr").length, 2);
    await setNumber("LKW 3,5", "2");
    await setNumber("Stunden", "4");
    assert.equal(view.container.querySelectorAll("tbody tr").length, 1);
    const choose = view.container.querySelector<HTMLElement>(
      "button[aria-label^='Einziges passendes Angebot auswählen']",
    );
    assert.ok(choose);
    assert.equal(choose.textContent?.trim(), "Vorschlag übernehmen");
    await view.click(choose);
    const hoursLabel = [...view.container.querySelectorAll("label")].find(
      (entry) => entry.textContent?.trim() === "Stunden",
    );
    assert.ok(hoursLabel);
    assert.equal(
      view.container.querySelector<HTMLInputElement>(`#${hoursLabel.htmlFor}`)
        ?.value,
      "4",
    );
  } finally {
    await view.cleanup();
  }
});

test("staff truck count input has no four-truck maximum", async (context) => {
  context.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ data: offers }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  const view = await mount(null);
  try {
    function Harness() {
      const [value, setValue] = React.useState(() => createEmptyOrder());
      return React.createElement(BasisTab, {
        value,
        update: (patch) => setValue((current) => ({ ...current, ...patch })),
        onBasisChange: (basis) =>
          setValue((current) => ({
            ...current,
            details: { ...current.details, basis },
          })),
      });
    }
    await view.render(React.createElement(Harness));
    const label = [...view.container.querySelectorAll("label")].find(
      (entry) => entry.textContent?.trim() === "LKW 3,5",
    );
    assert.ok(label);
    const input = view.container.querySelector<HTMLInputElement>(
      `#${label.htmlFor}`,
    );
    assert.ok(input);
    assert.equal(input.max, "");
  } finally {
    await view.cleanup();
  }
});
