import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import type { InboxReplyDraft } from "@vega/domain";
import { AdminNotifications } from "../src/components/AdminNotifications.js";
import { InboxPage } from "../src/inbox/InboxPage.js";
import { InboxReplyDialog } from "../src/inbox/InboxReplyDialog.js";
import { OrderEmailActionsContext } from "../src/email/order-email-actions.js";
import { createEmptyOrder } from "../src/orders/order-form-types.js";
import { mount } from "./dom-test-helpers.js";

const draft: InboxReplyDraft = {
  to: [{ name: "Reply Team", address: "reply@example.test" }],
  cc: [{ name: "Colleague", address: "colleague@example.test" }],
  subject: "Re: Umzugsangebot",
  quoteText: "Am 14.11.2026 schrieb Sender <sender@example.test>:\n> Ursprüngliche Anfrage",
};

test("Reply All composer displays recipients and sends the edited body", async (context) => {
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    requests.push({ url, ...(body ? { body } : {}) });
    if (url.endsWith("/reply-draft")) return Response.json({ data: draft });
    if (url.endsWith("/reply")) return Response.json({ data: { status: "SENT" } });
    throw new Error(`Unexpected request: ${url}`);
  });

  let closed = false;
  let sent = false;
  const view = await mount(
    React.createElement(
      AdminNotifications,
      null,
      React.createElement(InboxReplyDialog, {
        uid: 42,
        onClose: () => { closed = true; },
        onSent: () => { sent = true; },
      }),
    ),
  );
  context.after(() => view.cleanup());
  await view.flush();

  const bodyText = view.window.document.body.textContent ?? "";
  assert.ok(bodyText.includes("reply@example.test"));
  assert.ok(bodyText.includes("colleague@example.test"));
  assert.ok(bodyText.includes("> Ursprüngliche Anfrage"));
  assert.doesNotMatch(bodyText, /Freundliche Grüße|Alexander Berent|Umzug Ruck Zuck Team|\+49 89/u);
  assert.equal(view.window.document.body.querySelector('a[href^="tel:"]'), null);

  const bodyElement = view.window.document.body;
  const subjectInput = bodyElement.querySelector<HTMLInputElement>(
    "input.MuiInputBase-input",
  );
  const messageInput = bodyElement.querySelector("textarea");
  assert.ok(subjectInput instanceof view.window.HTMLInputElement);
  assert.ok(messageInput instanceof view.window.HTMLTextAreaElement);
  await view.input(subjectInput, "Re: Terminbestätigung");
  await view.input(messageInput, "Dienstag passt uns gut.");
  const sendButton = [...view.window.document.body.querySelectorAll("button")].find((button) => button.textContent?.includes("Senden"));
  assert.ok(sendButton);
  await view.click(sendButton);
  await view.flush();

  const sendRequest = requests.find((request) => request.url.endsWith("/reply"));
  assert.deepEqual(sendRequest?.body && {
    subject: sendRequest.body.subject,
    text: sendRequest.body.text,
    hasIdempotencyKey: typeof sendRequest.body.idempotencyKey === "string",
  }, {
    subject: "Re: Terminbestätigung",
    text: "Dienstag passt uns gut.",
    hasIdempotencyKey: true,
  });
  assert.equal(sent, true);
  assert.equal(closed, true);
});

