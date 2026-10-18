import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import * as React from "react";
import type { OrderDetailsInput } from "@vega/domain";
import { AddressFields } from "../src/orders/AddressFields.js";
import { AddressesTab } from "../src/orders/AddressesTab.js";
import {
  createEmptyOrder,
  type OrderFormValue,
} from "../src/orders/order-form-types.js";
import { formatDurationMinutes } from "../src/orders/RouteDistance.js";
import { mount } from "./dom-test-helpers.js";

test("route durations use German minute and hour labels", () => {
  assert.equal(formatDurationMinutes(0), "0 Min.");
  assert.equal(formatDurationMinutes(5), "5 Min.");
  assert.equal(formatDurationMinutes(59), "59 Min.");
  assert.equal(formatDurationMinutes(60), "1 Std.");
  assert.equal(formatDurationMinutes(61), "1 Std. 1 Min.");
  assert.equal(formatDurationMinutes(125), "2 Std. 5 Min.");
  assert.equal(formatDurationMinutes(120), "2 Std.");
  assert.equal(formatDurationMinutes(4.6), "5 Min.");
  assert.equal(formatDurationMinutes(NaN), "–");
  assert.equal(formatDurationMinutes(-1), "–");
});

function completeOrder(
  details: Partial<OrderDetailsInput> = {},
): OrderFormValue {
  const base = createEmptyOrder();
  return {
    ...base,
    from: {
      ...base.from,
      street: "Senderstraße 1",
      postalCode: "80331",
      city: "München",
    },
    to: {
      ...base.to,
      street: "Zielstraße 2",
      postalCode: "80333",
      city: "München",
    },
    details: { ...base.details, ...details },
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function routePayload(distanceKm: number, legCount = 3) {
  return {
    data: {
      distanceKm,
      durationMinutes: 30,
      legs: Array.from({ length: legCount }, (_, index) => ({
        distanceKm: index + 1,
        durationMinutes: 10,
      })),
    },
  };
}

interface RouteMockOptions {
  config?: { origin: string | null; available: boolean };
  distance: () => Response;
}

function installRoutes(context: TestContext, options: RouteMockOptions) {
  const calls: Array<{ addresses: string[] }> = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path === "/api/admin/routes/config")
        return json({
          data: options.config ?? {
            origin: "Depot Straße 1, 80331 München",
            available: true,
          },
        });
      if (path === "/api/admin/routes/distance") {
        calls.push(JSON.parse(String(init?.body)) as { addresses: string[] });
        return options.distance();
      }
      return json({ data: [] });
    },
  );
  return calls;
}

function AddressesHarness({ initial }: { initial: OrderFormValue }) {
  const [value, setValue] = React.useState(initial);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(AddressesTab, {
      value,
      update: (patch: Partial<OrderFormValue>) =>
        setValue((previous) => ({ ...previous, ...patch })),
      onDetailsChange: (details: OrderDetailsInput) =>
        setValue((previous) => ({ ...previous, details })),
    }),
    React.createElement(
      "output",
      { "data-testid": "distance" },
      String(value.details.distanceKm),
    ),
    React.createElement(
      "output",
      { "data-testid": "source" },
      value.details.distanceSource ?? "",
    ),
  );
}

function labeledInput(
  container: Element,
  label: string,
  index = 0,
): HTMLInputElement {
  const labels = [...container.querySelectorAll("label")].filter(
    (element) => element.textContent === label,
  );
  const id = labels[index]?.getAttribute("for");
  assert.ok(id, `no label ${label} at index ${index}`);
  const input = container.querySelector<HTMLInputElement>(`input[id="${id}"]`);
  assert.ok(input, `no input for label ${label}`);
  return input;
}

async function focusout(view: { window: Window }, target: Element) {
  await React.act(async () => {
    target.dispatchEvent(
      new view.window.FocusEvent("focusout", { bubbles: true }),
    );
  });
}

test("automatic route calculation runs once for a complete order without a stored distance", async (context) => {
  const calls = installRoutes(context, {
    distance: () => json(routePayload(12)),
  });
  const app = await mount(
    React.createElement(AddressesHarness, { initial: completeOrder() }),
  );
  try {
    await app.flush();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.addresses, [
      "Senderstraße 1, 80331 München",
      "Zielstraße 2, 80333 München",
    ]);
    assert.equal(labeledInput(app.container, "Entfernung in km").value, "12");
    assert.equal(
      app.container.querySelector('[data-testid="source"]')?.textContent,
      "route",
    );
  } finally {
    await app.cleanup();
  }
});

