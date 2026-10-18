import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { createCustomerFormRouter } from "../src/customer-form-routes.js";
import {
  isAutocompleteInput,
  isPlaceId,
  isSessionToken,
  projectAddressComponents,
  projectSuggestions,
} from "../src/maps/places-provider.js";
import {
  createRouteRouter,
  routeAddresses,
  routeDistanceKm,
  routeDurationMinutes,
  routeLegs,
} from "../src/maps/route-routes.js";
import { createAdminPlacesRouter } from "../src/maps/admin-places-routes.js";
import { loadConfig } from "../src/config.js";
import { prisma } from "../src/prisma.js";
import { EMPTY_SETTINGS } from "../src/settings/settings-input.js";

const SECRET = "test-only-secret-for-vega-maps-tests-32-chars";
const SESSION = "123e4567-e89b-12d3-a456-426614174000";

function withLog(app: express.Express): void {
  app.use(((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      warn: () => undefined,
      error: () => undefined,
    };
    next();
  }) as express.RequestHandler);
}

async function listen(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

function close(
  server: import("node:net").Server,
  context: import("node:test").TestContext,
): void {
  context.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
}

function mockRateLimit(
  context: import("node:test").TestContext,
  count: number,
): void {
  const model = prisma.publicApiRateLimit;
  const original = model.upsert;
  Reflect.set(model, "upsert", async () => ({ count }));
  context.after(() => {
    Reflect.set(model, "upsert", original);
  });
}

function mockSettings(
  context: import("node:test").TestContext,
  origin: string | null,
): void {
  const model = prisma.appSettings;
  const original = model.findUniqueOrThrow;
  Reflect.set(model, "findUniqueOrThrow", async () => ({
    id: 1,
    ...EMPTY_SETTINGS,
    origin,
  }));
  context.after(() => {
    Reflect.set(model, "findUniqueOrThrow", original);
  });
}

function mockFetch(
  context: import("node:test").TestContext,
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : String(input.url);
    if (
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("http://localhost")
    ) {
      return original(input as never, init as never);
    }
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  context.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

test("places validators accept only bounded inputs and uuid session tokens", () => {
  assert.equal(isAutocompleteInput("Ber"), true);
  assert.equal(isAutocompleteInput("x".repeat(160)), true);
  for (const value of [
    "",
    "ab",
    "x".repeat(161),
    42,
    null,
    undefined,
    {},
    ["Ber"],
  ]) {
    assert.equal(isAutocompleteInput(value), false);
  }
  assert.equal(isSessionToken(SESSION), true);
  for (const value of ["", "not-a-uuid", SESSION.toUpperCase(), 42, null]) {
    assert.equal(isSessionToken(value), false);
  }
  assert.equal(isPlaceId("ChIJN1t_tDeuEmsR9M"), true);
  for (const value of [
    "",
    "x".repeat(201),
    "id with space",
    "id/slash",
    null,
  ]) {
    assert.equal(isPlaceId(value), false);
  }
});

test("places suggestion projection keeps only id/label and caps the list", () => {
  const result = {
    suggestions: [
      {
        placePrediction: {
          placeId: "id-1",
          text: { text: "Berliner Straße 1, 10115 Berlin" },
        },
      },
      {
        placePrediction: {
          placeId: "id-2",
          text: { text: "Berliner Straße 2, 10115 Berlin" },
        },
      },
      { placePrediction: null },
      { placePrediction: { placeId: "", text: { text: "leer" } } },
      { nope: true },
    ],
  };
  assert.deepEqual(projectSuggestions(result), [
    { id: "id-1", label: "Berliner Straße 1, 10115 Berlin" },
    { id: "id-2", label: "Berliner Straße 2, 10115 Berlin" },
  ]);
  const many = {
    suggestions: Array.from({ length: 10 }, (_, index) => ({
      placePrediction: {
        placeId: `id-${index}`,
        text: { text: `Treffer ${index}` },
      },
    })),
  };
  assert.equal(projectSuggestions(many).length, 5);
  assert.deepEqual(projectSuggestions(null), []);
  assert.deepEqual(projectSuggestions({}), []);
});

test("places address projection returns only street, postalCode and city", () => {
  const result = {
    addressComponents: [
      { types: ["route"], longText: "Berliner Straße" },
      { types: ["street_number"], longText: "12" },
      { types: ["postal_code"], longText: "10115" },
      { types: ["locality"], longText: "Berlin" },
      { types: ["country"], longText: "Deutschland" },
    ],
  };
  assert.deepEqual(projectAddressComponents(result), {
    street: "Berliner Straße 12",
    postalCode: "10115",
    city: "Berlin",
  });
  assert.deepEqual(projectAddressComponents({}), {
    street: "",
    postalCode: "",
    city: "",
  });
  assert.deepEqual(Object.keys(projectAddressComponents(result)).sort(), [
    "city",
    "postalCode",
    "street",
  ]);
});

test("route input accepts two to four trimmed stops and the distance rounds to whole km", () => {
  assert.deepEqual(routeAddresses({ addresses: [" Straße 1 ", "Straße 2"] }), [
    "Straße 1",
    "Straße 2",
  ]);
  for (const body of [
    null,
    {},
    { addresses: [] },
    { addresses: ["one"] },
    { addresses: ["one", ""] },
    { addresses: ["one", 2] },
    { addresses: ["a", "b", "c", "d", "e"] },
    { addresses: ["a", "x".repeat(401)] },
  ]) {
    assert.equal(routeAddresses(body), null);
  }
  assert.equal(routeDistanceKm(1499), 1);
  assert.equal(routeDistanceKm(1500), 2);
  assert.equal(routeDistanceKm(0), 0);
  for (const value of [
    undefined,
    null,
    "1500",
    NaN,
    Infinity,
    -1,
    10_000_001,
  ]) {
    assert.equal(routeDistanceKm(value), null);
  }
});

test("route durations parse Google seconds and legs require one entry per segment", () => {
  assert.equal(routeDurationMinutes("0s"), 0);
  assert.equal(routeDurationMinutes("90s"), 2);
  assert.equal(routeDurationMinutes("750s"), 13);
  for (const value of [
    undefined,
    null,
    90,
    "90",
    "soon",
    "-5s",
    "1.5s",
    "120m",
    "99999999999s",
  ]) {
    assert.equal(routeDurationMinutes(value), null);
  }
  assert.deepEqual(
    routeLegs(
      [
        { distanceMeters: 5000, duration: "300s" },
        { distanceMeters: 2500, duration: "180s" },
      ],
      2,
    ),
    [
      { distanceKm: 5, durationMinutes: 5 },
      { distanceKm: 3, durationMinutes: 3 },
    ],
  );
  for (const legs of [
    null,
    [{ distanceMeters: 5000, duration: "300s" }],
    [
      { distanceMeters: 5000, duration: "300s" },
      { distanceMeters: 2500, duration: "soon" },
    ],
    [
      { distanceMeters: -1, duration: "300s" },
      { distanceMeters: 2500, duration: "180s" },
    ],
    [{ distanceMeters: 5000, duration: "300s" }, null],
  ]) {
    assert.equal(routeLegs(legs, 2), null);
  }
});

test("places autocomplete proxies DE/AT suggestions and never leaks the provider key", async (context) => {
  mockRateLimit(context, 1);
  const config = loadConfig({
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_MAPS_API_KEY: "maps-secret-key",
  });
  const app = express();
  withLog(app);
  app.use(express.json());
  app.use("/api/customer-form", createCustomerFormRouter(config));
  const calls = mockFetch(context, async (url, init) => {
    assert.ok(url.includes("places:autocomplete"));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-Goog-Api-Key"), "maps-secret-key");
    assert.equal(
      headers.get("X-Goog-FieldMask"),
      "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
    );
    const body = JSON.parse(String(init?.body)) as {
      includedRegionCodes?: string[];
    };
    assert.deepEqual(body.includedRegionCodes, ["de", "at"]);
    return Response.json({
      suggestions: [
        {
          placePrediction: {
            placeId: "place-1",
            text: { text: "Berliner Straße 1, 10115 Berlin" },
          },
        },
      ],
    });
  });
  const { server, base } = await listen(app);
  close(server, context);

  const response = await fetch(
    `${base}/api/customer-form/places/autocomplete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "Berliner", sessionToken: SESSION }),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = (await response.json()) as { data: unknown };
  assert.deepEqual(payload.data, [
    { id: "place-1", label: "Berliner Straße 1, 10115 Berlin" },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(payload).includes("maps-secret-key"), false);
});

test("places autocomplete maps validation, missing key, provider and network failures safely", async (context) => {
  mockRateLimit(context, 1);
  const config = loadConfig({
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_MAPS_API_KEY: "maps-secret-key",
  });
  const app = express();
  withLog(app);
  app.use(express.json());
  app.use("/api/customer-form", createCustomerFormRouter(config));
  const mode = { current: "ok" };
  mockFetch(context, async () => {
    if (mode.current === "provider-error")
      return new Response("{}", { status: 500 });
    if (mode.current === "network-error") throw new TypeError("fetch failed");
    return Response.json({ suggestions: [] });
  });
  const { server, base } = await listen(app);
  close(server, context);
  const post = (body: unknown) =>
    fetch(`${base}/api/customer-form/places/autocomplete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  assert.equal(
    (await post({ input: "ab", sessionToken: SESSION })).status,
    400,
  );
  assert.equal(
    (await (await post({ input: "ab", sessionToken: SESSION })).json()).error
      .code,
    "INVALID_ADDRESS_QUERY",
  );
  assert.equal(
    (await post({ input: "Berliner", sessionToken: "bad" })).status,
    400,
  );

  mode.current = "provider-error";
  const provider = await post({ input: "Berliner", sessionToken: SESSION });
  assert.equal(provider.status, 502);
  assert.equal((await provider.json()).error.code, "PLACES_PROVIDER_FAILED");

  mode.current = "network-error";
  const network = await post({ input: "Berliner", sessionToken: SESSION });
  assert.equal(network.status, 502);
  assert.equal((await network.json()).error.code, "PLACES_NETWORK_FAILED");

  const withoutKey = express();
  withLog(withoutKey);
  withoutKey.use(express.json());
  withoutKey.use(
    "/api/customer-form",
    createCustomerFormRouter(loadConfig({ BETTER_AUTH_SECRET: SECRET })),
  );
  const second = await listen(withoutKey);
  close(second.server, context);
  const missing = await fetch(
    `${second.base}/api/customer-form/places/autocomplete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "Berliner", sessionToken: SESSION }),
    },
  );
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error.code, "PLACES_UNAVAILABLE");
});

test("places details return only the safe address DTO without provider internals", async (context) => {
  mockRateLimit(context, 1);
  const config = loadConfig({
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_MAPS_API_KEY: "maps-secret-key",
  });
  const app = express();
  withLog(app);
  app.use(express.json());
  app.use("/api/customer-form", createCustomerFormRouter(config));
  mockFetch(context, async (url, init) => {
    assert.ok(url.includes("/v1/places/place-1"));
    assert.ok(!url.includes("maps-secret-key"));
    assert.equal(
      new Headers(init?.headers).get("X-Goog-FieldMask"),
      "addressComponents",
    );
    return Response.json({
      addressComponents: [
        { types: ["route"], longText: "Berliner Straße" },
        { types: ["street_number"], longText: "12" },
        { types: ["postal_code"], longText: "10115" },
        { types: ["locality"], longText: "Berlin" },
        { types: ["country"], longText: "Deutschland" },
        { types: ["plus_code"], longText: "9F4MG9HM+2X" },
      ],
    });
  });
  const { server, base } = await listen(app);
  close(server, context);

  const response = await fetch(`${base}/api/customer-form/places/address`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "place-1", sessionToken: SESSION }),
  });
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { data: Record<string, unknown> };
  assert.deepEqual(payload.data, {
    street: "Berliner Straße 12",
    postalCode: "10115",
    city: "Berlin",
  });
  assert.equal(JSON.stringify(payload).includes("maps-secret-key"), false);
  assert.equal(JSON.stringify(payload).includes("Deutschland"), false);

  const invalid = await fetch(`${base}/api/customer-form/places/address`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "bad id!", sessionToken: SESSION }),
  });
  assert.equal(invalid.status, 400);
});

test("admin places routes proxy autocomplete and address details using only projected data", async (context) => {
  const config = loadConfig({
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_MAPS_API_KEY: "maps-secret-key",
  });
  const app = express();
  withLog(app);
  app.use(express.json());
  app.use("/api/admin/places", createAdminPlacesRouter(config));
  const calls = mockFetch(context, async (url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-Goog-Api-Key"), "maps-secret-key");
    if (url.includes("places:autocomplete")) {
      assert.equal(
        headers.get("X-Goog-FieldMask"),
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
      );
      assert.deepEqual(JSON.parse(String(init?.body)), {
        input: "Peschelanger",
        sessionToken: SESSION,
        includedRegionCodes: ["de", "at", "ch"],
        languageCode: "de",
      });
      return Response.json({
        suggestions: [
          {
            placePrediction: {
              placeId: "place-1",
              text: { text: "Peschelanger 8, München" },
            },
          },
        ],
      });
    }
    assert.ok(url.includes("/v1/places/place-1"));
    assert.ok(url.includes(`sessionToken=${SESSION}`));
    assert.equal(headers.get("X-Goog-FieldMask"), "addressComponents");
    return Response.json({
      addressComponents: [
        { types: ["route"], longText: "Peschelanger" },
        { types: ["street_number"], longText: "8" },
        { types: ["postal_code"], longText: "81735" },
        { types: ["locality"], longText: "München" },
        { types: ["country"], longText: "Deutschland" },
      ],
    });
  });
  const { server, base } = await listen(app);
  close(server, context);

  const autocomplete = await fetch(`${base}/api/admin/places/autocomplete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: "Peschelanger", sessionToken: SESSION }),
  });
  assert.equal(autocomplete.status, 200);
  assert.equal(autocomplete.headers.get("cache-control"), "no-store");
  assert.deepEqual((await autocomplete.json()).data, [
    { id: "place-1", label: "Peschelanger 8, München" },
  ]);

  const address = await fetch(`${base}/api/admin/places/address`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "place-1", sessionToken: SESSION }),
  });
  assert.equal(address.status, 200);
  assert.deepEqual((await address.json()).data, {
    street: "Peschelanger 8",
    postalCode: "81735",
    city: "München",
  });
  assert.equal(calls.length, 2);
});

