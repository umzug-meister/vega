import assert from "node:assert/strict";
import { act, createElement } from "react";
import test from "node:test";
import { mount } from "./dom-test-helpers.js";
import { PwaStatus } from "../src/pwa/PwaStatus.js";

test("offline warning tracks connectivity without retrying writes", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "onLine");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  const app = await mount(createElement(PwaStatus, { enabled: false }));
  try {
    assert.match(app.container.textContent!, /Keine Internetverbindung/u);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => { app.window.dispatchEvent(new app.window.Event("online")); });
    assert.equal(app.container.textContent, "");
  } finally {
    if (previous) Object.defineProperty(navigator, "onLine", previous);
    else Reflect.deleteProperty(navigator, "onLine");
    await app.cleanup();
  }
});

test("available updates require confirmation before activating", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
  const messages: unknown[] = [];
  const serviceWorker = new EventTarget();
  const registration = new EventTarget();
  Object.assign(registration, {
    waiting: { postMessage: (message: unknown) => messages.push(message) },
    installing: null,
    update: async () => {},
  });
  Object.assign(serviceWorker, { controller: {}, register: async () => registration });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
  const app = await mount(createElement(PwaStatus, { enabled: true }));
  try {
    await app.flush();
    assert.match(app.container.textContent!, /neue Vega-Version/u);
    app.window.confirm = () => false;
    await app.click(app.container.querySelector("button")!);
    assert.deepEqual(messages, []);
    app.window.confirm = (message) => {
      assert.match(message, /anderen geöffneten Vega-Tabs/u);
      return true;
    };
    await app.click(app.container.querySelector("button")!);
    assert.deepEqual(messages, [{ type: "ACTIVATE_UPDATE" }]);
    assert.equal(app.container.querySelector("button")?.disabled, true);
  } finally {
    await app.cleanup();
    if (previous) Object.defineProperty(navigator, "serviceWorker", previous);
    else Reflect.deleteProperty(navigator, "serviceWorker");
  }
});