test("Inbox refresh reloads the current page and preserves the selected message", async (context) => {
  let listRequests = 0;
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/admin/inbox/status"))
      return Response.json({ data: { geminiEnabled: false } });
    if (url.includes("/api/admin/inbox/messages?page=")) {
      listRequests += 1;
      if (listRequests === 3)
        return Response.json({ error: { message: "Postfach nicht erreichbar" } }, { status: 503 });
      return Response.json({
        data: {
          messages: [{
            uid: 42, subject: listRequests === 1 ? "Vorher" : "Aktualisiert", from: null,
            date: "2026-11-14T10:00:00.000Z", unseen: false, attachmentCount: 0,
          }],
          pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
        },
      });
    }
    if (url.endsWith("/api/admin/inbox/messages/42"))
      return Response.json({
        data: {
          uid: 42, subject: "Ausgewählte Mail", from: null, to: [],
          date: "2026-11-14T10:00:00.000Z", unseen: false,
          attachmentCount: 0, text: "Vorschau", attachments: [],
        },
      });
    throw new Error(`Unexpected request: ${url}`);
  });
  const view = await mount(
    React.createElement(AdminNotifications, null,
      React.createElement(InboxPage, { navigate: () => {} })),
  );
  context.after(() => view.cleanup());
  await view.flush();
  const message = [...view.window.document.querySelectorAll('[role="button"]')]
    .find((button) => button.textContent?.includes("Vorher"));
  assert.ok(message);
  assert.equal([...view.window.document.querySelectorAll("button")].some((button) => button.textContent?.includes("Antwort")), false);
  await view.click(message);
  await view.flush();
  assert.ok([...view.window.document.querySelectorAll("button")].some((button) => button.textContent?.includes("Antwort")));
  const refresh = view.window.document.querySelector<HTMLButtonElement>(
    'button[aria-label="Posteingang aktualisieren"]',
  );
  assert.ok(refresh);
  await view.click(refresh);
  await view.flush();
  assert.equal(listRequests, 2);
  assert.ok(view.window.document.body.textContent?.includes("Aktualisiert"));
  assert.ok(view.window.document.body.textContent?.includes("Ausgewählte Mail"));
  assert.equal(view.window.document.querySelector('[aria-pressed="true"]')?.textContent?.includes("Aktualisiert"), true);
  await view.click(refresh);
  await view.flush();
  assert.equal(listRequests, 3);
  assert.ok(view.window.document.body.textContent?.includes("Postfach nicht erreichbar"));
  assert.equal(refresh.disabled, false);
  await view.click(refresh);
  await view.flush();
  assert.equal(listRequests, 4);
  assert.ok(!view.window.document.body.textContent?.includes("Postfach nicht erreichbar"));
});

test("Inbox displays image attachments inline and preserves attachment links", async (context) => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/admin/inbox/status"))
      return Response.json({ data: { geminiEnabled: false } });
    if (url.includes("/api/admin/inbox/messages?page="))
      return Response.json({
        data: {
          messages: [{
            uid: 42, subject: "Fotos", from: null,
            date: "2026-11-14T10:00:00.000Z", unseen: false, attachmentCount: 2,
          }],
          pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
        },
      });
    if (url.endsWith("/api/admin/inbox/messages/42"))
      return Response.json({
        data: {
          uid: 42, subject: "Fotos", from: null, to: [],
          date: "2026-11-14T10:00:00.000Z", unseen: false,
          attachmentCount: 2, text: "Bilder", attachments: [
            { id: "image/1", filename: "foto.jpg", contentType: "image/jpeg", sizeBytes: 1024, inline: false },
            { id: "pdf", filename: "liste.pdf", contentType: "application/pdf", sizeBytes: 1024, inline: false },
            { id: "logo", filename: "logo.png", contentType: "image/png", sizeBytes: 100, inline: true },
          ],
        },
      });
    throw new Error(`Unexpected request: ${url}`);
  });
  const view = await mount(
    React.createElement(AdminNotifications, null,
      React.createElement(InboxPage, { navigate: () => {} })),
  );
  context.after(() => view.cleanup());
  await view.flush();
  const message = [...view.window.document.querySelectorAll('[role="button"]')]
    .find((button) => button.textContent?.includes("Fotos"));
  assert.ok(message);
  await view.click(message);
  await view.flush();
  const image = view.window.document.querySelector<HTMLImageElement>('img[alt="foto.jpg"]');
  assert.ok(image);
  assert.equal(image.getAttribute("src"), "/api/admin/inbox/messages/42/attachments/image%2F1");
  assert.equal(view.window.document.querySelector('img[alt="logo.png"]'), null);
  assert.ok(view.window.document.querySelector('a[href="/api/admin/inbox/messages/42/attachments/pdf"]'));
  await React.act(async () => {
    image.dispatchEvent(new view.window.Event("error"));
  });
  await view.flush();
  assert.ok(view.window.document.body.textContent?.includes("Bildvorschau konnte nicht geladen werden: foto.jpg"));
  assert.ok(view.window.document.querySelector('a[href="/api/admin/inbox/messages/42/attachments/image%2F1"]'));
});