test("admin places routes validate input and report missing provider configuration", async (context) => {
  const app = express();
  withLog(app);
  app.use(express.json());
  app.use(
    "/api/admin/places",
    createAdminPlacesRouter(loadConfig({ BETTER_AUTH_SECRET: SECRET })),
  );
  const { server, base } = await listen(app);
  close(server, context);
  const post = (path: string, body: unknown) =>
    fetch(`${base}/api/admin/places/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const unavailable = await post("autocomplete", {
    input: "Peschelanger",
    sessionToken: SESSION,
  });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error.code, "PLACES_UNAVAILABLE");

  const configuredApp = express();
  withLog(configuredApp);
  configuredApp.use(express.json());
  configuredApp.use(
    "/api/admin/places",
    createAdminPlacesRouter(
      loadConfig({
        BETTER_AUTH_SECRET: SECRET,
        GOOGLE_MAPS_API_KEY: "maps-secret-key",
      }),
    ),
  );
  const configured = await listen(configuredApp);
  close(configured.server, context);
  const invalid = await fetch(
    `${configured.base}/api/admin/places/autocomplete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "ab", sessionToken: SESSION }),
    },
  );
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "INVALID_ADDRESS_QUERY");
});

test("places proxy is rate-limited and never caches session responses", async (context) => {
  mockRateLimit(context, 121);
  const config = loadConfig({
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_MAPS_API_KEY: "maps-secret-key",
  });
  const app = express();
  withLog(app);
  app.use(express.json());
  app.use("/api/customer-form", createCustomerFormRouter(config));
  mockFetch(context, async () => Response.json({ suggestions: [] }));
  const { server, base } = await listen(app);
  close(server, context);

  const response = await fetch(
    `${base}/api/customer-form/places/autocomplete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "Berliner", sessionToken: SESSION }),
    },
  );
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, "RATE_LIMITED");
});

test("admin route calculation uses the depot round trip and rounds the provider distance", async (context) => {
  mockRateLimit(context, 1);
  mockSettings(context, "Betrieb Teststraße 1, 80331 München");
  const config = loadConfig({
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_MAPS_API_KEY: "maps-secret-key",
  });
  const app = express();
  withLog(app);
  app.use(express.json());
  app.use(((req, res, next) => {
    res.locals.staffUser = { id: "staff-1" };
    next();
  }) as express.RequestHandler);
  app.use("/api/admin/routes", createRouteRouter(config));
  const calls = mockFetch(context, async (url, init) => {
    assert.ok(url.includes("computeRoutes"));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-Goog-Api-Key"), "maps-secret-key");
    assert.equal(
      headers.get("X-Goog-FieldMask"),
      "routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.duration",
    );
    const body = JSON.parse(String(init?.body)) as {
      origin: { address: string };
      destination: { address: string };
      intermediates: Array<{ address: string }>;
    };
    assert.equal(body.origin.address, "Betrieb Teststraße 1, 80331 München");
    assert.equal(
      body.destination.address,
      "Betrieb Teststraße 1, 80331 München",
    );
    assert.deepEqual(
      body.intermediates.map((entry) => entry.address),
      ["A-Straße 1", "B-Straße 2"],
    );
    return Response.json({
      routes: [
        {
          distanceMeters: 12_499,
          duration: "750s",
          legs: [
            { distanceMeters: 5000, duration: "300s" },
            { distanceMeters: 4999, duration: "270s" },
            { distanceMeters: 2500, duration: "180s" },
          ],
        },
      ],
    });
  });
  const { server, base } = await listen(app);
  close(server, context);

  const response = await fetch(`${base}/api/admin/routes/distance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addresses: ["A-Straße 1", "B-Straße 2"] }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      distanceKm: 12,
      durationMinutes: 13,
      legs: [
        { distanceKm: 5, durationMinutes: 5 },
        { distanceKm: 5, durationMinutes: 5 },
        { distanceKm: 3, durationMinutes: 3 },
      ],
    },
  });
  assert.equal(calls.length, 1);

  const configResponse = await fetch(`${base}/api/admin/routes/config`);
  assert.equal(configResponse.status, 200);
  assert.deepEqual(await configResponse.json(), {
    data: { origin: "Betrieb Teststraße 1, 80331 München", available: true },
  });
});

