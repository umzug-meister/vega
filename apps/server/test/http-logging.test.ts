import assert from "node:assert/strict";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { prisma } from "../src/prisma.js";

async function httpFixture(context: TestContext) {
  const logs: string[] = [];
  const app = createApp(
    loadConfig({
      NODE_ENV: "test",
      BETTER_AUTH_SECRET: "synthetic-http-logging-secret-longer-than-32",
    }),
    { logStream: { write: (chunk: string) => logs.push(chunk) } },
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { base: `http://127.0.0.1:${address.port}`, logs };
}

test("HTTP logs omit routine requests and sensitive request data", async (context) => {
  const { base, logs } = await httpFixture(context);
  const name = "SyntheticConfidentialCustomer";
  const email = "confidential-search@example.test";
  const token = "synthetic-confidential-reset-token";
  assert.equal(
    (
      await fetch(`${base}/api/admin/orders?search=${name}&email=${email}`, {
        headers: {
          Authorization: "Bearer synthetic-authorization-secret",
          Cookie: "synthetic-cookie-secret",
          Referer: `https://example.test/reset-password?token=${token}`,
        },
      })
    ).status,
    401,
  );
  await fetch(`${base}/reset-password?token=${token}`);
  // The path parameter also contains a token. Use POST so the auth route does
  // not attempt a database lookup for this synthetic reset link.
  await fetch(`${base}/api/auth/reset-password/${token}?callbackURL=${email}`, {
    method: "POST",
  });
  const output = logs.join("");
  for (const value of [
    name,
    email,
    token,
    "synthetic-authorization-secret",
    "synthetic-cookie-secret",
  ]) {
    assert.ok(
      !output.includes(value),
      `Unexpected confidential value in log: ${value}`,
    );
  }
  const records = logs.map((line) => JSON.parse(line));
  assert.ok(records.every((record) => record.level >= 40));
  assert.ok(records.every((record) => record.msg !== "request completed"));
});

test("malformed JSON, oversized bodies and unsupported encodings return safe 4xx errors with log correlation", async (context) => {
  const { base, logs } = await httpFixture(context);
  const confidential = "synthetic-private-password-and-mail@example.test";
  const cases: Array<{
    body: string;
    headers: Record<string, string>;
    status: number;
    code: string;
  }> = [
    {
      body: `{"email":"${confidential}"`,
      headers: {},
      status: 400,
      code: "INVALID_JSON",
    },
    {
      body: `{"email":"${confidential}","padding":"${"x".repeat(1024 * 1024)}"}`,
      headers: {},
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    },
    {
      body: confidential,
      headers: { "Content-Encoding": "unsupported" },
      status: 415,
      code: "UNSUPPORTED_ENCODING",
    },
    {
      body: confidential,
      headers: { "Content-Type": "application/json; charset=unsupported" },
      status: 415,
      code: "UNSUPPORTED_ENCODING",
    },
  ];
  for (const example of cases) {
    const response = await fetch(`${base}/api/public/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...example.headers },
      body: example.body,
    });
    assert.equal(response.status, example.status);
    const result = await response.json();
    assert.equal(result.error.code, example.code);
    assert.equal(result.error.requestId, response.headers.get("x-request-id"));
    const record = logs
      .map((line) => JSON.parse(line))
      .find(
        (entry) =>
          entry.requestId === result.error.requestId &&
          entry.msg === `request rejected: ${example.code}`,
      );
    assert.equal(record?.code, example.code);
    assert.equal(record?.statusCode, example.status);
    assert.equal(record?.level, 40);
    assert.ok(!JSON.stringify(result).includes(confidential));
  }
  const output = logs.join("");
  const records = logs.map((line) => JSON.parse(line));
  assert.ok(records.every((record) => record.level >= 40));
  assert.ok(records.every((record) => record.msg !== "request completed"));
  assert.ok(!output.includes(confidential));
  assert.ok(!output.includes('"padding"'));
  assert.ok(!output.includes('"body"'));
});

test("unexpected server failures remain visible without serializing error messages, causes or request payloads", async (context) => {
  const { base, logs } = await httpFixture(context);
  const confidential = "synthetic-sensitive-database-argument";
  const original = prisma.appSettings.findUniqueOrThrow;
  const originalLimit = prisma.publicApiRateLimit.upsert;
  let reached = false;
  Reflect.set(prisma.publicApiRateLimit, "upsert", async () => ({ count: 1 }));
  Reflect.set(prisma.appSettings, "findUniqueOrThrow", async () => {
    reached = true;
    throw Object.assign(
      new Error(confidential, { cause: new Error(confidential) }),
      {
        code: "P2002",
        meta: {
          modelName: "Order",
          target: ["orderNumber"],
          arguments: confidential,
        },
        body: confidential,
        password: confidential,
      },
    );
  });
  context.after(() => {
    Reflect.set(prisma.appSettings, "findUniqueOrThrow", original);
    Reflect.set(prisma.publicApiRateLimit, "upsert", originalLimit);
  });
  const response = await fetch(`${base}/api/customer-form/config`);
  assert.equal(reached, true);
  assert.equal(response.status, 500);
  const result = await response.json();
  assert.equal(result.error.code, "INTERNAL_SERVER_ERROR");
  assert.equal(result.error.requestId, response.headers.get("x-request-id"));
  const records = logs.map((line) => JSON.parse(line));
  const failure = records.find((record) =>
    String(record.msg).startsWith("request failed"),
  );
  assert.equal(failure?.code, "INTERNAL_SERVER_ERROR");
  assert.equal(failure?.msg, "request failed: INTERNAL_SERVER_ERROR (P2002)");
  assert.equal(failure?.errorReason, undefined);
  assert.equal(failure?.level, 50);
  assert.equal(failure?.errorName, "Error");
  assert.equal(failure?.errorCode, "P2002");
  assert.deepEqual(failure?.prismaMeta, {
    modelName: "Order",
    target: ["orderNumber"],
  });
  assert.ok(
    failure?.errorFrames?.some((frame: string) =>
      frame.startsWith("apps/server/src/"),
    ),
  );
  assert.ok(records.every((record) => record.level >= 40));
  assert.ok(records.every((record) => record.msg !== "request completed"));
  assert.ok(!logs.join("").includes(confidential));
  assert.ok(!JSON.stringify(result).includes(confidential));
});

test("server failure messages name a safe error category without the error text", async (context) => {
  const { base, logs } = await httpFixture(context);
  const confidential = "synthetic-sensitive-validation-argument";
  const original = prisma.appSettings.findUniqueOrThrow;
  const originalLimit = prisma.publicApiRateLimit.upsert;
  Reflect.set(prisma.publicApiRateLimit, "upsert", async () => ({ count: 1 }));
  Reflect.set(prisma.appSettings, "findUniqueOrThrow", async () => {
    throw Object.assign(new Error(confidential), {
      name: "PrismaClientValidationError",
    });
  });
  context.after(() => {
    Reflect.set(prisma.appSettings, "findUniqueOrThrow", original);
    Reflect.set(prisma.publicApiRateLimit, "upsert", originalLimit);
  });
  const response = await fetch(`${base}/api/customer-form/config`);
  assert.equal(response.status, 500);
  const records = logs.map((line) => JSON.parse(line));
  const failure = records.find((record) =>
    String(record.msg).startsWith("request failed"),
  );
  assert.equal(failure?.errorName, "PrismaClientValidationError");
  assert.equal(failure?.errorReason, "database-input-validation");
  assert.equal(
    failure?.msg,
    "request failed: INTERNAL_SERVER_ERROR (PrismaClientValidationError, database-input-validation)",
  );
  assert.ok(!logs.join("").includes(confidential));
});
