import assert from "node:assert/strict";
import * as React from "react";
import test from "node:test";
import { WorldClocks } from "../src/components/WorldClocks.js";
import { mount } from "./dom-test-helpers.js";

test("world clocks show local times, move the hands and clean up their timer", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-01-15T12:00:00Z") });
  let tick: (() => void) | undefined;
  let cleared: number | undefined;
  context.mock.method(window, "setInterval", (callback: TimerHandler) => {
    assert.equal(typeof callback, "function");
    tick = callback;
    return 42;
  });
  context.mock.method(window, "clearInterval", (id?: number) => {
    cleared = id;
  });
  const view = await mount(React.createElement(WorldClocks));
  let cleaned = false;
  context.after(() => cleaned ? undefined : view.cleanup());
  await view.flush();
  const section = view.container.querySelector('[aria-label="Ortszeiten"]');
  assert.ok(section);
  assert.equal(view.window.getComputedStyle(section).justifyItems, "center");
  assert.equal(section.querySelector(".MuiPaper-root"), null);
  assert.deepEqual(
    [...section.querySelectorAll("time")].map((time) => time.textContent),
    ["13:00", "15:00", "14:00", "14:00"],
  );
  assert.deepEqual(
    [...section.querySelectorAll("time")].map((time) => time.parentElement?.querySelector(".MuiTypography-caption")?.textContent),
    ["München", "Minsk", "Kaliningrad", "Warna"],
  );
  assert.equal(section.querySelectorAll("svg").length, 4);
  const faces = section.querySelectorAll("svg");
  assert.equal(view.window.getComputedStyle(faces[0]!).width, "76px");
  for (const face of [...faces].slice(1))
    assert.equal(view.window.getComputedStyle(face).width, "48px");
  const hands = section.querySelector("svg")?.querySelectorAll("line");
  assert.equal(hands?.length, 15);
  assert.equal(hands?.[12]?.getAttribute("transform"), "rotate(30 50 50)");
  assert.equal(hands?.[13]?.getAttribute("transform"), "rotate(0 50 50)");
  context.mock.timers.setTime(Date.parse("2026-07-15T12:01:00Z"));
  assert.ok(tick);
  await React.act(async () => tick());
  assert.deepEqual(
    [...section.querySelectorAll("time")].map((time) => time.textContent),
    ["14:01", "15:01", "14:01", "15:01"],
  );
  assert.equal(hands?.[12]?.getAttribute("transform"), "rotate(60.5 50 50)");
  assert.equal(hands?.[13]?.getAttribute("transform"), "rotate(6 50 50)");
  await view.cleanup();
  cleaned = true;
  assert.equal(cleared, 42);
});
