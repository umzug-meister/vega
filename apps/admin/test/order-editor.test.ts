import assert from "node:assert/strict";
import * as React from "react";
import test, { type TestContext } from "node:test";
import type { CreateOrderInput, OrderPricingSnapshot } from "@vega/domain";
import { AdminNotifications } from "../src/components/AdminNotifications.js";
import { mount } from "./dom-test-helpers.js";
import { createEmptyOrder } from "../src/orders/order-form-types.js";

const input: CreateOrderInput = {
  customer: { firstName: "Original", lastName: "Customer", phone: "089123456" },
  from: { street: "First street 1", postalCode: "80331", city: "Munich" },
  to: { street: "Second street 2", postalCode: "80333", city: "Munich" },
  movingDate: "2026-11-01",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function editor(
  context: TestContext,
  {
    fresh = false,
    initialData = input,
    routeConfig = { origin: null, available: false },
    routeResult = {
      distanceKm: 12,
      durationMinutes: 30,
      legs: [
        { distanceKm: 4, durationMinutes: 10 },
        { distanceKm: 4, durationMinutes: 10 },
        { distanceKm: 4, durationMinutes: 10 },
      ],
    },
    write,
  }: {
    fresh?: boolean;
    initialData?: CreateOrderInput;
    routeConfig?: { origin: string | null; available: boolean };
    routeResult?: {
      distanceKm: number;
      durationMinutes: number;
      legs: Array<{ distanceKm: number; durationMinutes: number }>;
    };
    write: (body: Record<string, unknown>, method: string) => Response;
  },
) {
  const orderNumber = fresh ? undefined : 1000;
  context.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path === "/api/admin/routes/config")
        return json({ data: routeConfig });
      if (path === "/api/admin/routes/distance")
        return json({ data: routeResult });
      if (init?.method === "PUT" || init?.method === "POST") {
        return write(
          JSON.parse(String(init.body)) as Record<string, unknown>,
          init.method,
        );
      }
      if (path === "/api/admin/orders/1000")
        return json({
          data: {
            orderNumber: 1000,
            revision: 7,
            data: initialData,
            archivedAt: null,
            isCopy: false,
          },
        });
      if (path.endsWith("/family")) return json({ data: { items: [] } });
      return json({ data: [] });
    },
  );
  const view = await mount(null);
  const previousButton = Object.getOwnPropertyDescriptor(
    globalThis,
    "HTMLButtonElement",
  );
  Object.defineProperty(globalThis, "HTMLButtonElement", {
    configurable: true,
    value: view.window.HTMLButtonElement,
  });
  context.after(async () => {
    await view.cleanup();
    if (previousButton)
      Object.defineProperty(globalThis, "HTMLButtonElement", previousButton);
    else Reflect.deleteProperty(globalThis, "HTMLButtonElement");
  });
  const { OrderCreatePage } = await import("../src/orders/OrderCreatePage.js");
  const events: string[] = [];
  function Harness() {
    const [dirty, setDirty] = React.useState(orderNumber === undefined);
    const onDirtyChange = React.useCallback((next: boolean) => {
      events.push(`dirty:${next}`);
      setDirty(next);
    }, []);
    const onBusyChange = React.useCallback(() => {}, []);
    const navigate = React.useCallback((path: string) => {
      events.push(`navigate:${path}`);
    }, []);
    return React.createElement(
      AdminNotifications,
      null,
      React.createElement(
        React.Fragment,
        null,
        React.createElement(OrderCreatePage, {
          navigate,
          onDirtyChange,
          onBusyChange,
          dirty,
          ...(orderNumber === undefined ? {} : { orderNumber }),
        }),
        React.createElement(
          "button",
          { type: "submit", form: "order-create-form" },
          "Save",
        ),
        React.createElement("output", { "data-dirty": String(dirty) }),
      ),
    );
  }
  await view.render(React.createElement(Harness));
  await view.flush();
  const firstName = view.container.querySelector<HTMLInputElement>(
    'input[autocomplete="given-name"]',
  );
  const save = view.container.querySelector("button[form='order-create-form']");
  assert.ok(firstName && save);
  return { ...view, firstName, save, events };
}

