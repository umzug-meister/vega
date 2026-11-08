import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

function worker() {
  const handlers = new Map<string, (event: any) => void>();
  const stored = new Map<string, unknown>();
  const names = new Set(["vega-admin-assets-old", "unrelated"]);
  const requests: Request[] = [];
  let clientUrl = "https://vega.example.test/packings";
  let offline = false;
  let cacheControl = "";
  const cache = {
    match: async (request: Request) => stored.get(request.url),
    put: async (request: Request, response: unknown) => { stored.set(request.url, response); },
  };
  const source = readFileSync(new URL("../src/pwa/service-worker.js", import.meta.url), "utf8")
    .replace("__VEGA_ASSETS__", JSON.stringify(["/assets/admin-AbCd1234.js"]))
    .replace("__VEGA_VERSION__", "current");
  runInNewContext(source, {
    URL, Request, Response, Set,
    self: {
      location: { origin: "https://vega.example.test" },
      registration: { active: {} },
      clients: { get: async () => ({ url: clientUrl }), claim: async () => {} },
      skipWaiting: async () => {},
      addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler),
    },
    caches: {
      keys: async () => [...names],
      delete: async (name: string) => names.delete(name),
      open: async () => cache,
    },
    fetch: async (request: Request) => {
      requests.push(request);
      if (offline) throw new TypeError("network unavailable");
      return { ok: true, type: "basic", redirected: false, headers: new Headers({ "cache-control": cacheControl }), clone() { return this; } };
    },
  });
  function fetchEvent(request: Request | { method: string; mode: string; url: string; headers: Headers }, clientId = "client") {
    let response: Promise<unknown> | undefined;
    handlers.get("fetch")!({ request, clientId, respondWith: (value: Promise<unknown>) => { response = value; } });
    return response;
  }
  return { handlers, stored, names, requests, fetchEvent, setClient: (url: string) => { clientUrl = url; }, setOffline: () => { offline = true; }, setCacheControl: (value: string) => { cacheControl = value; } };
}

test("worker caches only allowlisted admin assets and excludes customer pages and private paths", async () => {
  const app = worker();
  for (const path of ["/api/admin/orders", "/health", "/customer-form/loader.js", "/assets/other-AbCd1234.js"]) {
    assert.equal(app.fetchEvent(new Request(`https://vega.example.test${path}`)), undefined);
  }
  assert.equal(app.fetchEvent(new Request("https://vega.example.test/assets/admin-AbCd1234.js", { method: "POST" })), undefined);
  assert.equal(app.fetchEvent(new Request("https://vega.example.test/assets/admin-AbCd1234.js?v=1")), undefined);
  assert.equal(app.fetchEvent(new Request("https://vega.example.test/assets/admin-AbCd1234.js", { headers: { authorization: "Bearer example" } })), undefined);
  assert.equal(app.fetchEvent(new Request("https://other.example.test/assets/admin-AbCd1234.js")), undefined);
  const asset = new Request("https://vega.example.test/assets/admin-AbCd1234.js");
  app.setClient("https://vega.example.test/customer-form/");
  await app.fetchEvent(asset);
  assert.equal(app.stored.size, 0);
  app.setClient("https://vega.example.test/packings");
  await app.fetchEvent(asset);
  assert.equal(app.stored.size, 1);
  assert.equal(app.requests.at(-1)?.credentials, "omit");
  await app.fetchEvent(asset);
  assert.equal(app.requests.length, 2);
});

test("worker respects private and non-cacheable responses", async () => {
  for (const policy of ["private", "no-store", "no-cache"]) {
    const app = worker();
    app.setCacheControl(policy);
    await app.fetchEvent(new Request("https://vega.example.test/assets/admin-AbCd1234.js"));
    assert.equal(app.stored.size, 0);
  }
});

test("worker returns a non-cached offline page only for admin navigation", async () => {
  const app = worker();
  app.setOffline();
  const request = { method: "GET", mode: "navigate", url: "https://vega.example.test/orders", headers: new Headers() };
  const response = await app.fetchEvent(request) as Response;
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(await response.text(), /Keine Internetverbindung/u);
  assert.equal(app.stored.size, 0);
  assert.equal(app.fetchEvent({ ...request, url: "https://vega.example.test/customer-form/" }), undefined);
});

test("activation removes only obsolete Vega asset caches", async () => {
  const app = worker();
  let pending: Promise<void> | undefined;
  app.handlers.get("activate")!({ waitUntil: (value: Promise<void>) => { pending = value; } });
  await pending;
  assert.equal(app.names.has("vega-admin-assets-old"), false);
  assert.equal(app.names.has("unrelated"), true);
});