test("admin route calculation inserts a zero leg for identical consecutive pickup and dropoff addresses", async (context) => {
  mockRateLimit(context, 1);
  mockSettings(context, "Betrieb Teststraße 1, 80331 München");
  const config = loadConfig({
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_MAPS_API_KEY: "maps-secret-key",
  });
  const app = express();
  withLog(app);
  app.use(express.json());
  app.use(((req, res, next) => {
    res.locals.staffUser = { id: "staff-1" };
    next();
  }) as express.RequestHandler);
  app.use("/api/admin/routes", createRouteRouter(config));
  let providerCalls = 0;
  mockFetch(context, async (_url, init) => {
    providerCalls++;
    const body = JSON.parse(String(init?.body)) as {
      origin: { address: string };
      destination: { address: string };
      intermediates?: Array<{ address: string }>;
    };
    assert.equal(body.origin.address, "Betrieb Teststraße 1, 80331 München");
    assert.equal(
      body.destination.address,
      "Betrieb Teststraße 1, 80331 München",
    );
    assert.deepEqual(
      body.intermediates?.map(({ address }) => address),
      ["Gleiche Adresse 1, 80333 München"],
    );
    return Response.json({
      routes: [
        {
          distanceMeters: 9000,
          duration: "900s",
          legs: [
            { distanceMeters: 5000, duration: "480s" },
            { distanceMeters: 4000, duration: "420s" },
          ],
        },
      ],
    });
  });
  const { server, base } = await listen(app);
  close(server, context);

  const response = await fetch(`${base}/api/admin/routes/distance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      addresses: [
        "Gleiche Adresse 1, 80333 München",
        " gleiche   adresse 1, 80333 münchen ",
      ],
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    distanceKm: 9,
    durationMinutes: 15,
    legs: [
      { distanceKm: 5, durationMinutes: 8 },
      { distanceKm: 0, durationMinutes: 0 },
      { distanceKm: 4, durationMinutes: 7 },
    ],
  });
  assert.equal(providerCalls, 1);
});

test("admin route calculation returns zero legs without calling Google when every stop is the depot", async (context) => {
  mockRateLimit(context, 1);
  mockSettings(context, "Depot 1, 80331 München");
  const config = loadConfig({
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_MAPS_API_KEY: "maps-secret-key",
  });
  const app = express();
  withLog(app);
  app.use(express.json());
  app.use(((req, res, next) => {
    res.locals.staffUser = { id: "staff-1" };
    next();
  }) as express.RequestHandler);
  app.use("/api/admin/routes", createRouteRouter(config));
  let providerCalls = 0;
  mockFetch(context, async () => {
    providerCalls++;
    return Response.json({ routes: [] });
  });
  const { server, base } = await listen(app);
  close(server, context);

  const response = await fetch(`${base}/api/admin/routes/distance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      addresses: ["Depot 1, 80331 München", " depot 1, 80331 münchen "],
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    distanceKm: 0,
    durationMinutes: 0,
    legs: [
      { distanceKm: 0, durationMinutes: 0 },
      { distanceKm: 0, durationMinutes: 0 },
      { distanceKm: 0, durationMinutes: 0 },
    ],
  });
  assert.equal(providerCalls, 0);
});