test("automatically calculated route distances and durations are persisted on the order", async (context) => {
  const initialData: CreateOrderInput = {
    ...input,
    details: createEmptyOrder().details,
  };
  const writes: Array<{ body: Record<string, unknown>; method: string }> = [];
  const view = await editor(context, {
    initialData,
    routeConfig: { origin: "Depot 1, 80331 München", available: true },
    routeResult: {
      distanceKm: 12,
      durationMinutes: 31,
      legs: [
        { distanceKm: 4, durationMinutes: 10 },
        { distanceKm: 4, durationMinutes: 11 },
        { distanceKm: 4, durationMinutes: 10 },
      ],
    },
    write: (body, method) => {
      writes.push({ body, method });
      const data = { ...body };
      delete data.revision;
      return json({
        data: {
          orderNumber: 1000,
          revision: 8,
          data,
          archivedAt: null,
          isCopy: false,
        },
      });
    },
  });

  await view.flush();

  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.method, "PUT");
  assert.equal(writes[0]?.body.revision, 7);
  const details = writes[0]?.body.details as CreateOrderInput["details"];
  assert.equal(details?.distanceKm, 12);
  assert.equal(details?.distanceSource, "route");
  assert.deepEqual(
    {
      distanceKm: details?.routeSnapshot?.distanceKm,
      durationMinutes: details?.routeSnapshot?.durationMinutes,
      legs: details?.routeSnapshot?.legs,
      origin: details?.routeSnapshot?.origin,
      addresses: details?.routeSnapshot?.addresses,
    },
    {
      distanceKm: 12,
      durationMinutes: 31,
      legs: [
        { distanceKm: 4, durationMinutes: 10 },
        { distanceKm: 4, durationMinutes: 11 },
        { distanceKm: 4, durationMinutes: 10 },
      ],
      origin: "Depot 1, 80331 München",
      addresses: [
        "First street 1, 80331 Munich",
        "Second street 2, 80333 Munich",
      ],
    },
  );
  assert.ok(Number.isFinite(Date.parse(details!.routeSnapshot!.calculatedAt)));
  assert.equal(
    view.container.querySelector("[data-dirty]")?.getAttribute("data-dirty"),
    "false",
  );
});

test("order conflict keeps the edited fields, dirty state and original expected revision", async (context) => {
  const requests: Record<string, unknown>[] = [];
  const view = await editor(context, {
    write: (body) => {
      requests.push(body);
      return json(
        {
          error: {
            code: "ORDER_CONFLICT",
            message:
              "Der Auftrag wurde zwischenzeitlich geändert. Ihr Entwurf bleibt erhalten.",
          },
        },
        409,
      );
    },
  });
  assert.equal(view.firstName.value, "Original");
  await view.input(view.firstName, "Unsaved draft");
  assert.equal(
    view.container.querySelector("output")?.getAttribute("data-dirty"),
    "true",
  );
  await view.click(view.save);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.revision, 7);
  assert.equal(
    (requests[0]!.customer as { firstName: string }).firstName,
    "Unsaved draft",
  );
  assert.equal(view.firstName.value, "Unsaved draft");
  assert.equal(
    view.container.querySelector("output")?.getAttribute("data-dirty"),
    "true",
  );
  assert.match(
    view.container.textContent ?? "",
    /Ihr Entwurf bleibt erhalten/u,
  );
  assert.ok(!view.events.some((event) => event.startsWith("navigate:")));
  await view.click(view.save);
  assert.deepEqual(
    requests.map((request) => request.revision),
    [7, 7],
  );
});