test("Inbox draft shows disabled actions until an order is saved", async (context) => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/admin/inbox/status"))
      return Response.json({ data: { geminiEnabled: true } });
    if (url.includes("/api/admin/inbox/messages?page="))
      return Response.json({
        data: {
          messages: [{
            uid: 42, subject: "Anfrage", from: null,
            date: "2026-11-14T10:00:00.000Z", unseen: false, attachmentCount: 0,
          }],
          pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
        },
      });
    if (url.endsWith("/api/admin/inbox/messages/42"))
      return Response.json({
        data: {
          uid: 42, subject: "Anfrage", from: null, to: [],
          date: "2026-11-14T10:00:00.000Z", unseen: false,
          attachmentCount: 0, text: "Anfrage", attachments: [],
        },
      });
    if (url.endsWith("/api/admin/inbox/messages/42/analyze"))
      return Response.json({
        data: {
          draft: {
            customer: { firstName: "", lastName: "", email: "", phone: "" },
            from: {}, to: {}, note: "",
            furniture: { items: [], volume: 0, volumeComplete: true },
          },
          unmatchedFurniture: [], skippedAttachments: [], filledFields: [],
        },
      });
    if (url === "/api/admin/routes/config")
      return Response.json({ data: { origin: null, available: false } });
    return Response.json({ data: [] });
  });
  const view = await mount(
    React.createElement(AdminNotifications, null,
      React.createElement(InboxPage, { navigate: () => {} })),
  );
  context.after(() => view.cleanup());
  await view.flush();
  const message = [...view.window.document.querySelectorAll('[role="button"]')]
    .find((button) => button.textContent?.includes("Anfrage"));
  assert.ok(message);
  await view.click(message);
  await view.flush();
  const generate = [...view.window.document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "Generieren");
  assert.ok(generate);
  await view.click(generate);
  await view.flush();
  for (const [label, disabled] of [
    ["Auftrag speichern", false],
    ["Angebotskopie anlegen", true],
    ["PDF erzeugen", true],
    ["Angebot versenden", true],
  ] as const) {
    const button = view.window.document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    assert.ok(button, label);
    assert.equal(button.disabled, disabled, label);
  }
});

