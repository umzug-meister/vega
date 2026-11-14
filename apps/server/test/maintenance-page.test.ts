import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Storage } from "@google-cloud/storage";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth-config.js";
import { loadConfig } from "../src/config.js";
import { GeminiError, type GeminiClient } from "../src/inbox/gemini-client.js";
import { prisma } from "../src/prisma.js";
import { runSetupSmokeTest, setupInfo } from "../src/maintenance/maintenance-service.js";

const env = {
  NODE_ENV: "test", BETTER_AUTH_SECRET: "synthetic-setup-test-secret-more-than-32",
  APP_BASE_URL: "https://runtime.example.test",
  BETTER_AUTH_TRUSTED_ORIGINS: "https://admin.example.test",
};
const providers = {
  ...env, HOSTINGER_MAIL_API_TOKEN: "synthetic-mail-token", HOSTINGER_MAILBOX_RESOURCE_ID: "synthetic-mailbox",
  GOOGLE_MAPS_API_KEY: "synthetic-google-key", GCS_BUCKET: "synthetic-bucket",
};
const quota = { data: { quotas: [], supported: true, totalUsage: 0, totalLimit: 100, totalPercentage: 0 } };
const bucketMetadata = {
  location: "EU", iamConfiguration: { publicAccessPrevention: "enforced", uniformBucketLevelAccess: { enabled: true } },
  lifecycle: { rule: [{ action: { type: "Delete" }, condition: { age: 180 } }] },
};

function mockDatabase(context: TestContext, query: (sql: TemplateStringsArray) => Promise<unknown>) {
  const original = prisma.$queryRaw;
  Reflect.set(prisma, "$queryRaw", query);
  context.after(() => { Reflect.set(prisma, "$queryRaw", original); });
}

async function buildFixture(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "vega-setup-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, ".vite"));
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, ".vite/manifest.json"), JSON.stringify({ "index.html": { isEntry: true, file: "assets/app.js", css: ["assets/app.css"] } }));
  await writeFile(join(directory, "assets/app.js"), "// fixture");
  await writeFile(join(directory, "assets/app.css"), "/* fixture */");
  return directory;
}