test("admin route calculation rejects bad stops, missing setup and unusable provider answers", async (context) => {
  mockRateLimit(context, 1);
  mockSettings(context, "Betrieb Teststraße 1, 80331 München");
  const config = loadConfig({
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_MAPS_API_KEY: "maps-secret-key",
  });
  const app = express();
  withLog(app);
  app.use(express.json());
  app.use(((req, res, next) => {
    res.locals.staffUser = { id: "staff-1" };
    next();
  }) as express.RequestHandler);
  app.use("/api/admin/routes", createRouteRouter(config));
  const mode = { current: "ok" };
  const validRoute = () =>
    Response.json({
      routes: [
        {
          distanceMeters: 1000,
          duration: "120s",
          legs: [
            { distanceMeters: 400, duration: "60s" },
            { distanceMeters: 300, duration: "30s" },
            { distanceMeters: 300, duration: "30s" },
          ],
        },
      ],
    });
  mockFetch(context, async () => {
    if (mode.current === "provider-error")
      return new Response("{}", { status: 500 });
    if (mode.current === "empty") return Response.json({ routes: [] });
    if (mode.current === "invalid")
      return Response.json({ routes: [{ distanceMeters: -5 }] });
    if (mode.current === "bad-duration")
      return Response.json({
        routes: [
          {
            distanceMeters: 1000,
            duration: "soon",
            legs: [
              { distanceMeters: 400, duration: "60s" },
              { distanceMeters: 300, duration: "30s" },
              { distanceMeters: 300, duration: "30s" },
            ],
          },
        ],
      });
    if (mode.current === "bad-legs")
      return Response.json({
        routes: [
          {
            distanceMeters: 1000,
            duration: "120s",
            legs: [{ distanceMeters: 1000, duration: "120s" }],
          },
        ],
      });
    return validRoute();
  });
  const { server, base } = await listen(app);
  close(server, context);
  const post = (body: unknown) =>
    fetch(`${base}/api/admin/routes/distance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  assert.equal((await post({ addresses: ["only-one"] })).status, 400);
  assert.equal(
    (await (await post({ addresses: ["only-one"] })).json()).error.code,
    "INVALID_ROUTE",
  );

  mode.current = "provider-error";
  const provider = await post({ addresses: ["A", "B"] });
  assert.equal(provider.status, 502);
  assert.equal((await provider.json()).error.code, "ROUTES_PROVIDER_FAILED");

  mode.current = "empty";
  assert.equal(
    (await (await post({ addresses: ["A", "B"] })).json()).error.code,
    "INVALID_ROUTE_RESPONSE",
  );

  mode.current = "invalid";
  assert.equal(
    (await (await post({ addresses: ["A", "B"] })).json()).error.code,
    "INVALID_ROUTE_RESPONSE",
  );

  mode.current = "bad-duration";
  assert.equal(
    (await (await post({ addresses: ["A", "B"] })).json()).error.code,
    "INVALID_ROUTE_RESPONSE",
  );

  mode.current = "bad-legs";
  assert.equal(
    (await (await post({ addresses: ["A", "B"] })).json()).error.code,
    "INVALID_ROUTE_RESPONSE",
  );

  const unavailable = express();
  withLog(unavailable);
  unavailable.use(express.json());
  unavailable.use(((req, res, next) => {
    res.locals.staffUser = { id: "staff-1" };
    next();
  }) as express.RequestHandler);
  unavailable.use(
    "/api/admin/routes",
    createRouteRouter(loadConfig({ BETTER_AUTH_SECRET: SECRET })),
  );
  const second = await listen(unavailable);
  close(second.server, context);
  const missing = await fetch(`${second.base}/api/admin/routes/distance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addresses: ["A-Straße 1", "B-Straße 2"] }),
  });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error.code, "ROUTES_UNAVAILABLE");
  const missingBody = await missing.text().catch(() => "");
  assert.equal(missingBody.includes("maps-secret-key"), false);
});
