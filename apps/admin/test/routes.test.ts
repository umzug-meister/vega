import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { formatAdminRouteTitle, resolveAdminRoute } from "../src/routes.js";

test("a direct two-factor URL does not mark the sign-in flow as authenticated", async () => {
  const app = await readFile(
    new URL("../src/App.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    app,
    /const \[twoFactorRequired, setTwoFactorRequired\] = useState\(false\)/u,
  );
  assert.match(
    app,
    /if \(!session && pathname === "\/two-factor" && !twoFactorRequired\)\s*replacePath\("\/login"\)/u,
  );
});

test("admin routes resolve to orders, invoices, profile and root-level admin sections", () => {
  assert.equal(resolveAdminRoute("/")?.title, "Aufträge");
  assert.equal(resolveAdminRoute("/edit/-1")?.title, "Neuer Auftrag");
  assert.equal(resolveAdminRoute("/edit/-1")?.path, "/edit/-1");
  assert.equal(resolveAdminRoute("/edit/42")?.title, "Auftrag 42");
  assert.equal(resolveAdminRoute("/blanco"), null);
  assert.equal(resolveAdminRoute("/invoices/new")?.title, "Neue Rechnung");
  assert.equal(resolveAdminRoute("/options")?.title, "Optionen");
  assert.equal(resolveAdminRoute("/offers")?.title, "Angebote");
  assert.equal(resolveAdminRoute("/packings")?.title, "Verpackung");
  assert.equal(resolveAdminRoute("/services")?.title, "Leistungen");
  assert.equal(
    resolveAdminRoute("/categories")?.title,
    "Möbel-Kategorien",
  );
  assert.equal(resolveAdminRoute("/furniture")?.title, "Möbel");
  assert.equal(
    resolveAdminRoute("/furniture")?.settingsArea,
    "content",
  );
  assert.equal(resolveAdminRoute("/users")?.title, "Nutzer");
  assert.equal(resolveAdminRoute("/email-text/42"), null);
});

test("catalog, options, and user sections use paths without an intermediate settings segment", () => {
  assert.equal(resolveAdminRoute("/options")?.settingsArea, "options");
  assert.equal(resolveAdminRoute("/options")?.adminOnly, true);
  assert.equal(resolveAdminRoute("/prices")?.contentSection, "prices");
  assert.equal(resolveAdminRoute("/prices")?.adminOnly, true);
  assert.equal(resolveAdminRoute("/prices")?.title, "Preise");
  assert.equal(resolveAdminRoute("/users")?.settingsArea, "users");
  assert.equal(resolveAdminRoute("/users")?.adminOnly, true);
  assert.equal(resolveAdminRoute("/users")?.title, "Nutzer");
  for (const obsoletePath of [
    "/settings",
    "/settings/options",
    "/settings/setup",
    "/settings/users",
    "/settings/offers",
    "/settings/prices",
    "/settings/packings",
    "/settings/services",
    "/settings/categories",
    "/settings/furniture",
    "/settings/content",
    "/settings/content/offers",
  ]) {
    assert.equal(resolveAdminRoute(obsoletePath), null, obsoletePath);
  }
});

test("new archive, invoice, and profile routes are available with admin-only metadata", () => {
  assert.equal(resolveAdminRoute("/invoices")?.adminOnly, true);
  assert.equal(resolveAdminRoute("/invoices/new")?.adminOnly, true);
  assert.equal(resolveAdminRoute("/invoices/archived")?.adminOnly, true);
  assert.equal(resolveAdminRoute("/orders/archived")?.adminOnly, undefined);
  assert.equal(resolveAdminRoute("/profile")?.profile, true);
});

test("nested routes display their parent and subroute in the navbar title", () => {
  assert.equal(
    formatAdminRouteTitle(resolveAdminRoute("/orders/archived")!),
    "Archiv | Aufträge",
  );
  assert.equal(
    formatAdminRouteTitle(resolveAdminRoute("/invoices/archived")!),
    "Archiv | Rechnungen",
  );
  assert.equal(
    formatAdminRouteTitle(resolveAdminRoute("/offers")!),
    "Katalog | Angebote",
  );
  assert.equal(
    formatAdminRouteTitle(resolveAdminRoute("/users")!),
    "Verwaltung | Nutzer",
  );
  assert.equal(
    formatAdminRouteTitle(resolveAdminRoute("/maintenance")!),
    "Verwaltung | Maintenance",
  );
  assert.equal(
    formatAdminRouteTitle(resolveAdminRoute("/options")!),
    "Optionen",
  );
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
  for (const path of [
    "/invoices/new/from-order/0",
    "/invoices/new/from-order/no",
    "/invoices/new/from-order/9007199254740992",
  ]) {
    assert.equal(resolveAdminRoute(path), null);
  }
});
