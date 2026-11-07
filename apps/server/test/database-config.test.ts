import assert from "node:assert/strict";
import { rootCertificates } from "node:tls";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadDatabaseConfig } from "../src/database-config.js";

const base = "mysql://vega:test-only-password@127.0.0.1:3307/vega_test";

test("database configuration decodes credentials and preserves bounded pool/UTC settings", () => {
  assert.deepEqual(loadDatabaseConfig({ DATABASE_URL: base }), {
    host: "127.0.0.1", port: 3307, user: "vega", password: "test-only-password", database: "vega_test",
    connectionLimit: 5, connectTimeout: 5_000, acquireTimeout: 10_000, idleTimeout: 300,
    minimumIdle: 0, timezone: "+00:00", logParam: false,
    charset: "utf8mb4", collation: "UTF8MB4_UNICODE_CI",
    initSql: "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci", ssl: false,
  });
  const decoded = loadDatabaseConfig({ DATABASE_URL: "mysql://user%40test:p%3A%2F%25%2B@[::1]/db%20test" });
  assert.equal(decoded.host, "::1");
  assert.equal(decoded.port, 3306);
  assert.equal(decoded.user, "user@test");
  assert.equal(decoded.password, "p:/%+");
  assert.equal(decoded.database, "db test");
  const custom = loadDatabaseConfig({ DATABASE_URL: `${base}?connection_limit=3&connect_timeout=2&pool_timeout=4` });
  assert.equal(custom.connectionLimit, 3);
  assert.equal(custom.connectTimeout, 2_000);
  assert.equal(custom.acquireTimeout, 4_000);
});

test("database configuration rejects invalid URLs/options without exposing credentials", () => {
  for (const value of [
    undefined, "", "not-a-url", "postgres://user:secret@localhost/db", "mysql://localhost/db",
    "mysql://user:secret@localhost/", "mysql://user:secret@localhost/db/other",
    "mysql://user:secret@localhost:0/db", "mysql://user:secret@localhost/db#fragment",
    "mysql://user:%ZZ@localhost/db", "mysql://user:secret@localhost/db%2Fother",
    "mysql://user:secret%00@localhost/db",
    `${base}?unknown=secret`, `${base}?connection_limit=1&connection_limit=2`,
    `${base}?pool_timeout=0`, `${base}?connect_timeout=-1`, `${base}?connection_limit=1.5`,
    `${base}?connection_limit=1e2`, `${base}?connect_timeout=2147484`,
    `${base}?sslaccept=accept_invalid_certs`, `${base}?sslcert=`,
    `${base}?sslcert=/missing-vega-test-ca.pem`,
  ]) {
    assert.throws(() => loadDatabaseConfig(value === undefined ? {} : { DATABASE_URL: value }), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /DATABASE_URL/u);
      assert.equal(error.message.includes("secret"), false);
      assert.equal(error.message.includes("test-only-password"), false);
      assert.equal(error.message.includes("mysql://"), false);
      return true;
    });
  }
});

test("database TLS always verifies certificates, with an optional explicit CA", (context) => {
  assert.equal(loadDatabaseConfig({ DATABASE_URL: `${base}?sslaccept=strict` }).ssl, true);
  const directory = mkdtempSync(join(tmpdir(), "vega-database-ca-"));
  context.after(() => rmSync(directory, { recursive: true }));
  const path = join(directory, "ca.pem");
  const certificate = rootCertificates[0];
  assert.ok(certificate);
  writeFileSync(path, certificate);
  const config = loadDatabaseConfig({ DATABASE_URL: `${base}?sslcert=${encodeURIComponent(path)}` });
  assert.equal(typeof config.ssl, "object");
  assert.ok(typeof config.ssl === "object");
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.ca.toString(), certificate);
});
