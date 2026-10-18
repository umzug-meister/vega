import assert from "node:assert/strict";
import { createElement, act } from "react";
import test from "node:test";
import { mount } from "../../admin/test/dom-test-helpers.js";
import { App } from "../src/App.js";

test("invalid fields show an error toast, focus and scroll again on repeated validation", async (context) => {
  context.mock.method(globalThis, "fetch", async (url: string) =>
    Response.json({
      data: url.endsWith("/config")
        ? {
            privacyUrl: "https://example.test/privacy",
            boxCalculatorUrl: null,
            successUrl: null,
            boxVolume: 0.1,
            wardrobeBoxVolume: 0.5,
            uploadsAvailable: false,
            placesAvailable: false,
          }
        : [],
    }),
  );
  const dom = await mount(createElement(App));
  context.after(() => dom.cleanup());
  await act(async () => {
    await import("../src/DateField.js");
  });
  await dom.flush();
  const scrolled: HTMLElement[] = [];
  context.mock.method(
    dom.window.HTMLElement.prototype,
    "scrollIntoView",
    function (this: HTMLElement) {
      scrolled.push(this);
    },
  );
  const next = [...dom.container.querySelectorAll("button")].find(
    (item) => item.textContent === "weiter",
  )!;
  const firstName = dom.container.querySelector<HTMLInputElement>(
    'input[autocomplete="given-name"]',
  )!;
  await dom.click(next);
  assert.equal(firstName.getAttribute("aria-invalid"), "true");
  assert.equal(dom.window.document.activeElement, firstName);
  assert.ok(
    dom.container
      .querySelector('[role="alert"]')
      ?.textContent?.includes("Vorname"),
  );
  assert.ok(scrolled.at(-1)?.contains(firstName));
  const previousScrolls = scrolled.length;
  await dom.click(next);
  assert.ok(scrolled.length > previousScrolls, "same error must scroll again");
  await dom.input(firstName, "Ada");
  assert.equal(firstName.getAttribute("aria-invalid"), "false");
  await dom.click(next);
  const lastName = dom.container.querySelector<HTMLInputElement>(
    'input[autocomplete="family-name"]',
  )!;
  assert.equal(lastName.getAttribute("aria-invalid"), "true");
  assert.equal(dom.window.document.activeElement, lastName);
  assert.ok(scrolled.at(-1)?.contains(lastName));
});

test("lazy form steps retain contact input and load the German date picker", async (context) => {
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (url: string) => {
    requests.push(url);
    return Response.json({
      data: url.endsWith("/config")
        ? {
            privacyUrl: "https://example.test/privacy",
            boxCalculatorUrl: null,
            successUrl: null,
            boxVolume: 0.1,
            wardrobeBoxVolume: 0.5,
            uploadsAvailable: false,
            placesAvailable: false,
          }
        : [],
    });
  });
  const dom = await mount(createElement(App));
  context.after(() => dom.cleanup());
  await act(async () => {
    await import("../src/DateField.js");
  });
  await dom.flush();
  assert.ok(dom.container.querySelector('[aria-label^="Datum auswählen"]'));
  for (const [autocomplete, value] of [
    ["given-name", "Ada"],
    ["family-name", "Beispiel"],
    ["email", "ada@example.test"],
    ["tel", "+49 89 123456"],
  ]) {
    await dom.input(
      dom.container.querySelector<HTMLInputElement>(
        `input[autocomplete="${autocomplete}"]`,
      )!,
      value!,
    );
  }
  await act(async () => {
    await import("../src/MovingSteps.js");
  });
  const button = (text: string) => {
    const node = [...dom.container.querySelectorAll("button")].find(
      (item) => item.textContent === text,
    );
    assert.ok(node, text);
    return node;
  };
  await dom.click(button("weiter"));
  await dom.flush();
  assert.equal(dom.window.location.hash, "#/auszug");
  assert.equal(
    dom.container.querySelector('input[autocomplete="given-name"]'),
    null,
  );
  await dom.click(button("zurück"));
  await dom.flush();
  assert.equal(
    dom.container.querySelector<HTMLInputElement>(
      'input[autocomplete="given-name"]',
    )?.value,
    "Ada",
  );
  assert.equal(
    dom.container.querySelector<HTMLInputElement>('input[autocomplete="email"]')
      ?.value,
    "ada@example.test",
  );
  assert.equal(requests.length, 6);
});