test("successful order saves adopt normalized data and the returned revision for subsequent edits", async (context) => {
  const requests: Record<string, unknown>[] = [];
  const view = await editor(context, {
    write: (body, method) => {
      assert.equal(method, "PUT");
      requests.push(body);
      const customer = body.customer as CreateOrderInput["customer"];
      return json({
        data: {
          orderNumber: 1000,
          revision: 7 + requests.length,
          data: {
            ...body,
            customer: { ...customer, firstName: customer.firstName.trim() },
          },
        },
      });
    },
  });
  await view.input(view.firstName, " Saved ");
  await view.click(view.save);
  assert.equal(view.firstName.value, "Saved");
  assert.equal(
    view.container.querySelector("output")?.getAttribute("data-dirty"),
    "false",
  );
  await view.input(view.firstName, "Second edit");
  await view.click(view.save);
  assert.deepEqual(
    requests.map((request) => request.revision),
    [7, 8],
  );
  assert.equal(view.firstName.value, "Second edit");
  assert.equal(
    view.container.querySelector("output")?.getAttribute("data-dirty"),
    "false",
  );
});

test("saving an order drops service and packing rows missing a name or unit price", async (context) => {
  const initialData: CreateOrderInput = {
    ...input,
    details: {
      ...createEmptyOrder().details,
      extras: {
        packingRequested: false,
        services: [
          { kind: "service", name: "Bohrarbeiten", quantity: 1, unitPrice: 85 },
          { kind: "service", name: "Montage", quantity: 1, unitPrice: 50 },
          { kind: "service", name: "", quantity: 1, unitPrice: 20 },
          { kind: "service", name: "Freitext ohne Preis", quantity: 1 },
          { kind: "packaging", name: "  ", quantity: 2, unitPrice: 4 },
          { kind: "packaging", name: "Karton", quantity: 2, unitPrice: 0 },
        ],
      },
    },
  };
  let savedServices: unknown;
  const view = await editor(context, {
    initialData,
    write: (body) => {
      savedServices = (body.details as { extras: { services: unknown } }).extras
        .services;
      const savedData = { ...body };
      delete savedData.revision;
      return json({
        data: { orderNumber: 1000, revision: 8, data: savedData },
      });
    },
  });

  const extrasTab = [
    ...view.container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
  ].find((tab) => tab.textContent?.includes("Leistungen"));
  assert.ok(extrasTab);
  await view.click(extrasTab);
  const bohrarbeiten = [
    ...view.container.querySelectorAll<HTMLInputElement>(
      'input[role="combobox"]',
    ),
  ].find((serviceInput) => serviceInput.value === "Bohrarbeiten");
  assert.ok(bohrarbeiten);
  const row = bohrarbeiten.closest(".MuiGrid-container");
  assert.ok(row);
  const priceLabel = [...row.querySelectorAll<HTMLLabelElement>("label")].find(
    (label) => label.textContent?.trim() === "Einzelpreis (€)",
  );
  assert.ok(priceLabel);
  const clearedPriceInput = view.container.querySelector<HTMLInputElement>(
    `#${priceLabel.htmlFor}`,
  );
  assert.ok(clearedPriceInput);
  await view.input(clearedPriceInput, "");
  await view.click(view.save);
  assert.deepEqual(savedServices, [
    { kind: "service", name: "Montage", quantity: 1, unitPrice: 50 },
    { kind: "packaging", name: "Karton", quantity: 2, unitPrice: 0 },
  ]);
  assert.equal(
    view.container.querySelector("output")?.getAttribute("data-dirty"),
    "false",
  );
});

test("saving an order removes blank furniture rows and keeps named furniture", async (context) => {
  const initialData: CreateOrderInput = {
    ...input,
    details: {
      ...createEmptyOrder().details,
      furniture: {
        ...createEmptyOrder().details.furniture,
        items: [
          { name: "  ", quantity: 1, volume: 0 },
          { name: "Sofa", quantity: 1, volume: 2 },
          { name: "", quantity: 2, volume: 0 },
        ],
      },
    },
  };
  let savedFurniture: unknown;
  const view = await editor(context, {
    initialData,
    write: (body) => {
      savedFurniture = (body.details as CreateOrderInput["details"])!.furniture
        .items;
      const savedData = { ...body };
      delete savedData.revision;
      return json({
        data: { orderNumber: 1000, revision: 8, data: savedData },
      });
    },
  });

  await view.click(view.save);

  assert.deepEqual(savedFurniture, [{ name: "Sofa", quantity: 1, volume: 2 }]);
  assert.equal(
    view.container.querySelector("output")?.getAttribute("data-dirty"),
    "false",
  );
});

