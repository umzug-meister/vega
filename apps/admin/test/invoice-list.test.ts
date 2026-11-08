import assert from "node:assert/strict";
import * as React from "react";
import test from "node:test";
import type { AdminInvoiceDto } from "@vega/domain";
import { mount } from "./dom-test-helpers.js";
import { InvoicesPage } from "../src/invoices/InvoicesPage.js";

const invoice: AdminInvoiceDto = {
  id: "invoice-1", revision: 0, invoiceNumber: "R-42", orderNumber: 1001,
  invoiceDate: "2026-10-11", company: "", customerName: "Ada", customerStreet: "", customerPostalCity: "",
  taxPercent: 19, text: "", entries: [{ description: "Transport", quantity: 2, unitPrice: 100 }],
  dueDates: [], archivedAt: null, purgeAt: null, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z",
};

test("invoice list paginates and search/clear reset to the first page", async (context) => {
  const requests: URLSearchParams[] = [];
  context.mock.method(globalThis, "fetch", async (path: string) => {
    const query = new URL(path, "https://vega.example.test").searchParams;
    requests.push(query);
    return Response.json({ data: { items: [invoice], total: 126, page: Number(query.get("page")), pageSize: 25 } });
  });
  let destination = "";
  const dom = await mount(React.createElement(InvoicesPage, { navigate: (path) => { destination = path; } }));
  context.after(() => dom.cleanup());
  await dom.flush();
  assert.ok(dom.container.textContent?.includes("Rechnungssumme"));
  assert.ok(dom.container.textContent?.includes("Auftragsnummer"));
  assert.doesNotMatch(dom.container.textContent ?? "", /Archiviert am|Löschung frühestens/u);
  assert.ok(dom.container.textContent?.includes("200,00"));
  await dom.click(button(dom.container, "Go to next page"));
  assert.equal(requests.at(-1)?.get("page"), "2");
  await dom.input(dom.container.querySelector("input")!, " Ada ");
  await dom.click(button(dom.container, "Rechnungen suchen"));
  assert.equal(requests.at(-1)?.get("search"), "Ada");
  assert.equal(requests.at(-1)?.get("page"), "1");
  await dom.click(button(dom.container, "Suche leeren"));
  assert.equal(requests.at(-1)?.has("search"), false);
  assert.equal(requests.at(-1)?.get("page"), "1");
  const open = [...dom.container.querySelectorAll("button")].find((item) => item.textContent === "R-42")!;
  await dom.click(open);
  assert.equal(destination, "/invoices/invoice-1");
});

test("archived invoices lock repeated restores and show API and network errors without editing", async (context) => {
  let attempts = 0;
  let settle: ((response: Response) => void) | undefined;
  context.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      attempts += 1;
      if (attempts > 1) throw new Error("Netzwerk nicht erreichbar.");
      return new Promise<Response>((resolve) => { settle = resolve; });
    }
    assert.equal(new URL(path, "https://vega.example.test").searchParams.get("archived"), "true");
    return Response.json({ data: { items: [{ ...invoice, archivedAt: "2026-10-11T12:00:00Z", purgeAt: "2026-11-15T12:00:00Z" }], total: 1, page: 1, pageSize: 25 } });
  });
  const dom = await mount(React.createElement(InvoicesPage, { archived: true, navigate: () => assert.fail("Archived invoice must not open the editor") }));
  context.after(() => dom.cleanup());
  await dom.flush();
  const headers = [...dom.container.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim());
  assert.ok(headers.includes("Archiviert am"));
  assert.ok(headers.includes("Löschung frühestens"));
  const cells = [...dom.container.querySelectorAll("tbody td")].map((cell) => cell.textContent?.trim());
  assert.equal(cells[5], new Date("2026-10-11T12:00:00Z").toLocaleDateString("de-DE"));
  assert.equal(cells[6], new Date("2026-11-15T12:00:00Z").toLocaleDateString("de-DE"));
  assert.ok(![...dom.container.querySelectorAll("button")].some((item) => item.textContent === invoice.invoiceNumber));
  assert.equal(dom.container.querySelector('[aria-label="Rechnungs-PDF herunterladen"]')?.getAttribute("href"), "/api/admin/invoices/invoice-1/pdf");
  const restore = button(dom.container, "Rechnung wiederherstellen");
  await dom.click(restore);
  await dom.click(restore);
  assert.equal(attempts, 1);
  assert.equal(restore.disabled, true);
  assert.ok(settle);
  await React.act(async () => { settle!(Response.json({ error: { message: "Wiederherstellung abgelehnt." } }, { status: 409 })); });
  assert.match(dom.container.textContent ?? "", /Wiederherstellung abgelehnt/u);
  assert.equal(restore.disabled, false);
  await dom.click(restore);
  assert.equal(attempts, 2);
  assert.match(dom.container.textContent ?? "", /Netzwerk nicht erreichbar/u);
});