test("an asynchronously loaded complete order is calculated once it becomes ready", async (context) => {
  const calls = installRoutes(context, {
    distance: () => json(routePayload(12)),
  });
  function LoadingHarness() {
    const [value, setValue] = React.useState<OrderFormValue>(() => {
      const order = completeOrder();
      return { ...order, to: { ...order.to, city: "" } };
    });
    const [ready, setReady] = React.useState(false);
    const load = React.useCallback(() => {
      setValue(completeOrder());
      setReady(true);
    }, []);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(AddressesTab, {
        value,
        ready,
        update: () => {},
        onDetailsChange: () => {},
      }),
      React.createElement("button", { onClick: load }, "load"),
    );
  }
  const app = await mount(React.createElement(LoadingHarness));
  try {
    await app.flush();
    assert.equal(
      calls.length,
      0,
      "an order that is still loading is not calculated",
    );
    await app.click(
      [...app.container.querySelectorAll("button")].find(
        (entry) => entry.textContent === "load",
      )!,
    );
    await app.flush();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.addresses, [
      "Senderstraße 1, 80331 München",
      "Zielstraße 2, 80333 München",
    ]);
  } finally {
    await app.cleanup();
  }
});

test("an existing manual distance is never overwritten on open", async (context) => {
  const calls = installRoutes(context, {
    distance: () => json(routePayload(12)),
  });
  const app = await mount(
    React.createElement(AddressesHarness, {
      initial: completeOrder({ distanceKm: 42, distanceSource: "manual" }),
    }),
  );
  try {
    await app.flush();
    assert.equal(calls.length, 0);
    assert.equal(labeledInput(app.container, "Entfernung in km").value, "42");
    assert.equal(
      app.container.querySelector('[data-testid="source"]')?.textContent,
      "manual",
    );
  } finally {
    await app.cleanup();
  }
});

test("a changed route field recalculates on blur exactly once and unchanged blurs stay silent", async (context) => {
  let calculated = 12;
  const calls = installRoutes(context, {
    distance: () => json(routePayload((calculated += 3))),
  });
  const app = await mount(
    React.createElement(AddressesHarness, {
      initial: completeOrder({ distanceKm: 12, distanceSource: "route" }),
    }),
  );
  try {
    await app.flush();
    assert.equal(
      calls.length,
      0,
      "an existing route distance is not recalculated on open",
    );
    const postalCode = labeledInput(app.container, "PLZ");
    await app.input(postalCode, "80335");
    await focusout(app, postalCode);
    await app.flush();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.addresses, [
      "Senderstraße 1, 80335 München",
      "Zielstraße 2, 80333 München",
    ]);
    assert.equal(labeledInput(app.container, "Entfernung in km").value, "15");
    await focusout(app, postalCode);
    await app.flush();
    assert.equal(calls.length, 1, "an unchanged blur must not request again");
  } finally {
    await app.cleanup();
  }
});

test("incomplete active addresses skip the request and keep the manual fallback", async (context) => {
  const calls = installRoutes(context, {
    distance: () => json(routePayload(12)),
  });
  const initial = completeOrder();
  const app = await mount(
    React.createElement(AddressesHarness, {
      initial: { ...initial, to: { ...initial.to, city: "" } },
    }),
  );
  try {
    await app.flush();
    assert.equal(calls.length, 0);
    const button = [...app.container.querySelectorAll("button")].find(
      (entry) => entry.textContent === "Fahrstrecke berechnen",
    );
    assert.ok(button);
    assert.equal(button.disabled, true);
  } finally {
    await app.cleanup();
  }
});

test("editing an address hides the stale route diagram until the blur recalculates", async (context) => {
  let calculated = 9;
  const calls = installRoutes(context, {
    distance: () => json(routePayload((calculated += 3))),
  });
  const app = await mount(
    React.createElement(AddressesHarness, { initial: completeOrder() }),
  );
  try {
    await app.flush();
    assert.equal(calls.length, 1);
    assert.match(app.container.textContent ?? "", /Gesamt: 12 km/u);
    const postalCode = labeledInput(app.container, "PLZ");
    await app.input(postalCode, "80335");
    await app.flush();
    assert.doesNotMatch(
      app.container.textContent ?? "",
      /Gesamt/u,
      "the stale diagram is hidden while the address is edited",
    );
    await focusout(app, postalCode);
    await app.flush();
    assert.equal(calls.length, 2);
    assert.match(app.container.textContent ?? "", /Gesamt: 15 km/u);
  } finally {
    await app.cleanup();
  }
});

