import assert from "node:assert/strict";
import { createElement, useEffect } from "react";
import test from "node:test";
import { mount } from "./dom-test-helpers.js";
import { AdminShell } from "../src/components/AdminShell.js";
import { AdminNotifications, useAdminNotification } from "../src/components/AdminNotifications.js";
import { resolveAdminRoute } from "../src/routes.js";
import type { StaffUser } from "../src/types.js";
import { OrdersPage } from "../src/orders/OrdersPage.js";

const user: StaffUser = { id: "staff", name: "Test", email: "staff@example.test", role: "Admin", twoFactorEnabled: true, mustChangePassword: false, blocked: false };
function ErrorToastTrigger() {
  const notify = useAdminNotification();
  useEffect(() => notify("error", "Testfehler"), [notify]);
  return null;
}
function shell(navigate: (path: string) => void, orderIsCopy = false) {
  const route = resolveAdminRoute("/edit/1001")!;
  return createElement(AdminNotifications, null, createElement(AdminShell, {
    user, route, pathname: route.path, navigate, orderIsCopy, children: null,
  }));
}

test("error toast icon and message are vertically centered", async () => {
  const app = await mount(createElement(AdminNotifications, null, createElement(ErrorToastTrigger)));
  try {
    await app.flush();
    const alert = app.container.querySelector<HTMLElement>('[role="alert"]');
    assert.ok(alert);
    assert.equal(app.window.getComputedStyle(alert).alignItems, "center");
  } finally {
    await app.cleanup();
  }
});

test("copy locks repeated clicks, reports server failures and re-enables follow-up actions", async () => {
  const originalFetch = globalThis.fetch;
  let resolve!: (response: Response) => void;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Promise<Response>((done) => { resolve = done; }); };
  const navigation: string[] = [];
  const app = await mount(shell((path) => navigation.push(path)), "/edit/1001");
  try {
    const button = app.container.querySelector<HTMLButtonElement>('button[aria-label="Angebotskopie anlegen"]')!;
    await app.click(button);
    assert.equal(button.disabled, true);
    await app.click(button);
    assert.equal(calls, 1);
    resolve(Response.json({ error: { message: "Kopie fehlgeschlagen." } }, { status: 500 }));
    await app.flush();
    assert.ok(app.window.document.body.textContent!.includes("Kopie fehlgeschlagen."));
    assert.equal(button.disabled, false);
    assert.deepEqual(navigation, []);
    globalThis.fetch = async () => Response.json({ data: { orderNumber: 1002 } });
    await app.click(button);
    assert.deepEqual(navigation, ["/edit/1002"]);
  } finally { globalThis.fetch = originalFetch; await app.cleanup(); }
});

test("accounting-only drafts lock document actions without offering to save the unchanged invoice", async () => {
  const route = resolveAdminRoute("/invoices/invoice-1")!;
  const app = await mount(createElement(AdminShell, {
    user, route, pathname: route.path, navigate: () => {},
    invoiceAccountingDirty: true, invoiceDirty: false, children: null,
  }));
  try {
    for (const label of ["Rechnung speichern", "Rechnungs-PDF speichern", "Rechnung per E-Mail versenden", "Rechnung archivieren"]) {
      const button = app.container.querySelector<HTMLElement>(`button[aria-label="${label}"], a[aria-label="${label}"]`);
      assert.ok(button, label);
      assert.equal(button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true", true, label);
    }
  } finally { await app.cleanup(); }
});

test("archive network failures are visible and do not navigate away", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  const navigation: string[] = [];
  const app = await mount(shell((path) => navigation.push(path)), "/edit/1001");
  try {
    const button = app.container.querySelector<HTMLButtonElement>('button[aria-label="Auftrag archivieren"]')!;
    await app.click(button);
    assert.ok(app.window.document.body.textContent!.includes("Auftrag konnte nicht archiviert werden."));
    assert.equal(button.disabled, false);
    assert.deepEqual(navigation, []);
  } finally { globalThis.fetch = originalFetch; await app.cleanup(); }
});

