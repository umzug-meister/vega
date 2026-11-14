import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_SETTINGS, validateInvoiceSequence, validateSettings } from "../src/settings/settings-input.js";
import { customerFormSettings } from "../src/settings/settings-service.js";
import { loadConfig } from "../src/config.js";
import { routeAddresses } from "../src/maps/route-routes.js";
import { once } from "node:events";
import express from "express";
import { createSettingsRouter } from "../src/settings/settings-routes.js";

test("settings are explicitly unconfigured without dummy values", () => {
  const result = validateSettings(EMPTY_SETTINGS);
  assert.equal(result.ok, true);
  assert.ok(Object.entries(EMPTY_SETTINGS).filter(([key]) => key !== "revision").every(([, value]) => value === null));
});
test("all six legacy options and the three approved mail settings round-trip with validation", () => {
  const settings = {
    ...EMPTY_SETTINGS, boxCbm: 0.125, kleiderboxCbm: 0.5, origin: "Betrieb Teststraße 1, 80331 München",
    dataPrivacyUrl: "https://example.test/privacy", successUrl: "https://example.test/thanks",
    boxCalculatorUrl: "https://example.test/boxes", companyEmail: "company@example.test",
    emailFromName: "Testbetrieb", emailFromAddress: "mailbox@example.test",
  };
  const result = validateSettings(settings);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, settings);
});
test("settings reject malformed prices, credential URLs, email headers, missing revisions and unknown secrets", () => {
  for (const patch of [
    { boxCbm: 0 }, { boxCbm: -1 }, { boxCbm: 11 }, { boxCbm: "1" }, { boxCbm: 0.12345 },
    { dataPrivacyUrl: "javascript:alert(1)" }, { dataPrivacyUrl: "https://user:password@example.test" },
    { emailFromName: "Sender\nBcc: someone@example.test" }, { companyEmail: "invalid" },
    { GOOGLE_MAPS_API_KEY: "not-approved" }, { toString: "not-approved" }, { constructor: "not-approved" },
    { revision: -1 }, { origin: "x".repeat(301) },
  ]) assert.equal(validateSettings({ ...EMPTY_SETTINGS, ...patch }).ok, false, JSON.stringify(patch));
  assert.equal(validateSettings({}).ok, false);
});
test("invoice sequence accepts only bounded positive integers and rejects malformed request bodies", () => {
  assert.deepEqual(validateInvoiceSequence({ nextValue: 2_147_483_646, expectedNextValue: 1 }), { nextValue: 2_147_483_646, expectedNextValue: 1 });
  for (const value of [undefined, null, [], {}, { nextValue: 1 }, { nextValue: 1, expectedNextValue: 1, extra: true }]) {
    assert.equal(validateInvoiceSequence(value), null);
  }
  for (const value of [0, -1, 1.5, 2_147_483_647, Number.MAX_SAFE_INTEGER, NaN, Infinity, "1", null]) {
    assert.equal(validateInvoiceSequence({ nextValue: value, expectedNextValue: 1 }), null);
    assert.equal(validateInvoiceSequence({ nextValue: 1, expectedNextValue: value }), null);
  }
});
test("public config is an explicit allowlist and never exposes internal settings or provider keys", () => {
  const config = loadConfig({ BETTER_AUTH_SECRET: "test-only-secret-32-characters-long", GOOGLE_MAPS_API_KEY: "maps-test-key", GCS_BUCKET: "test-bucket" });
  const publicConfig = customerFormSettings({ ...EMPTY_SETTINGS, companyEmail: "internal@example.test", origin: "Private depot", emailFromAddress: "mailbox@example.test" }, config);
  assert.deepEqual(Object.keys(publicConfig).sort(), ["boxCalculatorUrl", "boxVolume", "placesAvailable", "privacyUrl", "successUrl", "uploadsAvailable", "wardrobeBoxVolume"]);
  assert.equal(publicConfig.privacyUrl, null);
  assert.equal(publicConfig.uploadsAvailable, true);
  assert.equal(JSON.stringify(publicConfig).includes("internal@example.test"), false);
  assert.equal(JSON.stringify(publicConfig).includes("maps-test-key"), false);
});
test("route input only accepts the two to four business stops, never a client-selected depot", () => {
  assert.deepEqual(routeAddresses({ addresses: [" Straße 1 ", "Straße 2"] }), ["Straße 1", "Straße 2"]);
  assert.deepEqual(routeAddresses({ addresses: ["one"] }), ["one"]);
  for (const body of [null, { addresses: [] }, { addresses: ["one", ""] }, { addresses: ["one", 2] }, { addresses: ["a", "b", "c", "d", "e"] }]) {
    assert.equal(routeAddresses(body), null);
  }
});

test("settings router rejects absent invoice bodies and untrusted write origins before database access", async (context) => {
  const config = loadConfig({
    NODE_ENV: "test", BETTER_AUTH_SECRET: "test-only-secret-32-characters-long",
    BETTER_AUTH_TRUSTED_ORIGINS: "https://admin.example.test",
  });
  const app = express();
  app.use(express.json());
  app.use("/settings", createSettingsRouter(config));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/settings`;
  const absent = await fetch(`${base}/invoice-number`, { method: "PUT" });
  assert.equal(absent.status, 400);
  assert.equal((await absent.json()).error.code, "INVALID_INVOICE_SEQUENCE");
  const denied = await fetch(base, {
    method: "PUT", headers: { "Content-Type": "application/json", Origin: "https://untrusted.example.test" },
    body: JSON.stringify(EMPTY_SETTINGS),
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, "INVALID_ORIGIN");
});