test("invoice loading failures are visible and a fresh search can retry", async (context) => {
  let attempts = 0;
  context.mock.method(globalThis, "fetch", async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Rechnungsnetzwerk ausgefallen.");
    return Response.json({ data: { items: [invoice], total: 1, page: 1, pageSize: 25 } });
  });
  const dom = await mount(React.createElement(InvoicesPage, { navigate: () => {} }));
  context.after(() => dom.cleanup());
  await dom.flush();
  assert.match(dom.container.textContent ?? "", /Rechnungsnetzwerk ausgefallen/u);
  assert.equal(button(dom.container, "Rechnungen suchen").disabled, false);
  await dom.click(button(dom.container, "Rechnungen suchen"));
  assert.equal(attempts, 2);
  assert.ok(dom.container.textContent?.includes(invoice.invoiceNumber));
  assert.doesNotMatch(dom.container.textContent ?? "", /Rechnungsnetzwerk ausgefallen/u);
});

test("invoice lists keep search and creation on one row on mobile and retain archived actions", async (context) => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (query: string) => ({
    matches: true, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => true,
  });
  context.mock.method(globalThis, "fetch", async () =>
    Response.json({ data: { items: [invoice], total: 1, page: 1, pageSize: 25 } }));
  const destinations: string[] = [];
  const dom = await mount(React.createElement(InvoicesPage, { navigate: (path) => destinations.push(path) }));
  try {
    await dom.flush();
    const create = button(dom.container, "Rechnung anlegen");
    const search = button(dom.container, "Rechnungen suchen");
    assert.equal(create.textContent, "");
    assert.equal(create.title, "Rechnung anlegen");
    const row = search.parentElement?.parentElement?.parentElement;
    assert.ok(row?.contains(create));
    assert.equal(dom.window.getComputedStyle(row).flexDirection, "row");
    assert.equal(dom.window.getComputedStyle(dom.container.querySelector("table")!).minWidth, "750px");
    await dom.click(create);
    assert.deepEqual(destinations, ["/invoices/new"]);
    await dom.input(dom.container.querySelector("input")!, "Ada");
    await dom.click(search);
    assert.ok(dom.container.textContent?.includes("R-42"));
  } finally {
    await dom.cleanup();
    window.matchMedia = originalMatchMedia;
  }

  window.matchMedia = (query: string) => ({
    matches: true, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => true,
  });
  const archived = await mount(React.createElement(InvoicesPage, { archived: true, navigate: () => assert.fail("Archived invoices are read-only") }));
  try {
    await archived.flush();
    assert.equal(archived.container.querySelector('[aria-label="Rechnung anlegen"]'), null);
    assert.equal(dom.window.getComputedStyle(archived.container.querySelector("table")!).minWidth, "1100px");
    assert.ok(archived.container.querySelector('[aria-label="Rechnungs-PDF herunterladen"]'));
    assert.ok(button(archived.container, "Rechnung wiederherstellen"));
  } finally {
    await archived.cleanup();
    window.matchMedia = originalMatchMedia;
  }
});
function button(container: HTMLElement, label: string): HTMLButtonElement {
  const node = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  assert.ok(node, label);
  return node;
}
