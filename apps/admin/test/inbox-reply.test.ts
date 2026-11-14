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
  assert.ok(requests.some((request) => request.url === "/api/admin/orders/1043"));
});
