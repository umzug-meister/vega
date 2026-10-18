import assert from "node:assert/strict";
import * as React from "react";
import test from "node:test";
import type {
  AdminCreditNoteDto,
  AdminInvoiceDto,
  AdminReminderDto,
} from "@vega/domain";
import { mount } from "./dom-test-helpers.js";
import { InvoiceEditorPage } from "../src/invoices/InvoiceEditorPage.js";

const invoice: AdminInvoiceDto = {
  id: "invoice-1",
  revision: 7,
  invoiceNumber: "R-42",
  orderNumber: null,
  invoiceDate: "2026-10-11",
  company: "",
  customerName: "Ada",
  customerStreet: "",
  customerPostalCity: "",
  taxPercent: 19,
  text: "Invoice text",
  entries: [],
  dueDates: [],
  archivedAt: null,
  createdAt: "2026-10-11T00:00:00Z",
  updatedAt: "2026-10-11T00:00:00Z",
};
const credit: AdminCreditNoteDto = {
  id: "credit-1",
  invoiceId: invoice.id,
  invoiceNumber: invoice.invoiceNumber,
  creditNumber: "G-42",
  company: "",
  customerName: "Ada",
  customerStreet: "",
  customerPostalCity: "",
  taxPercent: 19,
  creditDate: "2026-10-11",
  text: "Credit text",
  entries: [],
  archivedAt: null,
  createdAt: invoice.createdAt,
  updatedAt: invoice.updatedAt,
};
const reminders: AdminReminderDto[] = [1, 2].map((level) => ({
  id: `reminder-${level}`,
  invoiceId: invoice.id,
  invoiceNumber: invoice.invoiceNumber,
  level,
  previousDueDate: "2026-10-11",
  dueDate: "2026-10-21",
  fee: 10,
  outstandingAmount: 238,
  text: `Reminder ${level}`,
  sentAt: null,
  archivedAt: null,
  createdAt: invoice.createdAt,
  updatedAt: invoice.updatedAt,
}));
const reply = (data: unknown) => Response.json({ data });
function catalogReply(path: string): Response | undefined {
  if (path === "/api/admin/catalog/packings")
    return reply([
      {
        id: 1,
        name: "Umzugskarton",
        price: 4.5,
        description: "",
        media: null,
        sort: 0,
        show: false,
      },
    ]);
  if (path === "/api/admin/catalog/services")
    return reply([
      { id: 2, name: "Bohrarbeiten", price: 85, sort: 0, show: false },
    ]);
  return undefined;
}