test("Inbox links a selected email to an existing order and opens its editor", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    requests.push({ url, method, ...(body ? { body } : {}) });
    if (url.endsWith("/api/admin/inbox/status"))
      return Response.json({ data: { geminiEnabled: true } });
    if (url.includes("/api/admin/inbox/messages?page="))
      return Response.json({
        data: {
          messages: [{
            uid: 42,
            subject: "Bestehende Anfrage",
            from: { name: "Kunde", address: "kunde@example.test" },
            date: "2026-11-14T10:00:00.000Z",
            unseen: false,
            attachmentCount: 0,
          }],
          pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
        },
      });
    if (url.endsWith("/api/admin/inbox/messages/42"))
      return Response.json({
        data: {
          uid: 42,
          subject: "Bestehende Anfrage",
          from: { name: "Kunde", address: "kunde@example.test" },
          to: [],
          date: "2026-11-14T10:00:00.000Z",
          unseen: false,
          attachmentCount: 0,
          text: "Bitte Angebot zum bestehenden Auftrag.",
          attachments: [],
        },
      });
    if (url.endsWith("/api/admin/inbox/messages/42/link-order"))
      return Response.json({ data: { linked: true } });
    if (url === "/api/admin/orders/1042/copy")
      return Response.json({ data: { orderNumber: 1043 } }, { status: 201 });
    if (url === "/api/admin/orders/1042" || url === "/api/admin/orders/1043")
      return Response.json({
        data: {
          orderNumber: Number(url.split("/").at(-1)),
          revision: 3,
          data: createEmptyOrder(),
          isCopy: false,
          hasSourceMail: true,
          archivedAt: null,
        },
      });
    if (url === "/api/admin/routes/config")
      return Response.json({ data: { origin: null, available: false } });
    if (url.endsWith("/family"))
      return Response.json({ data: { items: [] } });
    return Response.json({ data: [] });
  };

  const view = await mount(
    React.createElement(
      AdminNotifications,
      null,
      React.createElement(
        OrderEmailActionsContext.Provider,
        {
          value: {
            open: () => {},
            openForOrder: () => {},
            disabled: false,
          },
        },
        React.createElement(InboxPage, { navigate: () => {} }),
      ),
    ),
  );
  context.after(async () => {
    await view.cleanup();
    globalThis.fetch = originalFetch;
  });
  await view.flush();

  const messageButton = [...view.window.document.querySelectorAll('[role="button"]')].find(
    (button) => button.textContent?.includes("Bestehende Anfrage"),
  );
  assert.ok(messageButton);
  await view.click(messageButton);
  await view.flush();

  const orderNumber = view.window.document.querySelector<HTMLInputElement>(
    'input[type="text"]',
  );
  assert.ok(orderNumber);
  await view.input(orderNumber, "1042");
  const loadButton = view.window.document.querySelector<HTMLButtonElement>(
    'button[aria-label="Auftrag laden"]',
  );
  assert.ok(loadButton);
  await view.click(loadButton);
  await view.flush();

  assert.ok(view.window.document.body.textContent?.includes("Auftrag | 1042"));
  assert.ok(view.window.document.body.textContent?.includes("Kundendaten"));
  assert.equal(
    [...view.window.document.querySelectorAll("button")].some(
      (button) => button.textContent?.trim() === "Antworten",
    ),
    false,
  );
  assert.ok(requests.some((request) =>
    request.url.endsWith("/api/admin/inbox/messages/42/link-order") &&
    (request.body as { orderNumber?: number } | undefined)?.orderNumber === 1042,
  ));
  assert.ok(requests.some((request) => request.url === "/api/admin/orders/1042"));

  for (const label of ["Angebotskopie anlegen", "PDF erzeugen", "Angebot versenden"]) {
    const action = view.window.document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    assert.ok(action, label);
    assert.equal(action.disabled, false, label);
  }
  const copyButton = view.window.document.querySelector<HTMLButtonElement>(
    'button[aria-label="Angebotskopie anlegen"]',
  );
  assert.ok(copyButton);
  await view.click(copyButton);
  await view.flush();

  assert.ok(view.window.document.body.textContent?.includes("Auftrag | 1043"));
  assert.ok(requests.some((request) =>
    request.url === "/api/admin/orders/1042/copy" && request.method === "POST",
  ));
  assert.ok(requests.some((request) =>
    request.url.endsWith("/api/admin/inbox/messages/42/link-order") &&
    (request.body as { orderNumber?: number } | undefined)?.orderNumber === 1043,
  ));
  const firstName = [...view.window.document.querySelectorAll("input")]
    .find((input) => input.labels?.[0]?.textContent?.includes("Vorname"));
  assert.ok(firstName);
  await view.input(firstName, "Änderung");
  await view.flush();
  for (const label of ["Angebotskopie anlegen", "PDF erzeugen", "Angebot versenden"]) {
    const action = view.window.document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    assert.ok(action, label);
    assert.equal(action.disabled, true, label);
  }
  assert.ok(requests.some((request) => request.url === "/api/admin/orders/1043"));
});