test("setup info uses runtime URL and projects only allowlisted variable names and presence", () => {
  const configured = {
    ...providers,
    DATABASE_URL: "mysql://private",
    INITIAL_ADMIN_PASSWORD: "synthetic-bootstrap",
    GOOGLE_CLOUD_PROJECT: "synthetic-gcp-project",
    GEMINI_ENABLED: "true",
    GEMINI_LOCATION: "europe-west3",
    GEMINI_MODEL: "synthetic-gemini-model",
    UNRELATED_SECRET: "do-not-expose",
  };
  const info = setupInfo(loadConfig(configured), configured);
  assert.equal(info.loaderUrl, "https://runtime.example.test/customer-form/loader.js");
  assert.equal(info.embedCode, '<script src="https://runtime.example.test/customer-form/loader.js" defer></script>');
  assert.equal(info.variables.find((item) => item.name === "DATABASE_URL")?.status, "set");
  assert.equal(info.variables.find((item) => item.name === "GOOGLE_APPLICATION_CREDENTIALS")?.requirement, "optional");
  assert.equal(info.variables.find((item) => item.name === "GOOGLE_CLOUD_PROJECT")?.group, "Google Cloud");
  assert.equal(info.variables.find((item) => item.name === "GEMINI_ENABLED")?.status, "set");
  assert.equal(info.variables.find((item) => item.name === "GEMINI_LOCATION")?.status, "set");
  assert.equal(info.variables.find((item) => item.name === "GEMINI_MODEL")?.status, "set");
  assert.equal(info.variables.find((item) => item.name === "BETTER_AUTH_URL")?.status, "default");
  assert.equal(info.variables.find((item) => item.name === "INITIAL_ADMIN_PASSWORD")?.requirement, "bootstrap");
  const serialized = JSON.stringify(info);
  for (const secret of ["mysql://private", "synthetic-bootstrap", "synthetic-mail-token", "synthetic-mailbox", "synthetic-google-key", "synthetic-bucket", "synthetic-gcp-project", "europe-west3", "synthetic-gemini-model", "UNRELATED_SECRET", "do-not-expose"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  const minimal = setupInfo(loadConfig(env), env);
  assert.equal(minimal.variables.find((item) => item.name === "CORS_ALLOWED_ORIGINS")?.status, "missing");
  assert.equal(minimal.variables.find((item) => item.name === "GOOGLE_MAPS_API_KEY")?.requirement, "optional");
  assert.equal(minimal.variables.find((item) => item.name === "GEMINI_ENABLED")?.status, "missing");
  assert.equal(minimal.variables.find((item) => item.name === "GEMINI_LOCATION")?.status, "default");
  assert.equal(minimal.variables.find((item) => item.name === "GEMINI_MODEL")?.status, "default");
});

test("smoke test checks SQL, build, mailbox quota, Google APIs, Gemini and bucket policy without writes", async (context) => {
  const directory = await buildFixture(context);
  mockDatabase(context, async (query) => {
    assert.equal(query.join(""), "SELECT 1 AS ok");
    return [{ ok: 1 }];
  });
  context.mock.method(Storage.prototype, "bucket", (name: string) => {
    assert.equal(name, "synthetic-bucket");
    return { getMetadata: async () => [bucketMetadata] };
  });
  const calls: string[] = [];
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.ok(init.signal);
    assert.equal(init.redirect, "error");
    const headers = new Headers(init.headers);
    if (url.includes("api.mail.hostinger.com")) {
      assert.equal(init.method, undefined);
      assert.equal(headers.get("authorization"), "Bearer synthetic-mail-token");
      assert.ok(url.endsWith("/api/v1/mailboxes/synthetic-mailbox/quota"));
      return Response.json(quota);
    }
    assert.equal(init.method, "POST");
    assert.equal(headers.get("x-goog-api-key"), "synthetic-google-key");
    assert.equal(String(init.body).includes("runtime.example.test"), false);
    return Response.json(url.includes("places.googleapis.com")
      ? { suggestions: [{ placePrediction: { placeId: "test-place" } }] }
      : { routes: [{ distanceMeters: 2000 }] });
  });
  const geminiClient: GeminiClient = {
    async generateJson(request, signal) {
      assert.equal(request.systemInstruction, "Return only the requested JSON object.");
      assert.deepEqual(request.parts, [{ text: 'Return {"ok":true}.' }]);
      assert.ok(signal);
      return { ok: true };
    },
  };
  const config = loadConfig({ ...providers, GOOGLE_CLOUD_PROJECT: "synthetic-gcp-project", GEMINI_ENABLED: "true" });
  const result = await runSetupSmokeTest(config, directory, AbortSignal.timeout(1000), geminiClient);
  assert.equal(result.checks.length, 7);
  assert.ok(result.checks.every((check) => check.status === "ok"), JSON.stringify(result));
  assert.equal(result.checks.find((check) => check.id === "gemini")?.message, "Vertex AI hat den synthetischen Testprompt beantwortet. Keine Maildaten gesendet.");
  assert.equal(calls.length, 3);
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
});

test("missing providers are skipped and a missing referenced build asset fails", async (context) => {
  const directory = await buildFixture(context);
  await rm(join(directory, "assets/app.css"));
  mockDatabase(context, async () => [{ ok: 1 }]);
  context.mock.method(globalThis, "fetch", async () => { throw new Error("No external request expected"); });
  const result = await runSetupSmokeTest(loadConfig(env), directory, AbortSignal.timeout(1000));
  assert.equal(result.checks.find((check) => check.id === "database")?.status, "ok");
  assert.equal(result.checks.find((check) => check.id === "customer-form")?.status, "error");
  assert.ok(result.checks.slice(2).every((check) => check.status === "skipped"));
});