test("returning to a previously calculated route recalculates on blur", async (context) => {
  let calculated = 9;
  const calls = installRoutes(context, {
    distance: () => json(routePayload((calculated += 3))),
  });
  const app = await mount(
    React.createElement(AddressesHarness, { initial: completeOrder() }),
  );
  try {
    await app.flush();
    assert.equal(calls.length, 1);
    const postalCode = labeledInput(app.container, "PLZ");
    await app.input(postalCode, "80335");
    await app.flush();
    await app.input(postalCode, "80331");
    await app.flush();
    assert.doesNotMatch(app.container.textContent ?? "", /Gesamt/u);
    await focusout(app, postalCode);
    await app.flush();
    assert.equal(
      calls.length,
      2,
      "returning to a previously calculated route must recalculate on the next blur",
    );
    assert.match(app.container.textContent ?? "", /Gesamt: 15 km/u);
  } finally {
    await app.cleanup();
  }
});

test("activated secondary addresses join the calculation in stop order", async (context) => {
  const calls = installRoutes(context, {
    distance: () => json(routePayload(30, 4)),
  });
  const initial = completeOrder({
    showSecondaryFrom: true,
    secondaryFrom: {
      ...createEmptyOrder().from,
      street: "Zwischenstraße 3",
      postalCode: "80334",
      city: "München",
    },
  });
  const app = await mount(React.createElement(AddressesHarness, { initial }));
  try {
    await app.flush();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.addresses, [
      "Senderstraße 1, 80331 München",
      "Zwischenstraße 3, 80334 München",
      "Zielstraße 2, 80333 München",
    ]);
    const secondaryPostalCode = labeledInput(app.container, "PLZ", 1);
    await app.input(secondaryPostalCode, "80336");
    await focusout(app, secondaryPostalCode);
    await app.flush();
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.addresses[1], "Zwischenstraße 3, 80336 München");
  } finally {
    await app.cleanup();
  }
});

test("missing provider configuration shows the hint and requests nothing", async (context) => {
  const calls = installRoutes(context, {
    config: { origin: null, available: false },
    distance: () => json(routePayload(12)),
  });
  const app = await mount(
    React.createElement(AddressesHarness, { initial: completeOrder() }),
  );
  try {
    await app.flush();
    assert.equal(calls.length, 0);
    assert.match(
      app.container.textContent ?? "",
      /manuelle Entfernungseingabe bleibt verfügbar/u,
    );
  } finally {
    await app.cleanup();
  }
});

test("a provider error keeps the stored distance and the manual button retries", async (context) => {
  let attempt = 0;
  const calls = installRoutes(context, {
    distance: () =>
      ++attempt === 1
        ? json(
            {
              error: {
                code: "ROUTES_PROVIDER_FAILED",
                message: "Google konnte die Fahrstrecke nicht berechnen.",
              },
            },
            502,
          )
        : json(routePayload(21)),
  });
  const app = await mount(
    React.createElement(AddressesHarness, {
      initial: completeOrder({ distanceKm: 12, distanceSource: "route" }),
    }),
  );
  try {
    await app.flush();
    const postalCode = labeledInput(app.container, "PLZ");
    await app.input(postalCode, "80335");
    await focusout(app, postalCode);
    await app.flush();
    assert.equal(calls.length, 1);
    assert.equal(
      labeledInput(app.container, "Entfernung in km").value,
      "12",
      "the failed request must not clear the stored distance",
    );
    assert.match(
      app.container.textContent ?? "",
      /Google konnte die Fahrstrecke nicht berechnen/u,
    );
    const retry = [...app.container.querySelectorAll("button")].find(
      (entry) => entry.textContent === "Fahrstrecke berechnen",
    );
    assert.ok(retry);
    await app.click(retry);
    await app.flush();
    assert.equal(calls.length, 2);
    assert.equal(labeledInput(app.container, "Entfernung in km").value, "21");
  } finally {
    await app.cleanup();
  }
});

test("a stale response from an aborted calculation is ignored", async (context) => {
  const pending: Array<{
    resolve: (response: Response) => void;
    signal?: AbortSignal | null;
  }> = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path === "/api/admin/routes/config")
        return json({
          data: { origin: "Depot Straße 1, 80331 München", available: true },
        });
      if (path === "/api/admin/routes/distance") {
        return new Promise<Response>((resolve) =>
          pending.push({ resolve, signal: init?.signal }),
        );
      }
      return json({ data: [] });
    },
  );
  const app = await mount(
    React.createElement(AddressesHarness, { initial: completeOrder() }),
  );
  try {
    await app.flush();
    assert.equal(pending.length, 1, "the initial calculation is in flight");
    const postalCode = labeledInput(app.container, "PLZ");
    await app.input(postalCode, "80335");
    await focusout(app, postalCode);
    await app.flush();
    assert.equal(pending.length, 2, "the blur starts a newer calculation");
    assert.equal(
      pending[0]!.signal?.aborted,
      true,
      "the older request is aborted",
    );
    await React.act(async () => {
      pending[1]!.resolve(json(routePayload(20)));
    });
    await app.flush();
    await React.act(async () => {
      pending[0]!.resolve(json(routePayload(99)));
    });
    await app.flush();
    assert.equal(labeledInput(app.container, "Entfernung in km").value, "20");
  } finally {
    await app.cleanup();
  }
});

