import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

test("built single-process deployment serves API, both frontends and absolute loader assets", { timeout: 30_000 }, async (context) => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port),
      DATABASE_URL: "mysql://deployment_test:deployment_test@127.0.0.1:1/vega_deployment_test",
      APP_BASE_URL: "https://vega.example.test", BETTER_AUTH_URL: "https://vega.example.test",
      BETTER_AUTH_TRUSTED_ORIGINS: "https://vega.example.test",
      CORS_ALLOWED_ORIGINS: "https://wordpress.example.test",
      BETTER_AUTH_SECRET: "deployment-test-only-secret-at-least-32-characters",
      HOSTINGER_MAIL_API_TOKEN: "deployment-test-only-token",
      HOSTINGER_MAILBOX_RESOURCE_ID: "deployment-test-mailbox",
      HOSTINGER_MAIL_API_BASE_URL: "", GCS_BUCKET: "", GOOGLE_MAPS_API_KEY: "",
    },
  });
  child.stdout.resume();
  child.stderr.resume();
  let spawnError: Error | undefined;
  child.on("error", (error) => { spawnError = error; });
  context.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnError) throw spawnError;
    assert.equal(child.exitCode, null, "production server exited before readiness");
    try {
      ready = (await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) })).ok;
    } catch {
      // The listener may not yet exist during startup.
    }
    if (ready) break;
    await setTimeout(100);
  }
  assert.ok(ready, "production healthcheck did not become ready");
  const health = await fetch(`${base}/health`, { headers: { Origin: "https://wordpress.example.test" } });
  assert.deepEqual(await health.json(), { status: "ok", service: "vega" });
  assert.equal(health.headers.get("access-control-allow-origin"), "https://wordpress.example.test");
  assert.ok(health.headers.get("content-security-policy"));
  for (const path of ["/login", "/customer-form/", "/maintenance"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/u);
    const html = await response.text();
    const script = html.match(/src="([^"]+\.js)"/u)?.[1];
    assert.ok(script, `${path} must load its built entrypoint`);
    assert.equal((await fetch(new URL(script, base))).status, 200);
  }
  const loader = await fetch(`${base}/customer-form/loader.js`);
  assert.equal(loader.status, 200);
  assert.equal(loader.headers.get("cross-origin-resource-policy"), "cross-origin");
  const source = await loader.text();
  assert.ok(source.includes('root.dataset.apiBase = "https://vega.example.test"'));
  const assets = [...source.matchAll(/https:\/\/vega\.example\.test(\/customer-form\/assets\/[^"]+)/gu)];
  assert.ok(assets.length >= 2, "loader must include absolute JS and CSS");
  for (const match of assets) assert.equal((await fetch(`${base}${match[1]}`)).status, 200);
  const manifest = JSON.parse(await readFile(`${root}/apps/customer-form/dist/.vite/manifest.json`, "utf8")) as Record<string, { file: string; isEntry?: boolean }>;
  const entry = Object.values(manifest).find((item) => item.isEntry);
  assert.ok(entry);
  const bundle = await readFile(`${root}/apps/customer-form/dist/${entry.file}`, "utf8");
  assert.equal(bundle.includes("https://vega.example.test"), false, "runtime origin must not be embedded in Vite output");
  assert.equal((await fetch(`${base}/api/public/orders/1000`)).status, 404);
  assert.equal((await fetch(`${base}/api/admin/settings`)).status, 401);
  assert.equal((await fetch(`${base}/api/admin/maintenance`)).status, 401);
  assert.equal((await fetch(`${base}/api/admin/maintenance/smoke-test`, { method: "POST" })).status, 401);
});