test("provider failures are isolated and never expose messages, tokens or raw responses", async (context) => {
  const directory = await buildFixture(context);
  mockDatabase(context, async () => { throw new Error("mysql://secret@private"); });
  context.mock.method(Storage.prototype, "bucket", () => ({ getMetadata: async () => [{ ...bucketMetadata, location: "US" }] }));
  context.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("api.mail.hostinger.com")) return Response.json({ code: "ERR_FORBIDDEN", error: "synthetic-mail-token" }, { status: 403 });
    if (url.includes("places.googleapis.com")) throw new TypeError("synthetic-google-key");
    return Response.json({ error: { message: "secret-provider-body" } }, { status: 403 });
  });
  const geminiClient: GeminiClient = {
    async generateJson() { throw new GeminiError("GEMINI_AUTH_FAILED"); },
  };
  const config = loadConfig({ ...providers, GOOGLE_CLOUD_PROJECT: "synthetic-gcp-project", GEMINI_ENABLED: "true" });
  const result = await runSetupSmokeTest(config, directory, AbortSignal.timeout(1000), geminiClient);
  assert.equal(result.checks.filter((check) => check.status === "error").length, 6);
  assert.match(result.checks.find((check) => check.id === "mail")!.message, /nicht berechtigt/u);
  assert.match(result.checks.find((check) => check.id === "gemini")!.message, /Service-Account oder ADC prüfen/u);
  assert.match(result.checks.find((check) => check.id === "gcs")!.message, /EU-Konfiguration/u);
  for (const secret of ["mysql://secret", "synthetic-mail-token", "synthetic-google-key", "secret-provider-body"]) assert.equal(JSON.stringify(result).includes(secret), false);
});

test("malformed success payloads do not produce successful provider checks", async (context) => {
  const directory = await buildFixture(context);
  mockDatabase(context, async () => [{ ok: 1 }]);
  context.mock.method(globalThis, "fetch", async () => Response.json({ data: {}, routes: [], suggestions: [] }));
  const result = await runSetupSmokeTest(loadConfig({ ...providers, GCS_BUCKET: "" }), directory, AbortSignal.timeout(1000));
  assert.ok(result.checks.filter((check) => ["mail", "places", "routes"].includes(check.id)).every((check) => check.status === "error"));
});

test("deadline bounds even an unresponsive database probe", async (context) => {
  const directory = await buildFixture(context);
  mockDatabase(context, () => new Promise(() => {}));
  const controller = new AbortController();
  const pending = runSetupSmokeTest(loadConfig(env), directory, controller.signal);
  controller.abort();
  const result = await pending;
  assert.equal(result.checks.find((check) => check.id === "database")?.status, "error");
});

test("setup API rejects anonymous, advisor, blocked and incomplete admins before probes; valid admins get no-store info and origin/rate guards", async (context) => {
  const config = loadConfig(env);
  const auth = createAuth(config);
  let user: { role: string; blocked: boolean; mustChangePassword: boolean; twoFactorEnabled: boolean } | null = null;
  context.mock.method(auth.api, "getSession", async () => user ? { user: { id: "setup-admin", ...user }, session: {} } : null);
  let queries = 0;
  mockDatabase(context, async () => { queries++; return [{ ok: 1 }]; });
  const app = createApp(config, { auth, logStream: { write() {} } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/admin/maintenance`;
  const valid = { role: "Admin", blocked: false, mustChangePassword: false, twoFactorEnabled: true };
  for (const candidate of [null, { ...valid, role: "Kundenberater" }, { ...valid, blocked: true }, { ...valid, mustChangePassword: true }, { ...valid, twoFactorEnabled: false }]) {
    user = candidate;
    for (const [path, method] of [["", "GET"], ["/smoke-test", "POST"]]) {
      assert.equal((await fetch(`${base}${path}`, { method })).status, candidate ? 403 : 401);
    }
  }
  assert.equal(queries, 0);
  user = valid;
  const info = await fetch(base);
  assert.equal(info.status, 200);
  assert.equal(info.headers.get("cache-control"), "no-store");
  assert.equal((await info.json()).data.loaderUrl, "https://runtime.example.test/customer-form/loader.js");
  const denied = await fetch(`${base}/smoke-test`, { method: "POST", headers: { Origin: "https://untrusted.example.test" } });
  assert.equal(denied.status, 403);
  assert.equal(queries, 0);
  for (let index = 0; index < 2; index++) {
    const result = await fetch(`${base}/smoke-test`, { method: "POST", headers: { Origin: "https://admin.example.test" } });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal((await result.json()).data.checks.length, 7);
  }
  assert.equal((await fetch(`${base}/smoke-test`, { method: "POST" })).status, 429);
  assert.equal(queries, 2);
});
