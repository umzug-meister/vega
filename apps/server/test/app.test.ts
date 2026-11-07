import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { prisma } from "../src/prisma.js";
import { EMPTY_SETTINGS } from "../src/settings/settings-input.js";

test("healthcheck has security/request-id headers and obeys the CORS allowlist", async (context) => {
  const app = createApp(loadConfig({
    NODE_ENV: "test",
    BETTER_AUTH_SECRET: "test-only-secret-for-vega-auth-tests-32-chars",
    CORS_ALLOWED_ORIGINS: "https://www.example.test",
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
    headers: { Origin: "https://www.example.test" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "vega" });
  assert.equal(response.headers.get("access-control-allow-origin"), "https://www.example.test");
  assert.ok(response.headers.get("x-request-id"));
  const contentSecurityPolicy = response.headers.get("content-security-policy");
  assert.ok(contentSecurityPolicy);
  assert.match(contentSecurityPolicy, /img-src[^;]*https:/u);

  const deniedResponse = await fetch(`http://127.0.0.1:${address.port}/health`, {
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(deniedResponse.status, 200);
  assert.equal(deniedResponse.headers.get("access-control-allow-origin"), null);
});

test("Better Auth is mounted and protected admin APIs reject anonymous requests", async (context) => {
  const app = createApp(loadConfig({
    NODE_ENV: "test",
    BETTER_AUTH_SECRET: "test-only-secret-for-vega-auth-tests-32-chars",
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:3000,http://localhost:5173",
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const authHealth = await fetch(`${baseUrl}/api/auth/ok`);
  assert.equal(authHealth.status, 200);

  const adminSession = await fetch(`${baseUrl}/api/admin/session`);
  assert.equal(adminSession.status, 401);

  const root = await fetch(baseUrl, { redirect: "manual" });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/login");

  const unknownPage = await fetch(`${baseUrl}/this-path-does-not-exist`, {
    headers: { Accept: "text/html" },
    redirect: "manual",
  });
  assert.equal(unknownPage.status, 404);

  const protectedApi = await fetch(`${baseUrl}/api/admin/future`);
  assert.equal(protectedApi.status, 401);

  const protectedOrders = await fetch(`${baseUrl}/api/admin/orders`);
  assert.equal(protectedOrders.status, 401);
  const protectedOrderPdf = await fetch(`${baseUrl}/api/admin/orders/1000/pdf`);
  assert.equal(protectedOrderPdf.status, 401);
  const protectedPricingPreview = await fetch(`${baseUrl}/api/admin/orders/pricing-preview`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
  });
  assert.equal(protectedPricingPreview.status, 401);

  const protectedInvoices = await fetch(`${baseUrl}/api/admin/invoices`);
  assert.equal(protectedInvoices.status, 401);
  const protectedInvoicePreview = await fetch(`${baseUrl}/api/admin/invoices/next-number`);
  assert.equal(protectedInvoicePreview.status, 401);
  const protectedSettings = await fetch(`${baseUrl}/api/admin/settings`);
  assert.equal(protectedSettings.status, 401);
  const protectedNumber = await fetch(`${baseUrl}/api/admin/settings/invoice-number`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nextValue: 100, expectedNextValue: 1 }),
  });
  assert.equal(protectedNumber.status, 401);
  const protectedRoutes = await fetch(`${baseUrl}/api/admin/routes/config`);
  assert.equal(protectedRoutes.status, 401);
  const protectedPlaces = await fetch(`${baseUrl}/api/admin/places/autocomplete`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: "Peschelanger", sessionToken: "123e4567-e89b-12d3-a456-426614174000" }),
  });
  assert.equal(protectedPlaces.status, 401);
  const protectedImages = await fetch(`${baseUrl}/api/admin/orders/1000/images`);
  assert.equal(protectedImages.status, 401);
  const unavailableUpload = await fetch(`${baseUrl}/api/public/uploads`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ size: 100, contentType: "image/jpeg" }),
  });
  assert.equal(unavailableUpload.status, 503);
  const publicOrderRead = await fetch(`${baseUrl}/api/public/orders/1000`);
  assert.equal(publicOrderRead.status, 404);

  const protectedCatalogWrite = await fetch(`${baseUrl}/api/admin/catalog/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Not allowed", sort: 0 }),
  });
  assert.equal(protectedCatalogWrite.status, 401);

  const signup = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Public", email: "public@example.test", password: "not-a-real-password" }),
  });
  assert.notEqual(signup.status, 200);
});

test("both anonymous order aliases require configured privacy before creating an order", async (context) => {
  const settingsModel = prisma.appSettings;
  const rateModel = prisma.publicApiRateLimit;
  const originalRead = settingsModel.findUniqueOrThrow;
  const originalLimit = rateModel.upsert;
  const originalTransaction = prisma.$transaction;
  let settingsReads = 0;
  Reflect.set(settingsModel, "findUniqueOrThrow", async () => {
    settingsReads++;
    return { id: 1, ...EMPTY_SETTINGS };
  });
  Reflect.set(rateModel, "upsert", async () => ({ count: 1 }));
  Reflect.set(prisma, "$transaction", async () => { throw new Error("Order creation must not be reached"); });
  context.after(() => {
    Reflect.set(settingsModel, "findUniqueOrThrow", originalRead);
    Reflect.set(rateModel, "upsert", originalLimit);
    Reflect.set(prisma, "$transaction", originalTransaction);
  });
  const app = createApp(loadConfig({
    NODE_ENV: "test", BETTER_AUTH_SECRET: "test-only-secret-for-vega-auth-tests-32-chars",
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const input = {
    customer: { firstName: "Test", lastName: "Kunde", phone: "089123456", email: "customer@example.test" },
    from: { street: "Teststrasse 1", postalCode: "80331", city: "Muenchen" },
    to: { street: "Teststrasse 2", postalCode: "80331", city: "Muenchen" },
    movingDate: "2026-10-12",
  };
  for (const path of ["/api/public/orders", "/api/orders"]) {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "CUSTOMER_FORM_NOT_CONFIGURED");
  }
  assert.equal(settingsReads, 2);
});
