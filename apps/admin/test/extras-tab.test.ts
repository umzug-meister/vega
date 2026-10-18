import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { ExtrasTab } from "../src/orders/ExtrasTab.js";
import { createEmptyOrder } from "../src/orders/order-form-types.js";

test("packaging and services render in separate responsive cards", () => {
  const value = createEmptyOrder();
  value.details.extras = {
    packingRequested: true,
    services: [
      { catalogId: 7, name: "Umzugskarton", quantity: 3, kind: "packaging" },
    ],
  };

  const previous = Reflect.get(globalThis, "React");
  Reflect.set(globalThis, "React", React);
  try {
    const html = renderToStaticMarkup(
      React.createElement(ExtrasTab, { value, onExtrasChange: () => {} }),
    );

    assert.match(html, /Kunde möchte Verpackungsmaterial kaufen\./u);
    assert.match(html, /Umzugskarton/u);
    assert.match(html, /Packmaterial/u);
    assert.match(html, /Einzelpreis/u);
    assert.match(html, /role="combobox"/u);
    assert.doesNotMatch(html, /Katalog-Packmaterial|Katalogleistung/u);
    assert.match(html, />Leistungen</u);
    assert.match(html, /Leistung hinzufügen/u);
    assert.doesNotMatch(html, /Verpackung erwünscht\?/u);
    assert.doesNotMatch(html, /role="switch"/u);
    assert.doesNotMatch(html, /role="tablist"/u);
    assert.equal([...html.matchAll(/MuiPaper-outlined/gu)].length, 2);
    assert.equal([...html.matchAll(/MuiGrid-grid-lg-6/gu)].length, 2);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "React");
    else Reflect.set(globalThis, "React", previous);
  }
});