test("the order email menu exposes paired offers only for copies", async () => {
  for (const copy of [false, true]) {
    const app = await mount(shell(() => {}, copy), "/edit/1001");
    try {
      await app.click(app.container.querySelector('button[aria-label="E-Mail versenden"]')!);
      const entries = [...app.window.document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
      assert.deepEqual(entries, copy ? ["Angebot versenden", "2 Angebote versenden", "Absage versenden"] : ["Angebot versenden", "Absage versenden"]);
    } finally { await app.cleanup(); }
  }
});

test("archived orders remain read-only and restoration failures keep the list usable", async () => {
  const originalFetch = globalThis.fetch;
  const item = {
    orderNumber: 1001, source: "UmzugRuckZuck", customerName: "Test Kunde", customerCompany: " Beispiel GmbH ",
    grossTotal: 1234.56,
    movingDate: "2026-11-01",
    fromAddress: "Eine sehr lange Auszugsadresse, die in der Tabelle gekürzt werden muss, München",
    toAddress: "Eine ebenso lange Einzugsadresse, die in der Tabelle gekürzt werden muss, München",
    fromParkingSlot: true, toParkingSlot: true, workers: null, trucks: null, hours: null,
    createdAt: "2026-10-01T00:00:00.000Z", editedAt: null, isCopy: false, archivedAt: "2026-10-02T12:00:00.000Z", purgeAt: "2026-12-05T12:00:00.000Z",
  };
  let requests = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") { requests++; throw new TypeError("offline"); }
    return Response.json({ data: { items: [item], total: 1 } });
  };
  const app = await mount(createElement(OrdersPage, { archived: true, navigate: () => assert.fail("archive list must not open an editor") }), "/orders/archived");
  try {
    const headers = [...app.container.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim());
    assert.equal(headers.includes("Quelle"), false);
    assert.ok(headers.includes("LKW"));
    assert.ok(headers.includes("Archiviert am"));
    assert.ok(headers.includes("Löschung frühestens"));
    assert.equal(headers.includes("HVZ"), false);
    assert.equal(headers.includes("3,5t"), false);
    assert.deepEqual(headers.slice(-2), ["Summe", "Aktionen"]);
    const row = app.container.querySelector("tbody tr")!;
    const cells = row.querySelectorAll("td");
    assert.equal(app.window.getComputedStyle(cells[1]!).whiteSpace, "nowrap");
    assert.equal(cells[1]!.textContent, "Beispiel GmbH - Test Kunde");
    assert.equal(cells[8]?.textContent, new Date(item.archivedAt).toLocaleDateString("de-DE"));
    assert.equal(cells[9]?.textContent, new Date(item.purgeAt).toLocaleDateString("de-DE"));
    assert.equal(row.querySelectorAll('[data-testid="CheckCircleIcon"]').length, 0);
    const fromAddress = cells[3]!.querySelector<HTMLElement>("[title]")!;
    assert.equal(fromAddress.getAttribute("title"), item.fromAddress);
    assert.equal(app.window.getComputedStyle(fromAddress).whiteSpace, "nowrap");
    assert.equal(app.window.getComputedStyle(fromAddress).textOverflow, "ellipsis");
    assert.equal(
      cells[cells.length - 2]!.textContent?.trim(),
      new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(item.grossTotal),
    );
    assert.ok(cells[cells.length - 1]!.querySelector('[aria-label="Auftrags-PDF herunterladen"]'));
    assert.ok(cells[cells.length - 1]!.querySelector('[aria-label="Auftrag wiederherstellen"]'));
    assert.equal(app.container.querySelector('a[href="/api/admin/orders/1001/pdf"]') !== null, true);
    assert.equal([...app.container.querySelectorAll("button")].some((button) => button.textContent === "1001"), false);
    const restore = app.container.querySelector<HTMLButtonElement>('button[aria-label="Auftrag wiederherstellen"]')!;
    await app.click(restore);
    assert.equal(requests, 1);
    assert.equal(restore.disabled, false);
    assert.ok(app.container.textContent!.includes("Aktion konnte nicht ausgeführt werden."));
    assert.ok(app.container.textContent!.includes("Test Kunde"));
  } finally { globalThis.fetch = originalFetch; await app.cleanup(); }
});

test("active orders retain both parking zone columns", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({
    data: { items: [{
      orderNumber: 1001, customerName: "Test", customerCompany: "   ", movingDate: "", fromAddress: "", toAddress: "",
      fromParkingSlot: true, toParkingSlot: true, workers: null, trucks: null, hours: null,
      grossTotal: 0, editedAt: null,
    }], total: 1 },
  }));
  const app = await mount(createElement(OrdersPage, { navigate: () => {} }));
  try {
    await app.flush();
    assert.equal([...app.container.querySelectorAll("thead th")].filter((cell) => cell.textContent === "HVZ").length, 2);
    assert.equal(app.container.querySelectorAll('tbody [data-testid="CheckCircleIcon"]').length, 2);
    assert.equal(app.window.getComputedStyle(app.container.querySelectorAll("tbody td")[1]!).whiteSpace, "nowrap");
    assert.equal(app.container.querySelectorAll("tbody td")[1]!.textContent, "Test");
  } finally { await app.cleanup(); }
});

test("small-screen order search and creation stay on one line with an icon-only create action", async () => {
  const originalFetch = globalThis.fetch;
  const originalMatchMedia = window.matchMedia;
  globalThis.fetch = async () =>
    Response.json({ data: { items: [], total: 0 } });
  window.matchMedia = (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  });
  const navigation: string[] = [];
  const app = await mount(
    createElement(OrdersPage, {
      navigate: (path) => navigation.push(path),
    }),
    "/",
  );
  try {
    const createButton = app.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Auftrag anlegen"]',
    );
    assert.ok(createButton);
    assert.ok(createButton.classList.contains("MuiIconButton-root"));
    assert.ok(createButton.querySelector('[data-testid="AddOutlinedIcon"]'));
    assert.equal(createButton.textContent?.trim(), "");
    assert.equal(
      app.window.getComputedStyle(createButton.parentElement!).flexDirection,
      "row",
    );
    assert.equal(
      app.window.getComputedStyle(createButton.parentElement!).justifyContent,
      "space-between",
    );
    assert.ok(
      createButton.parentElement?.querySelector(
        'button[aria-label="Aufträge suchen"]',
      ),
    );
    await app.click(createButton);
    assert.deepEqual(navigation, ["/edit/-1"]);
  } finally {
    globalThis.fetch = originalFetch;
    window.matchMedia = originalMatchMedia;
    await app.cleanup();
  }
});