test("invoice PUT sends the loaded revision, preserves rejected drafts, and clears dirty only after success", async (context) => {
  let globalDirty = false;
  let invoiceDirty = false;
  let attempts = 0;
  const sent: Array<Record<string, unknown>> = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (path: string, init?: RequestInit) => {
      const catalog = catalogReply(path);
      if (catalog) return catalog;
      if (init?.method === "PUT") {
        sent.push(JSON.parse(String(init.body)));
        attempts += 1;
        return attempts === 1
          ? Response.json(
              {
                error: {
                  code: "INVOICE_CONFLICT",
                  message: "Zwischenzeitlich geändert.",
                },
              },
              { status: 409 },
            )
          : reply({ ...invoice, customerName: "Confirmed name", revision: 8 });
      }
      if (path.startsWith("/api/admin/reminders")) return reply({ items: [] });
      if (path.startsWith("/api/admin/credits")) return reply({ items: [] });
      return reply(invoice);
    },
  );
  const dom = await mount(
    React.createElement(InvoiceEditorPage, {
      id: invoice.id,
      navigate: () => {},
      onDirtyChange: (dirty) => {
        globalDirty = dirty;
      },
      onInvoiceDirtyChange: (dirty) => {
        invoiceDirty = dirty;
      },
    }),
  );
  context.after(() => dom.cleanup());
  await dom.flush();
  const customer = field(dom.container, "Kunde");
  await dom.input(customer, "Local draft");
  assert.equal(globalDirty, true);
  assert.equal(invoiceDirty, true);
  const form = dom.container.querySelector("form")!;
  await React.act(async () => {
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  assert.equal(sent[0]?.revision, 7);
  assert.equal(customer.value, "Local draft");
  assert.equal(globalDirty, true);
  assert.match(dom.container.textContent ?? "", /Zwischenzeitlich geändert/u);
  await React.act(async () => {
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  assert.equal(sent[1]?.revision, 7);
  assert.equal(customer.value, "Confirmed name");
  assert.equal(globalDirty, false);
  assert.equal(invoiceDirty, false);
  await dom.input(customer, "Next draft");
  await React.act(async () => {
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  assert.equal(sent[2]?.revision, 8);
});

test("accounting drafts survive tab switches and other saves while global document actions remain locked", async (context) => {
  let globalDirty = false;
  let invoiceDirty = true;
  let accountingDirty = false;
  const writes: string[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (path: string, init?: RequestInit) => {
      const catalog = catalogReply(path);
      if (catalog) return catalog;
      if (init?.method === "PUT" && path.includes("reminder-1")) {
        writes.push(path);
        return reply({ ...reminders[0], ...JSON.parse(String(init.body)) });
      }
      if (init?.method === "PUT" && path.includes("credit-1")) {
        writes.push(path);
        return reply({ ...credit, ...JSON.parse(String(init.body)) });
      }
      if (path.startsWith("/api/admin/reminders"))
        return reply({ items: reminders });
      if (path.startsWith("/api/admin/credits"))
        return reply({ items: [credit] });
      return reply(invoice);
    },
  );
  const dom = await mount(
    React.createElement(InvoiceEditorPage, {
      id: invoice.id,
      navigate: () => {},
      onDirtyChange: (dirty) => {
        globalDirty = dirty;
      },
      onInvoiceDirtyChange: (dirty) => {
        invoiceDirty = dirty;
      },
      onAccountingDirtyChange: (dirty) => {
        accountingDirty = dirty;
      },
    }),
  );
  context.after(() => dom.cleanup());
  await dom.flush();
  const first = textarea(dom.container, "Reminder 1");
  const second = textarea(dom.container, "Reminder 2");
  const creditText = textarea(dom.container, "Credit text");
  await dom.input(first, "First local draft");
  await dom.input(second, "Second local draft");
  await dom.click(tab(dom.container, "Gutschrift"));
  await dom.input(creditText, "Credit local draft");
  assert.equal(globalDirty, true);
  assert.equal(invoiceDirty, false);
  assert.equal(accountingDirty, true);
  for (const action of [
    ...dom.container.querySelectorAll<HTMLButtonElement>("button"),
  ].filter((button) =>
    ["Archivieren", "Löschen", "E-Mail"].includes(button.textContent ?? ""),
  )) {
    assert.equal(action.disabled, true, action.textContent ?? "");
  }
  assert.ok(
    [...dom.container.querySelectorAll("a")].every(
      (link) => !link.hasAttribute("href"),
    ),
  );
  await dom.click(tab(dom.container, "1. Mahnung"));
  assert.equal(first.value, "First local draft");
  await dom.click(saveButton(first));
  assert.deepEqual(writes, ["/api/admin/reminders/reminder-1"]);
  assert.equal(second.value, "Second local draft");
  assert.equal(creditText.value, "Credit local draft");
  assert.equal(globalDirty, true);
  assert.equal(saveButton(first).disabled, true);
  await dom.click(tab(dom.container, "Gutschrift"));
  await dom.click(saveButton(creditText));
  assert.equal(second.value, "Second local draft");
  assert.equal(globalDirty, true);
  await dom.click(tab(dom.container, "2. Mahnung"));
  assert.equal(second.value, "Second local draft");
});

test("new invoice creation clears the navigation dirty flag before navigating to the saved invoice", async (context) => {
  let dirty = false;
  let destination = "";
  context.mock.method(
    globalThis,
    "fetch",
    async (path: string, init?: RequestInit) => {
      const catalog = catalogReply(path);
      if (catalog) return catalog;
      return init?.method === "POST"
        ? reply({ ...invoice, revision: 0 })
        : reply({ nextValue: 42 });
    },
  );
  const dom = await mount(
    React.createElement(InvoiceEditorPage, {
      onDirtyChange: (value) => {
        dirty = value;
      },
      navigate: (path) => {
        assert.equal(dirty, false);
        destination = path;
      },
    }),
  );
  context.after(() => dom.cleanup());
  await dom.flush();
  assert.equal(dirty, true);
  await dom.input(field(dom.container, "Kunde"), "Ada");
  await React.act(async () => {
    dom.container
      .querySelector("form")!
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
  });
  assert.equal(destination, "/invoices/invoice-1");
});

test("invoice draft from an order does not show the informational banner", async (context) => {
  context.mock.method(globalThis, "fetch", async (path: string) => {
    const catalog = catalogReply(path);
    if (catalog) return catalog;
    if (path === "/api/admin/invoices/next-number")
      return reply({ nextValue: 42 });
    if (path === "/api/admin/invoices/from-order/1006")
      return reply({
        ...invoice,
        invoiceNumber: undefined,
        entries: [],
        dueDates: [{ date: "2026-11-20", amount: 119, text: "Zahlbar bis" }],
        orderOverview: {
          orderNumber: 1006,
          movingDate: "2026-11-15",
          conditions: [
            { description: "2 Träger & LKW", amount: 1250, kind: "base" },
            { description: "Anfahrt", amount: 75, kind: "travel" },
          ],
        },
      });
    if (path.startsWith("/api/admin/reminders")) return reply({ items: [] });
    if (path.startsWith("/api/admin/credits")) return reply({ items: [] });
    return reply(invoice);
  });
  const dom = await mount(
    React.createElement(InvoiceEditorPage, {
      orderNumber: 1006,
      navigate: () => {},
    }),
  );
  context.after(() => dom.cleanup());
  await dom.flush();
  const invoiceDetailsCard = [
    ...dom.container.querySelectorAll<HTMLElement>(".MuiPaper-root"),
  ].find(
    (paper) => paper.querySelector("h2")?.textContent === "Rechnungsdaten",
  );
  assert.ok(invoiceDetailsCard);
  for (const label of [
    "Firma",
    "Kunde",
    "Straße, Nr.",
    "PLZ, Ort",
    "Rechnungsdatum",
    "Rechnungsnummer",
    "Umsatzsteuer (%)",
  ]) {
    assert.ok(
      [...invoiceDetailsCard.querySelectorAll("label")].some((fieldLabel) =>
        fieldLabel.textContent?.startsWith(label),
      ),
      `Expected ${label} in the Rechnungsdaten card`,
    );
  }
  assert.equal(
    dom.container.textContent?.includes("Ungespeicherter Rechnungsentwurf"),
    false,
  );
  assert.equal(dom.container.querySelector(".MuiGrid-container"), null);
  assert.match(dom.container.textContent ?? "", /Umzugsdatum/u);
  assert.match(dom.container.textContent ?? "", /15\.11\.2026/u);
  assert.match(dom.container.textContent ?? "", /2 Träger & LKW/u);
  assert.match(dom.container.textContent ?? "", /Anfahrt/u);
  assert.match(dom.container.textContent ?? "", /1\.325,00 €/u);
  const invoiceTotals = dom.container.querySelector(
    '[aria-label="Rechnungssumme"]',
  );
  assert.ok(invoiceTotals);
  assert.match(
    invoiceTotals.textContent ?? "",
    /Gesamtbetrag \(Brutto\): 1\.325,00 €/u,
  );
  assert.match(
    invoiceTotals.textContent ?? "",
    /Umsatzsteuer \(19%\): 211,55 €/u,
  );
  assert.match(invoiceTotals.textContent ?? "", /Nettobetrag: 1\.113,45 €/u);
  assert.equal(
    dom.container.querySelector('[aria-label="Übersicht Auftrag 1006"]'),
    dom.container.querySelector("form")?.nextElementSibling,
  );
  const descriptionInputs = [
    ...dom.container.querySelectorAll<HTMLInputElement>(
      'input[role="combobox"]',
    ),
  ].filter((input) =>
    input
      .closest(".MuiAutocomplete-root")
      ?.querySelector("label")
      ?.textContent?.startsWith("Beschreibung"),
  );
  assert.deepEqual(
    descriptionInputs.map((input) => input.value),
    ["Umzug am 15.11.2026", "Anfahrt"],
  );
  const entryRows = descriptionInputs.map(
    (input) => input.closest(".MuiAutocomplete-root")?.parentElement,
  );
  assert.equal(entryRows.length, 2);
  for (const row of entryRows) {
    assert.ok(row.querySelector(".MuiAutocomplete-fullWidth"));
    assert.equal(row.querySelectorAll(".MuiFormControl-fullWidth").length, 3);
  }
  assert.deepEqual(
    [
      ...dom.container.querySelectorAll<HTMLInputElement>(
        'input[type="number"]',
      ),
    ]
      .slice(0, 4)
      .map((input) => input.value),
    ["1", "1250", "1", "75"],
  );
  const textArea = dom.container.querySelector<HTMLTextAreaElement>(
    'textarea:not([aria-hidden="true"])',
  );
  assert.ok(textArea);
  const expectedTemplates = [
    "Bar",
    "Bank",
    "Sofort fällig",
    "Bitte überweisen",
    "Teil-Teil",
  ];
  assert.deepEqual(
    [...dom.container.querySelectorAll(".MuiChip-root")].map(
      (chip) => chip.textContent,
    ),
    expectedTemplates,
  );
  await dom.click(
    [...dom.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Position hinzufügen",
    )!,
  );
  const allDescriptions = [
    ...dom.container.querySelectorAll<HTMLInputElement>(
      'input[role="combobox"]',
    ),
  ].filter((input) =>
    input
      .closest(".MuiAutocomplete-root")
      ?.querySelector("label")
      ?.textContent?.startsWith("Beschreibung"),
  );
  const newDescription = allDescriptions.at(-1);
  assert.ok(newDescription);
  await dom.input(newDescription, "Bohrarbeiten");
  await dom.flush();
  const suggestion = [
    ...dom.window.document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((option) => option.textContent?.trim() === "Bohrarbeiten");
  assert.ok(suggestion);
  await dom.click(suggestion);
  assert.equal(newDescription.value, "Bohrarbeiten");
  assert.equal(
    [
      ...dom.container.querySelectorAll<HTMLInputElement>(
        'input[type="number"]',
      ),
    ].at(-1)?.value,
    "85",
  );
  await dom.click(
    [...dom.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Position hinzufügen",
    )!,
  );
  const packingDescription = [
    ...dom.container.querySelectorAll<HTMLInputElement>(
      'input[role="combobox"]',
    ),
  ]
    .filter((input) =>
      input
        .closest(".MuiAutocomplete-root")
        ?.querySelector("label")
        ?.textContent?.startsWith("Beschreibung"),
    )
    .at(-1);
  assert.ok(packingDescription);
  await dom.input(packingDescription, "Umzugskarton");
  await dom.flush();
  const packingSuggestion = [
    ...dom.window.document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((option) => option.textContent?.trim() === "Umzugskarton");
  assert.ok(packingSuggestion);
  await dom.click(packingSuggestion);
  assert.equal(packingDescription.value, "Umzugskarton");
  assert.equal(
    [
      ...dom.container.querySelectorAll<HTMLInputElement>(
        'input[type="number"]',
      ),
    ].at(-1)?.value,
    "4.5",
  );
  const clickTemplate = async (label: string) => {
    const chip = [
      ...dom.container.querySelectorAll<HTMLElement>(".MuiChip-root"),
    ].find((item) => item.textContent === label);
    assert.ok(chip, label);
    await dom.click(chip);
  };
  await dom.input(textArea, "Existing text that should be replaced");
  await clickTemplate("Bar");
  assert.equal(
    textArea.value,
    "Der Rechnungsbetrag in Höhe von 1.414,50 € wurde am 15.11.2026 in Bar bezahlt.",
  );
  await clickTemplate("Bitte überweisen");
  assert.equal(
    textArea.value,
    "Bitte überweisen Sie den offenen Gesamtbetrag in Höhe von 1.414,50 € unter Angabe Ihrer Rechnungsnummer bis zum 20.11.2026 (Zahlungseingang) auf unser Konto.",
  );
  await clickTemplate("Bank");
  assert.equal(
    textArea.value,
    "Der Rechnungsbetrag in Höhe von 1.414,50 € wurde am ?? per Überweisung bezahlt.",
  );
  await clickTemplate("Teil-Teil");
  assert.equal(
    textArea.value,
    "Der Teilbetrag in Höhe von ?? € wurde per Überweisung bezahlt.\nDer Teilbetrag in Höhe von ?? € wurde in Bar bezahlt.",
  );
  await clickTemplate("Sofort fällig");
  assert.equal(textArea.value, "Die Zahlung ist sofort ohne Abzüge fällig.");
  const labels = [...dom.container.querySelectorAll("label")].map((label) =>
    label.textContent?.replace(" *", ""),
  );
  assert.deepEqual(labels.slice(0, 7), [
    "Firma",
    "Kunde",
    "Straße, Nr.",
    "PLZ, Ort",
    "Rechnungsdatum",
    "Rechnungsnummer",
    "Umsatzsteuer (%)",
  ]);
});

test("an archived invoice editor redirects to its read-only archive", async (context) => {
  let destination = "";
  context.mock.method(globalThis, "fetch", async (path: string) => {
    const catalog = catalogReply(path);
    if (catalog) return catalog;
    return reply({ ...invoice, archivedAt: invoice.createdAt });
  });
  const dom = await mount(
    React.createElement(InvoiceEditorPage, {
      id: invoice.id,
      navigate: (path) => {
        destination = path;
      },
    }),
  );
  context.after(() => dom.cleanup());
  await dom.flush();
  assert.equal(destination, "/invoices/archived");
});

for (const resource of ["credits", "reminders"] as const) {
  test(`failed ${resource} loading can be retried without blocking or discarding the invoice draft`, async (context) => {
    let attempts = 0;
    let busy = true;
    let dirty = false;
    let completeRetry: ((response: Response) => void) | undefined;
    context.mock.method(globalThis, "fetch", async (path: string) => {
      const catalog = catalogReply(path);
      if (catalog) return catalog;
      if (path.startsWith(`/api/admin/${resource}`)) {
        attempts++;
        if (attempts === 1) {
          if (resource === "credits") throw new TypeError("Failed to fetch");
          return Response.json(
            { error: { message: "Temporarily unavailable." } },
            { status: 503 },
          );
        }
        return new Promise<Response>((resolve) => {
          completeRetry = resolve;
        });
      }
      if (path.startsWith("/api/admin/reminders"))
        return reply({ items: reminders });
      if (path.startsWith("/api/admin/credits"))
        return reply({ items: [credit] });
      return reply(invoice);
    });
    const dom = await mount(
      React.createElement(InvoiceEditorPage, {
        id: invoice.id,
        navigate: () => {},
        onBusyChange: (value) => {
          busy = value;
        },
        onDirtyChange: (value) => {
          dirty = value;
        },
      }),
    );
    context.after(() => dom.cleanup());
    await dom.flush();
    assert.equal(
      busy,
      false,
      "a failed optional document read must not leave the invoice permanently busy",
    );
    const customer = field(dom.container, "Kunde");
    assert.equal(customer.closest("fieldset")?.disabled, false);
    await dom.click(
      tab(dom.container, resource === "credits" ? "1. Mahnung" : "Gutschrift"),
    );
    const otherDraft = textarea(
      dom.container,
      resource === "credits" ? "Reminder 1" : "Credit text",
    );
    assert.equal(otherDraft.closest("fieldset")?.disabled, false);
    await dom.input(otherDraft, "Keep the other document draft");
    await dom.click(tab(dom.container, "Rechnung"));
    await dom.input(customer, "Keep this draft");
    assert.equal(dirty, true);
    if (resource === "credits")
      await dom.click(tab(dom.container, "Gutschrift"));
    const retry = [...dom.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Erneut versuchen",
    );
    assert.ok(retry, "the failed read must have an explicit retry action");
    assert.equal(retry.disabled, false);
    await dom.click(retry);
    assert.equal(
      busy,
      true,
      "the retry must remain busy until its request finishes",
    );
    const resolveRetry = completeRetry;
    assert.ok(resolveRetry);
    await React.act(async () => {
      resolveRetry(reply({ items: [] }));
    });
    await dom.flush();
    assert.equal(attempts, 2);
    assert.equal(busy, false);
    assert.equal(customer.value, "Keep this draft");
    assert.equal(otherDraft.value, "Keep the other document draft");
    assert.equal(dirty, true);
    if (resource === "credits") {
      assert.ok(
        [...dom.container.querySelectorAll("button")].some(
          (button) => button.textContent === "Gutschrift anlegen",
        ),
      );
    } else {
      assert.ok(tab(dom.container, "+ 1. Mahnung"));
    }
  });
}

function field(container: HTMLElement, label: string): HTMLInputElement {
  const node = [...container.querySelectorAll("label")].find((item) =>
    item.textContent?.startsWith(label),
  );
  assert.ok(node);
  const input = container.querySelector<HTMLInputElement>(
    `[id="${node.htmlFor}"]`,
  );
  assert.ok(input);
  return input;
}
function textarea(container: HTMLElement, value: string): HTMLTextAreaElement {
  const node = [...container.querySelectorAll("textarea")].find(
    (item) => item.value === value && !item.hasAttribute("aria-hidden"),
  );
  assert.ok(node, value);
  return node;
}
function tab(container: HTMLElement, name: string): HTMLButtonElement {
  const node = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((item) => item.textContent === name);
  assert.ok(node, name);
  return node;
}
function saveButton(input: HTMLElement): HTMLButtonElement {
  const section = input.closest("section");
  assert.ok(section);
  const button = [...section.querySelectorAll("button")].find(
    (item) => item.textContent === "Speichern",
  );
  assert.ok(button);
  return button;
}
