import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolveAdminRoute } from "../src/routes.js";

test("a direct two-factor URL does not mark the sign-in flow as authenticated", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /const \[twoFactorRequired, setTwoFactorRequired\] = useState\(false\)/u);
  assert.match(app, /if \(!session && pathname === "\/two-factor" && !twoFactorRequired\)\s*replacePath\("\/login"\)/u);
});

test("legacy order and settings routes resolve to their existing sections", () => {
  assert.equal(resolveAdminRoute("/")?.title, "Aufträge");
  assert.equal(resolveAdminRoute("/edit/-1")?.title, "Neuer Auftrag");
  assert.equal(resolveAdminRoute("/edit/-1")?.path, "/edit/-1");
  assert.equal(resolveAdminRoute("/edit/42")?.title, "Auftrag 42");
  assert.equal(resolveAdminRoute("/blanco")?.title, "Neue Rechnung");
  assert.equal(resolveAdminRoute("/settings")?.title, "Optionen");
  assert.equal(resolveAdminRoute("/settings/offers")?.title, "Angebote");
  assert.equal(resolveAdminRoute("/settings/packings")?.title, "Verpackung");
  assert.equal(resolveAdminRoute("/settings/services")?.title, "Leistungen");
  assert.equal(resolveAdminRoute("/settings/categories")?.title, "Möbel-Kategorien");
  assert.equal(resolveAdminRoute("/settings/furniture")?.title, "Möbel");
  assert.equal(resolveAdminRoute("/settings/furniture")?.settingsArea, "content");
  assert.equal(resolveAdminRoute("/email-text/42")?.title, "E-Mail-Text");
});

test("settings routes separate options, catalog sections, and user management", () => {
  assert.equal(resolveAdminRoute("/settings")?.settingsArea, "options");
  assert.deepEqual(resolveAdminRoute("/settings/content"), resolveAdminRoute("/settings/services"));
  assert.equal(resolveAdminRoute("/settings/content")?.path, "/settings/services");
  assert.equal(resolveAdminRoute("/settings/content")?.contentSection, "services");
  assert.equal(resolveAdminRoute("/settings/content")?.adminOnly, true);
  assert.equal(resolveAdminRoute("/settings/content/furniture")?.path, "/settings/furniture");
  assert.equal(resolveAdminRoute("/settings/content/categories")?.path, "/settings/categories");
  assert.equal(resolveAdminRoute("/settings/content/offers")?.path, "/settings/offers");
  assert.equal(resolveAdminRoute("/settings/content/packings")?.path, "/settings/packings");
  assert.equal(resolveAdminRoute("/settings/content/services")?.path, "/settings/services");
  assert.equal(resolveAdminRoute("/settings/content/prices")?.path, "/settings/prices");
  for (const section of ["offers", "prices", "packings", "services", "categories", "furniture"]) {
    assert.equal(resolveAdminRoute(`/settings/${section}`)?.path, `/settings/${section}`);
  }
  assert.equal(resolveAdminRoute("/settings/prices")?.contentSection, "prices");
  assert.equal(resolveAdminRoute("/settings/prices")?.adminOnly, true);
  assert.equal(resolveAdminRoute("/settings/prices")?.title, "Preise");
  assert.equal(resolveAdminRoute("/settings/users")?.settingsArea, "users");
  assert.equal(resolveAdminRoute("/settings/users")?.adminOnly, true);
  assert.equal(resolveAdminRoute("/settings/users")?.title, "Nutzer");
});

test("new archive, invoice, and profile routes are available with admin-only metadata", () => {
  assert.equal(resolveAdminRoute("/invoices")?.adminOnly, true);
  assert.equal(resolveAdminRoute("/invoices/new")?.adminOnly, true);
  assert.equal(resolveAdminRoute("/invoices/archived")?.adminOnly, true);
  assert.equal(resolveAdminRoute("/orders/archived")?.adminOnly, undefined);
  assert.equal(resolveAdminRoute("/profile")?.profile, true);
});

test("unknown and malformed legacy paths resolve to not found", () => {
  assert.equal(resolveAdminRoute("/unknown"), null);
  assert.equal(resolveAdminRoute("/edit/%E0%A4%A"), null);
  assert.equal(resolveAdminRoute("/email-text/%E0%A4%A"), null);
});

test("order invoice templates resolve to an admin-only unsaved editor", () => {
  const route = resolveAdminRoute("/invoices/new/from-order/1004");
  assert.equal(route?.sourceOrderNumber, 1004);
  assert.equal(route?.title, "Neue Rechnung");
  assert.equal(route?.adminOnly, true);
  for (const path of ["/invoices/new/from-order/0", "/invoices/new/from-order/no", "/invoices/new/from-order/9007199254740992"]) {
    assert.equal(resolveAdminRoute(path), null);
  }
});