test("AddressFields forwards blur only for street, postal code and city", async (context) => {
  context.mock.method(globalThis, "fetch", async () => json({ data: [] }));
  function FieldsHarness() {
    const [value, setValue] = React.useState(completeOrder().from);
    const [blurs, setBlurs] = React.useState(0);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(AddressFields, {
        title: "",
        value,
        onChange: (patch) =>
          setValue((previous) => ({ ...previous, ...patch })),
        onRouteFieldBlur: () => {
          setBlurs((count) => count + 1);
        },
      }),
      React.createElement("output", { "data-testid": "blurs" }, String(blurs)),
    );
  }
  const app = await mount(React.createElement(FieldsHarness));
  try {
    for (const label of ["Adresse", "PLZ", "Ort"]) {
      await focusout(app, labeledInput(app.container, label));
    }
    assert.equal(
      app.container.querySelector('[data-testid="blurs"]')?.textContent,
      "3",
    );
    await focusout(app, labeledInput(app.container, "Zimmer"));
    assert.equal(
      app.container.querySelector('[data-testid="blurs"]')?.textContent,
      "3",
      "non-route fields must not signal a blur",
    );
  } finally {
    await app.cleanup();
  }
});

test("destination address hides apartment details that customers do not provide", async (context) => {
  context.mock.method(globalThis, "fetch", async () => json({ data: [] }));
  const address = completeOrder().from;
  const app = await mount(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(AddressFields, {
        title: "Auszug",
        value: address,
        onChange: () => {},
      }),
      React.createElement(AddressFields, {
        title: "Einzug",
        value: address,
        showApartmentDetails: false,
        onChange: () => {},
      }),
    ),
  );
  try {
    const labels = [
      ...app.container.querySelectorAll(".MuiInputLabel-root"),
    ].map((label) => label.textContent?.trim());
    assert.equal(labels.filter((label) => label === "Fläche").length, 1);
    assert.equal(labels.filter((label) => label === "Zimmer").length, 1);
    assert.equal(
      labels.filter((label) => label === "Zimmer zum Umziehen").length,
      1,
    );
    assert.equal(
      [...app.container.querySelectorAll(".MuiTypography-overline")].filter(
        (heading) => heading.textContent?.trim() === "Wohnung",
      ).length,
      1,
    );
  } finally {
    await app.cleanup();
  }
});

test("zero rooms-to-relocate defaults to an empty numeric field", async (context) => {
  context.mock.method(globalThis, "fetch", async () => json({ data: [] }));
  const app = await mount(
    React.createElement(AddressFields, {
      title: "Beladestelle",
      value: completeOrder().from,
      onChange: () => {},
    }),
  );
  try {
    const label = [
      ...app.container.querySelectorAll(".MuiInputLabel-root"),
    ].find((entry) => entry.textContent?.trim() === "Zimmer zum Umziehen");
    assert.ok(label);
    const input = app.container.querySelector<HTMLInputElement>(
      `#${label.htmlFor}`,
    );
    assert.ok(input);
    assert.equal(input.value, "");
  } finally {
    await app.cleanup();
  }
});

test("house address shows the customer-form floor choices as multi-select toggles", async (context) => {
  context.mock.method(globalThis, "fetch", async () => json({ data: [] }));
  function HouseHarness() {
    const [address, setAddress] = React.useState({
      ...completeOrder().from,
      movementObject: "Haus" as const,
      stockwerke: ["EG"],
    });
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(AddressFields, {
        title: "Beladestelle",
        value: address,
        onChange: (patch) =>
          setAddress((current) => ({ ...current, ...patch })),
      }),
      React.createElement(
        "output",
        { "data-testid": "selected-floors" },
        address.stockwerke?.join(","),
      ),
    );
  }

  const app = await mount(React.createElement(HouseHarness));
  try {
    assert.ok(
      app.container.querySelector('[aria-label="Stockwerke auswählen"]'),
    );
    for (const floor of ["UG", "EG", "1.OG", "2.OG"]) {
      assert.ok(app.container.querySelector(`[aria-label="${floor}"]`));
    }
    assert.equal(
      app.container.querySelector("label[for]")?.textContent?.includes("Etage"),
      false,
    );
    assert.equal(app.container.querySelectorAll("[role=combobox]").length, 4);

    const upperFloor = app.container.querySelector<HTMLButtonElement>(
      '[aria-label="1.OG"]',
    );
    assert.ok(upperFloor);
    await app.click(upperFloor);
    assert.equal(
      app.container.querySelector('[data-testid="selected-floors"]')
        ?.textContent,
      "EG,1.OG",
    );
  } finally {
    await app.cleanup();
  }
});
