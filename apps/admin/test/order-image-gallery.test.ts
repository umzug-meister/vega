import { mount } from "./dom-test-helpers.js";
import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, useState } from "react";
import { OrderImageGallery, type OrderGalleryImage } from "../src/orders/OrderImageGallery.js";
import { OrderImages } from "../src/orders/OrderImages.js";

const images: OrderGalleryImage[] = [
  { id: "a", url: "https://img.test/a.jpg" },
  { id: "b", url: "https://img.test/b.jpg" },
  { id: "c", url: "https://img.test/c.jpg" },
];

function GalleryHarness() {
  const [index, setIndex] = useState(0);
  return createElement(OrderImageGallery, {
    images,
    index,
    onChange: setIndex,
    onClose: () => {},
  });
}

function counter(document: Document): string {
  const element = document.querySelector('[aria-live="polite"]');
  assert.ok(element, "counter missing");
  return element.textContent ?? "";
}

async function pressKey(window: Window & typeof globalThis, key: string) {
  await act(async () => {
    window.dispatchEvent(
      new window.KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });
}

test("gallery shows thumbnails, a centered counter and wraps around in both directions", async (context) => {
  const dom = await mount(createElement(GalleryHarness));
  context.after(() => dom.cleanup());
  await dom.flush();
  const document = dom.window.document;
  const thumbnails = [
    ...document.querySelectorAll<HTMLButtonElement>('[aria-label^="Bild "]'),
  ];
  assert.equal(thumbnails.length, 3);
  assert.equal(counter(document), "1 / 3");
  assert.equal(
    document.querySelector("img[alt='Kundenbild 1 von 3']")?.getAttribute("src"),
    images[0]!.url,
  );

  await dom.click(document.querySelector('[aria-label="Nächstes Bild"]')!);
  assert.equal(counter(document), "2 / 3");

  await dom.click(document.querySelector('[aria-label="Nächstes Bild"]')!);
  await dom.click(document.querySelector('[aria-label="Nächstes Bild"]')!);
  assert.equal(counter(document), "1 / 3");
  assert.equal(
    document.querySelector("img[alt='Kundenbild 1 von 3']")?.getAttribute("src"),
    images[0]!.url,
  );

  await dom.click(document.querySelector('[aria-label="Vorheriges Bild"]')!);
  assert.equal(counter(document), "3 / 3");
  assert.equal(
    document.querySelector("img[alt='Kundenbild 3 von 3']")?.getAttribute("src"),
    images[2]!.url,
  );

  await pressKey(dom.window, "ArrowRight");
  assert.equal(counter(document), "1 / 3");
  await pressKey(dom.window, "ArrowLeft");
  assert.equal(counter(document), "3 / 3");
});

test("clicking a thumbnail jumps to that image and marks it as current", async (context) => {
  const dom = await mount(createElement(GalleryHarness));
  context.after(() => dom.cleanup());
  await dom.flush();
  const document = dom.window.document;
  await dom.click(document.querySelector('[aria-label="Bild 2 von 3"]')!);
  assert.equal(counter(document), "2 / 3");
  assert.equal(
    document.querySelector('[aria-label="Bild 2 von 3"]')?.getAttribute("aria-current"),
    "true",
  );
  assert.equal(
    document.querySelector('[aria-label="Bild 1 von 3"]')?.getAttribute("aria-current"),
    null,
  );
});

test("the customer image grid opens the gallery at the clicked image", async (context) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ data: images.slice(0, 2) });
  const dom = await mount(createElement(OrderImages, { orderNumber: 1014 }));
  context.after(async () => {
    await dom.cleanup();
    globalThis.fetch = originalFetch;
  });
  await dom.flush();
  const document = dom.window.document;
  await dom.click(
    document.querySelector('[aria-label="Kundenbild 2 von 2 öffnen"]')!,
  );
  await dom.flush();
  assert.equal(counter(document), "2 / 2");
  const close = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "Schließen",
  );
  assert.ok(close);
  await dom.click(close);
  await dom.flush();
  assert.equal(document.querySelector('[aria-live="polite"]'), null);
});
