const ASSETS = new Set(__VEGA_ASSETS__);
const CACHE = "vega-admin-assets-__VEGA_VERSION__";
const PREFIX = "vega-admin-assets-";

self.addEventListener("install", (event) => {
  if (!self.registration.active) event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method === "GET" && request.mode === "navigate" &&
      url.origin === self.location.origin &&
      !/^\/(?:customer-form|api|health)(?:\/|$)/.test(url.pathname)) {
    event.respondWith(fetch(request).catch(() => new Response(
      '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vega offline</title></head><body><main><h1>Keine Internetverbindung</h1><p>Vega benötigt eine Internetverbindung. Bitte verbinden Sie sich und laden Sie die Seite erneut.</p></main></body></html>',
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
    )));
    return;
  }
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      url.search || request.headers.has("authorization") || !ASSETS.has(url.pathname)) return;
  event.respondWith((async () => {
    const client = event.clientId ? await self.clients.get(event.clientId) : null;
    if (!client || new URL(client.url).origin !== self.location.origin ||
        /^\/customer-form(?:\/|$)/.test(new URL(client.url).pathname)) {
      return fetch(request);
    }
    let cache;
    try {
      cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
    } catch {
      console.warn("Vega asset cache could not be read.");
    }
    const response = await fetch(new Request(request, { credentials: "omit" }));
    const policy = response.headers.get("cache-control") ?? "";
    if (response.ok && response.type === "basic" && !response.redirected &&
        !/\b(?:private|no-store|no-cache)\b/i.test(policy)) {
      try {
        await cache?.put(request, response.clone());
      } catch {
        console.warn("Vega asset could not be cached.");
      }
    }
    return response;
  })());
});
