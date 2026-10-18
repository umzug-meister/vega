import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { CustomerTab } from "../src/orders/CustomerTab.js";
import { createEmptyOrder } from "../src/orders/order-form-types.js";
import { mount } from "./dom-test-helpers.js";

function renderCustomerTab(value: ReturnType<typeof createEmptyOrder>) {
  const previous = Reflect.get(globalThis, "React");
  Reflect.set(globalThis, "React", React);
  try {
    return renderToStaticMarkup(
      React.createElement(CustomerTab, { value, update: () => {} }),
    );
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "React");
    else Reflect.set(globalThis, "React", previous);
  }
}

test("customer tab omits the redundant privacy confirmation message", () => {
  const html = renderCustomerTab({
    ...createEmptyOrder(),
    privacyAccepted: true,
  });

  assert.doesNotMatch(html, /Datenschutzerklärung bei der Anfrage bestätigt/u);
});

test("customer tab omits the generated creation timestamp", () => {
  const html = renderCustomerTab(createEmptyOrder());

  assert.doesNotMatch(html, /Erstellt:/u);
});

test("customer tab shows the customer's visit request beneath costs assumption", () => {
  const html = renderCustomerTab({
    ...createEmptyOrder(),
    visitWanted: true,
  });
  const costsAssumptionLabel = html.indexOf("Kostenübernahme durch Arbeitsamt");
  const visitNotice = html.indexOf(
    "Der Kunde möchte wegen eines kostenlosen Besichtigungstermins kontaktiert werden.",
  );

  assert.notEqual(costsAssumptionLabel, -1);
  assert.notEqual(visitNotice, -1);
  assert.ok(visitNotice > costsAssumptionLabel);
});

test("customer tab hides the visit request when the customer did not ask for contact", () => {
  const html = renderCustomerTab({
    ...createEmptyOrder(),
    visitWanted: false,
  });

  assert.doesNotMatch(html, /kostenlosen Besichtigungstermins kontaktiert/u);
});

test("order source menu omits legacy Express, furniture-list and Umzug Ruck Zuck entries", async () => {
  const view = await mount(
    React.createElement(CustomerTab, {
      value: createEmptyOrder(),
      update: () => {},
    }),
  );
  try {
    const select = [
      ...view.container.querySelectorAll('[role="combobox"]'),
    ].find((combobox) => combobox.textContent?.trim() === "individuelle");
    assert.ok(select);
    await React.act(async () => {
      select.dispatchEvent(
        new view.window.MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    await view.flush();

    const optionLabels = [
      ...view.window.document.querySelectorAll('[role="option"]'),
    ].map((option) => option.textContent?.trim() ?? "");
    assert.deepEqual(optionLabels, [
      "individuelle",
      "CHECK24",
      "umzugruckzuck24.de",
    ]);
  } finally {
    await view.cleanup();
  }
});

test("customer cards use wider vertical spacing than horizontal spacing", () => {
  const html = renderCustomerTab(createEmptyOrder());

  assert.match(html, /row-gap:32px/u);
  assert.match(html, /column-gap:16px/u);
  assert.equal([...html.matchAll(/MuiPaper-outlined/gu)].length, 2);
  assert.doesNotMatch(html, /grid-row:span 2/u);
});
