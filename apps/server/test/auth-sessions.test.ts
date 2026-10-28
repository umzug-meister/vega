import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { hashPassword } from "better-auth/crypto";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth-config.js";
import { loadConfig } from "../src/config.js";
import { prisma } from "../src/prisma.js";

const initialPassword = "SyntheticInitial123";
const changedPassword = "SyntheticChanged456";

function totp(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  assert.ok(secret);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase()].map((character) => alphabet.indexOf(character).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, index) => parseInt(bits.slice(index * 8, index * 8 + 8), 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function authFixture(context: TestContext, role: "Admin" | "Kundenberater", mustChangePassword = false) {
  const config = loadConfig({
    NODE_ENV: "test",
    BETTER_AUTH_SECRET: "synthetic-session-regression-secret-longer-than-32",
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:3000",
  });
  const configured = createAuth(config);
  const store = { user: [], session: [], account: [], twoFactor: [], verification: [], rateLimit: [] };
  const memory = betterAuth({ ...configured.options, database: memoryAdapter(store) });
  const auth = Object.assign(memory, { requestStaffPasswordReset: configured.requestStaffPasswordReset });
  const internal = (await auth.$context).internalAdapter;
  const user = await internal.createUser({
    name: "Synthetic Staff", email: "staff@example.test", role, mustChangePassword, blocked: false, twoFactorEnabled: false,
  }, { method: "admin" });
  await internal.createAccount({
    userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(initialPassword),
  });
  const originalRead = prisma.user.findUnique;
  const originalUpdate = prisma.user.update;
  Reflect.set(prisma.user, "findUnique", async () => ({ blocked: false }));
  Reflect.set(prisma.user, "update", async ({ data }: { data: Record<string, unknown> }) => internal.updateUser(user.id, data));
  context.after(() => {
    Reflect.set(prisma.user, "findUnique", originalRead);
    Reflect.set(prisma.user, "update", originalUpdate);
  });
  const logs: string[] = [];
  const app = createApp(config, { auth, logStream: { write: (chunk: string) => logs.push(chunk) } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  class Client {
    cookies = new Map<string, string>();
    async request(path: string, body?: unknown) {
      const response = await fetch(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0]!;
        const separator = pair.indexOf("=");
        const name = pair.slice(0, separator), value = pair.slice(separator + 1);
        if (value) this.cookies.set(name, value);
        else this.cookies.delete(name);
      }
      return { status: response.status, body: await response.json(), cookies: response.headers.getSetCookie() };
    }
    signIn(password = initialPassword) {
      return this.request("/api/auth/sign-in/email", { email: user.email, password });
    }
    gate() { return this.request("/api/admin/future"); }
  }
  async function verify(client: Client, uri: string) {
    return client.request("/api/auth/two-factor/verify-totp", { code: totp(uri) });
  }
  return { Client, verify, auth, internal, user, logs };
}

test("initial password change revokes both old sessions and forwards the replacement cookie before TOTP setup", async (context) => {
  const { Client, verify, logs } = await authFixture(context, "Admin", true);
  const legitimate = new Client(), peer = new Client(), duringEnrollment = new Client();
  assert.equal((await legitimate.signIn()).status, 200);
  assert.equal((await peer.signIn()).status, 200);
  const originalCookie = legitimate.cookies.get("better-auth.session_token");
  assert.equal((await legitimate.gate()).body.error.code, "PASSWORD_CHANGE_REQUIRED");
  const rejected = await legitimate.request("/api/admin/auth/initial-password", {
    currentPassword: "WrongPassword123", newPassword: changedPassword,
  });
  assert.equal(rejected.status, 400);
  assert.equal((await peer.gate()).status, 403);
  const changed = await legitimate.request("/api/admin/auth/initial-password", {
    currentPassword: initialPassword, newPassword: changedPassword,
  });
  assert.equal(changed.status, 200);
  assert.ok(changed.cookies.some((cookie) => cookie.startsWith("better-auth.session_token=")));
  assert.notEqual(legitimate.cookies.get("better-auth.session_token"), originalCookie);
  assert.equal((await peer.gate()).status, 401);
  const replay = new Client();
  replay.cookies.set("better-auth.session_token", originalCookie!);
  assert.equal((await replay.gate()).status, 401);
  assert.equal((await legitimate.gate()).body.error.code, "TWO_FACTOR_SETUP_REQUIRED");

  const enrolled = await legitimate.request("/api/auth/two-factor/enable", { password: changedPassword });
  assert.equal(enrolled.status, 200);
  assert.equal((await duringEnrollment.signIn(changedPassword)).status, 200);
  assert.equal((await verify(legitimate, enrolled.body.totpURI)).status, 200);
  assert.equal((await legitimate.gate()).status, 404);
  assert.equal((await peer.gate()).status, 401);
  assert.equal((await duringEnrollment.gate()).status, 401);
  const log = logs.join("");
  assert.ok(!log.includes(initialPassword));
  assert.ok(!log.includes(changedPassword));
  assert.ok(!log.includes(originalCookie!));
  assert.ok(!log.includes(legitimate.cookies.get("better-auth.session_token")!));
});

test("optional TOTP enrollment and re-enrollment revoke pre-factor peers but preserve independent verified logins", async (context) => {
  const { Client, verify } = await authFixture(context, "Kundenberater");
  const active = new Client(), peer = new Client(), duringSetup = new Client();
  assert.equal((await active.signIn()).status, 200);
  assert.equal((await peer.signIn()).status, 200);
  assert.equal((await peer.gate()).status, 404);
  assert.equal((await active.request("/api/auth/two-factor/enable", { password: "WrongPassword123" })).status, 400);
  assert.equal((await peer.gate()).status, 404);

  const enrollment = await active.request("/api/auth/two-factor/enable", { password: initialPassword });
  assert.equal(enrollment.status, 200);
  assert.equal((await peer.gate()).status, 401);
  assert.equal((await duringSetup.signIn()).status, 200);
  assert.equal((await verify(active, enrollment.body.totpURI)).status, 200);
  assert.equal((await duringSetup.gate()).status, 401);
  assert.equal((await active.gate()).status, 404);

  const verifiedPeer = new Client();
  assert.equal((await verifiedPeer.signIn()).body.twoFactorRedirect, true);
  assert.equal((await verifiedPeer.gate()).status, 401);
  assert.equal((await verify(verifiedPeer, enrollment.body.totpURI)).status, 200);
  assert.equal((await active.gate()).status, 404);
  assert.equal((await verifiedPeer.gate()).status, 404);

  assert.equal((await active.request("/api/auth/two-factor/disable", { password: initialPassword })).status, 200);
  assert.equal((await verifiedPeer.gate()).status, 401);
  assert.equal((await active.gate()).status, 404);
  const reEnrollmentPeer = new Client();
  assert.equal((await reEnrollmentPeer.signIn()).status, 200);
  const reEnrollment = await active.request("/api/auth/two-factor/enable", { password: initialPassword });
  assert.equal(reEnrollment.status, 200);
  assert.equal((await reEnrollmentPeer.gate()).status, 401);
  assert.equal((await verify(active, reEnrollment.body.totpURI)).status, 200);
  assert.equal((await active.gate()).status, 404);
});

test("admins cannot disable mandatory TOTP or replace it with OTP/trusted-device bypasses", async (context) => {
  const { Client, verify } = await authFixture(context, "Admin");
  const admin = new Client();
  assert.equal((await admin.signIn()).status, 200);
  assert.equal((await admin.request("/api/auth/two-factor/enable", { password: initialPassword, method: "otp" })).status, 403);
  const enrollment = await admin.request("/api/auth/two-factor/enable", { password: initialPassword });
  assert.equal(enrollment.status, 200);
  assert.equal((await verify(admin, enrollment.body.totpURI)).status, 200);
  assert.equal((await admin.request("/api/auth/two-factor/disable", { password: initialPassword })).status, 403);
  assert.equal((await admin.request("/api/auth/two-factor/verify-totp", { code: "000000", trustDevice: true })).status, 403);
  assert.equal((await admin.gate()).status, 404);
});

test("unexpected password-change failures remain server errors and do not unlock initial accounts", async (context) => {
  const { Client, auth, logs } = await authFixture(context, "Admin", true);
  const client = new Client();
  assert.equal((await client.signIn()).status, 200);
  const original = auth.api.changePassword;
  const confidential = "synthetic-sensitive-password-service-error";
  Reflect.set(auth.api, "changePassword", async () => { throw new Error(confidential); });
  context.after(() => Reflect.set(auth.api, "changePassword", original));
  const response = await client.request("/api/admin/auth/initial-password", {
    currentPassword: initialPassword, newPassword: changedPassword,
  });
  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, "INTERNAL_SERVER_ERROR");
  assert.equal((await client.gate()).body.error.code, "PASSWORD_CHANGE_REQUIRED");
  assert.ok(
    logs.some((line) =>
      String(JSON.parse(line).msg).startsWith("request failed"),
    ),
  );
  assert.ok(!logs.join("").includes(confidential));
});