test("saving an order removes unnamed furniture rows and preserves named rows", async (context) => {
  const initialData: CreateOrderInput = {
    ...input,
    details: {
      ...createEmptyOrder().details,
      furniture: {
        ...createEmptyOrder().details.furniture,
        items: [
          { name: " ", quantity: 1, volume: 0 },
          { name: "Sofa", quantity: 1, volume: 2 },
        ],
      },
    },
  };
  let savedItems: unknown;
  const view = await editor(context, {
    initialData,
    write: (body) => {
      savedItems = (body.details as CreateOrderInput["details"])!.furniture
        .items;
      const savedData = { ...body };
      delete savedData.revision;
      return json({
        data: { orderNumber: 1000, revision: 8, data: savedData },
      });
    },
  });

  await view.click(view.save);

  assert.deepEqual(savedItems, [{ name: "Sofa", quantity: 1, volume: 2 }]);
});

test("saving changed pricing inputs warns to review and recalculate order positions", async (context) => {
  const initialData: CreateOrderInput = {
    ...input,
    details: createEmptyOrder().details,
    pricingSnapshot: {
      version: 1,
      calculatedAt: "2026-10-01T00:00:00.000Z",
      source: {
        offerId: null,
        workers: 0,
        trucks: 0,
        hours: 0,
        basePrice: 0,
        extraHourPrice: 0,
        discountPercent: 0,
        distanceKm: 0,
        addresses: [
          { city: "Munich", parkingSlot: false },
          { city: "Munich", parkingSlot: false },
        ],
        services: [],
      },
      offer: null,
      rates: [],
      services: [],
    } satisfies OrderPricingSnapshot,
  };
  let savedWorkers = 0;
  const view = await editor(context, {
    initialData,
    write: (body) => {
      savedWorkers = (body.details as CreateOrderInput["details"])!.basis
        .workers;
      const savedData = { ...body };
      delete savedData.revision;
      return json({
        data: { orderNumber: 1000, revision: 8, data: savedData },
      });
    },
  });
  const basisTab = [
    ...view.container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
  ].find((tab) => tab.textContent?.trim() === "Basis");
  assert.ok(basisTab);
  await view.click(basisTab);
  const workersLabel = [
    ...view.container.querySelectorAll<HTMLLabelElement>("label"),
  ].find((label) => label.textContent?.trim() === "Träger");
  assert.ok(workersLabel);
  const workersInput = view.container.querySelector<HTMLInputElement>(
    `#${workersLabel.htmlFor}`,
  );
  assert.ok(workersInput);
  await view.input(workersInput, "3");
  await view.click(view.save);

  assert.equal(savedWorkers, 3);
  const notification = view.container.querySelector<HTMLElement>(
    '[aria-live="polite"] [role="alert"]',
  );
  assert.ok(notification, "Expected a save notification");
  assert.match(
    notification.textContent ?? "",
    /Preisrelevante Angaben wurden geändert/u,
  );
  assert.match(
    notification.textContent ?? "",
    /Positionen gegebenenfalls neu/u,
  );
  assert.equal(
    view.container.querySelector("output")?.getAttribute("data-dirty"),
    "false",
  );
});

test("order creation clears dirty synchronously before navigating to the persisted editor", async (context) => {
  const requests: Record<string, unknown>[] = [];
  const view = await editor(context, {
    fresh: true,
    write: (body, method) => {
      assert.equal(method, "POST");
      requests.push(body);
      return json({ data: { orderNumber: 1012 } }, 201);
    },
  });
  await view.input(view.firstName, "New customer");
  await view.click(view.save);
  assert.equal(requests.length, 1);
  assert.equal("revision" in requests[0]!, false);
  const navigation = view.events.indexOf("navigate:/edit/1012");
  assert.ok(navigation > 0);
  assert.equal(view.events[navigation - 1], "dirty:false");
});
