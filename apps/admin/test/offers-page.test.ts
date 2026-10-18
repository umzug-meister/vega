import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test, { type TestContext } from "node:test";
import {
  OffersPage,
  shouldDeleteOfferValue,
  validPrice,
} from "../src/catalog/OffersPage.js";
import { mount } from "./dom-test-helpers.js";

function json(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("offers page renders the truck/workforce matrix and row-add actions", () => {
  const previous = Reflect.get(globalThis, "React");
  Reflect.set(globalThis, "React", React);
  try {
    const html = renderToStaticMarkup(React.createElement(OffersPage));

    for (const trucks of [1, 2, 3, 4]) {
      assert.match(html, new RegExp(`>${trucks}<\\/td>`, "u"));
    }
    for (const heading of [
      "LKW",
      "Anfahrt",
      "Träger",
      "Einzelpreis",
      "8",
      "7",
      "6",
      "5",
      "4",
      "3",
      "2",
    ]) {
      assert.ok(html.includes(heading));
    }
    assert.doesNotMatch(html, /<th[^>]*>Aktion<\/th>/u);
    assert.match(html, /position:sticky/u);
    assert.match(html, /font-weight:700/u);
    assert.equal([...html.matchAll(/>Anfahrtskosten<\/label>/gu)].length, 4);
    assert.doesNotMatch(html, /Anfahrtskosten ·/u);
    assert.doesNotMatch(html, /Anfahrt:/u);
    assert.match(html, /Träger[\s\S]*?font-weight:700/u);
    assert.ok(html.includes("Trägerzeile hinzufügen"));
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "React");
    else Reflect.set(globalThis, "React", previous);
  }
});

test("empty or zero offer totals mean delete; positive totals remain offers", () => {
  for (const value of ["", "   ", "0", "0.00", "0,00"]) {
    assert.equal(shouldDeleteOfferValue(value), true, value);
  }
  for (const value of ["0.01", "100", " 42.50 "]) {
    assert.equal(shouldDeleteOfferValue(value), false, value);
  }
});

test("validPrice accepts two-decimal amounts despite float representation error", () => {
  for (const value of ["0.29", "1.13", "2.01", "0.07", "12.5", "0"]) {
    assert.equal(validPrice(value), Number(value), value);
  }
  for (const value of ["", "   ", "-1", "abc", "1.005", "1,5"]) {
    assert.equal(validPrice(value), null, value);
  }
});

test("matrix hides zero-total zero-hour offers and can start adding a worker row", async (context: TestContext) => {
  context.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request) => {
      if (String(url) === "/api/admin/catalog/offers") {
        return json([
          {
            id: 1,
            name: "2 Träger · 1 LKW",
            workers: 2,
            trucks: 1,
            includedHours: 8,
            sum: 0,
            hourPrice: 0,
            ridingCosts: 45,
            sort: 0,
          },
          {
            id: 2,
            name: "2 Träger · 1 LKW",
            workers: 2,
            trucks: 1,
            includedHours: 7,
            sum: 700,
            hourPrice: 110,
            ridingCosts: 45,
            sort: 1,
          },
          {
            id: 3,
            name: "2 Träger · 1 LKW",
            workers: 2,
            trucks: 1,
            includedHours: 6,
            sum: 0,
            hourPrice: 110,
            ridingCosts: 45,
            sort: 2,
          },
        ]);
      }
      if (String(url) === "/api/admin/catalog/service-rates") {
        return json(
          [1, 2, 3, 4].map((trucks) => ({
            key: `ridingCostsTruck${trucks}`,
            price: trucks * 45,
          })),
        );
      }
      return json({});
    },
  );
  const view = await mount(null);
  try {
    await view.render(React.createElement(OffersPage));
    await view.flush();

    assert.equal(
      view.container.querySelector(
        '[aria-label="Gesamtpreis 2 Träger, 1 LKW, 8 Stunden"]',
      ),
      null,
    );
    assert.ok(
      view.container.querySelector(
        '[aria-label="Gesamtpreis 2 Träger, 1 LKW, 7 Stunden"]',
      ),
    );
    assert.ok(
      view.container.querySelector(
        '[aria-label="Gesamtpreis 2 Träger, 1 LKW, 6 Stunden"]',
      ),
    );
    assert.ok(
      view.container.querySelector(
        '[aria-label="Einzelpreis 2 Träger, 1 LKW"]',
      ),
    );
    assert.equal(view.window.document.querySelector('[role="dialog"]'), null);
    assert.equal(
      view.container.querySelector('[aria-label="Angebot löschen"]'),
      null,
    );

    const addRow = [...view.container.querySelectorAll("button")].find(
      (button) =>
        button.textContent?.includes("Trägerzeile hinzufügen (1 LKW)"),
    );
    assert.ok(addRow);
    await view.click(addRow);
    assert.ok(
      view.container.querySelector(
        '[aria-label="Neuer Gesamtpreis 1 Träger, 1 LKW, 8 Stunden"]',
      ),
    );
    assert.equal(view.window.document.querySelector('[role="dialog"]'), null);
  } finally {
    await view.cleanup();
  }
});
