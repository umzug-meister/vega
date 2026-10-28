import { mount } from "./dom-test-helpers.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, useState } from "react";
import { AdminNotifications } from "../src/components/AdminNotifications.js";
import { EmailDialog } from "../src/email/EmailDialog.js";

function button(document: Document, text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  );
  assert.ok(found, `button "${text}" missing`);
  return found;
}

const draft = {
  to: "customer@example.test",
  subject: "Original",
  contentHtml: "<p>Original</p>",
  attachmentNames: [],
};

test("a send exceeding 30 seconds warns, closes the dialog and keeps the attempt locked against duplicate sends", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  let closed = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method !== "POST") return Response.json({ data: draft });
    requests.push(JSON.parse(String(init.body)));
    return new Promise<Response>((resolve) => {
      setTimeout(
        () =>
          resolve(
            Response.json(
              {
                data: {
                  status: "UNKNOWN",
                  errorCode: "MAIL_TIMEOUT",
                  outboxId: "mail-timeout",
                },
              },
              { status: 202 },
            ),
          ),
        30,
      );
    });
  };
  const target = {
    type: "order" as const,
    orderNumber: 8010,
    kind: "offer" as const,
  };
  function TimeoutHarness() {
    const [open, setOpen] = useState(true);
    return createElement(
      AdminNotifications,
      null,
      open
        ? createElement(EmailDialog, {
            target,
            onClose: () => {
              closed++;
              setOpen(false);
            },
            timeoutMs: 10,
          })
        : createElement(
            "button",
            { onClick: () => setOpen(true) },
            "Dialog erneut öffnen",
          ),
    );
  }
  const dom = await mount(createElement(TimeoutHarness));
  context.after(async () => {
    await dom.cleanup();
    globalThis.fetch = originalFetch;
  });
  await dom.flush();
  await dom.click(button(dom.window.document, "Senden"));
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  await dom.flush();
  assert.equal(closed, 1);
  assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
  assert.match(
    dom.window.document.body.textContent ?? "",
    /länger als 30 Sekunden/u,
  );

  await dom.click(button(dom.window.document, "Dialog erneut öffnen"));
  await dom.flush();
  assert.equal(
    dom.window.document.querySelector<HTMLInputElement>('input[type="email"]')
      ?.disabled,
    true,
  );
  assert.equal(button(dom.window.document, "Status prüfen").disabled, false);
  assert.equal(requests.length, 1);
});

test("lost-response retry, busy, SENDING and UNKNOWN reuse one key and lock edits without claiming success", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  const urls: string[] = [];
  let rejectFirst: (reason: Error) => void = () => {};
  let closed = 0;
  let sent = 0;
  globalThis.fetch = async (url, init) => {
    if (init?.method !== "POST") return Response.json({ data: draft });
    urls.push(String(url));
    requests.push(JSON.parse(String(init.body)));
    if (requests.length === 1)
      return new Promise((_resolve, reject) => {
        rejectFirst = reject;
      });
    if (requests.length === 2)
      return Response.json(
        { data: { status: "SENDING", outboxId: "mail-1" } },
        { status: 202 },
      );
    if (requests.length === 3)
      return Response.json(
        {
          data: {
            status: "UNKNOWN",
            errorCode: "MAIL_TIMEOUT",
            outboxId: "mail-1",
          },
        },
        { status: 202 },
      );
    return Response.json({ data: { status: "SENT", outboxId: "mail-1" } });
  };
  const element = createElement(EmailDialog, {
    target: { type: "order", orderNumber: 8001, kind: "offer" },
    onClose: () => {
      closed++;
    },
    onSent: () => {
      sent++;
    },
  });
  const dom = await mount(element);
  context.after(async () => {
    await dom.cleanup();
    globalThis.fetch = originalFetch;
  });
  await dom.flush();
  await dom.click(button(dom.window.document, "Senden"));
  assert.equal(requests.length, 1);
  assert.equal(button(dom.window.document, "Wird gesendet …").disabled, true);
  await dom.click(button(dom.window.document, "Wird gesendet …"));
  assert.equal(requests.length, 1);
  rejectFirst(new TypeError("response lost"));
  await dom.flush();
  assert.match(
    dom.window.document.body.textContent ?? "",
    /Versandantwort fehlt/u,
  );
  assert.equal(
    dom.window.document.querySelector<HTMLInputElement>('input[type="email"]')
      ?.disabled,
    true,
  );
  await dom.click(button(dom.window.document, "Status prüfen"));
  assert.match(
    dom.window.document.body.textContent ?? "",
    /Versand läuft bereits/u,
  );
  assert.equal(closed, 0);
  assert.equal(sent, 0);
  await dom.click(button(dom.window.document, "Status prüfen"));
  assert.doesNotMatch(
    dom.window.document.body.textContent ?? "",
    /Versandausgang ist unklar|Versandreferenz:/u,
  );
  assert.equal(sent, 0);
  assert.equal(closed, 1);
  assert.equal(requests[0]!.idempotencyKey, requests[1]!.idempotencyKey);
  assert.equal(requests[1]!.idempotencyKey, requests[2]!.idempotencyKey);
  assert.deepEqual(requests[1], {
    idempotencyKey: requests[0]!.idempotencyKey,
  });
  assert.deepEqual(requests[2], {
    idempotencyKey: requests[0]!.idempotencyKey,
  });
  assert.ok(urls[1]!.endsWith("/emails/status"));
  assert.ok(urls[2]!.endsWith("/emails/status"));
  // Closing/reopening does not manufacture a fresh key for an uncertain send.
  await dom.render(null);
  await dom.render(
    createElement(EmailDialog, {
      target: { type: "order", orderNumber: 8001, kind: "decline" },
      onClose: () => {
        closed++;
      },
      onSent: () => {
        sent++;
      },
    }),
  );
  await dom.flush();
  assert.equal(
    dom.window.document.querySelector<HTMLInputElement>('input[type="email"]')
      ?.disabled,
    true,
  );
  await dom.click(button(dom.window.document, "Status prüfen"));
  assert.equal(requests[3]!.idempotencyKey, requests[0]!.idempotencyKey);
  assert.deepEqual(requests[3], {
    idempotencyKey: requests[0]!.idempotencyKey,
  });
  assert.equal(sent, 1);
  assert.equal(closed, 2);
});

test("remount after a request never reached the server cannot submit the replacement draft during a status check", async (context) => {
  const originalFetch = globalThis.fetch;
  const sends: Array<Record<string, unknown>> = [];
  const checks: Array<Record<string, unknown>> = [];
  let originalKey: unknown;
  let draftLoads = 0;
  let closed = 0;
  let accepted = 0;
  globalThis.fetch = async (url, init) => {
    if (init?.method !== "POST") {
      draftLoads++;
      return Response.json({
        data:
          draftLoads === 1
            ? draft
            : {
                ...draft,
                subject: "Neuer Serverentwurf",
                contentHtml: "<p>Anderer Text</p>",
              },
      });
    }
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (String(url).endsWith("/emails/status")) {
      checks.push(body);
      return Response.json({
        data: { status: "NOT_QUEUED", outboxId: "cancelled-old-key" },
      });
    }
    sends.push(body);
    if (sends.length === 1) {
      originalKey = body.idempotencyKey;
      throw new TypeError("request never reached server");
    }
    return Response.json({ data: { status: "SENT", outboxId: "new-mail" } });
  };
  const element = createElement(EmailDialog, {
    target: { type: "order", orderNumber: 8004, kind: "offer" },
    onClose: () => {
      closed++;
    },
    onSent: () => {
      accepted++;
    },
  });
  const dom = await mount(element);
  context.after(async () => {
    await dom.cleanup();
    globalThis.fetch = originalFetch;
  });
  await dom.flush();
  await dom.click(button(dom.window.document, "Senden"));
  await dom.render(null);
  await dom.render(element);
  await dom.flush();
  const replacement = [
    ...dom.window.document.querySelectorAll<HTMLInputElement>("input"),
  ].find((input) => input.value === "Neuer Serverentwurf");
  assert.ok(replacement?.disabled);
  await dom.click(button(dom.window.document, "Status prüfen"));
  assert.equal(sends.length, 1);
  assert.deepEqual(checks, [{ idempotencyKey: originalKey }]);
  assert.equal(closed, 0);
  assert.equal(accepted, 0);
  assert.match(
    dom.window.document.body.textContent ?? "",
    /ursprüngliche E-Mail wurde nicht eingereiht/u,
  );
  await dom.click(button(dom.window.document, "Neue E-Mail vorbereiten"));
  assert.equal(sends.length, 1);
  await dom.click(button(dom.window.document, "Senden"));
  assert.equal(sends.length, 2);
  assert.equal(sends[1]!.subject, "Neuer Serverentwurf");
  assert.notEqual(sends[1]!.idempotencyKey, originalKey);
  assert.equal(closed, 1);
  assert.equal(accepted, 1);
});

test("rich-text toolbar offers a text color palette and keeps colored text in the sent draft", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  const colored = {
    ...draft,
    contentHtml:
      '<p><span style="color: rgb(198, 40, 40)">Original</span></p>',
  };
  globalThis.fetch = async (_url, init) => {
    if (init?.method !== "POST") return Response.json({ data: colored });
    requests.push(JSON.parse(String(init.body)));
    return Response.json({ data: { status: "SENT", outboxId: "mail-color" } });
  };
  const dom = await mount(
    createElement(EmailDialog, {
      target: { type: "order", orderNumber: 8005, kind: "offer" },
      onClose: () => {},
    }),
  );
  context.after(async () => {
    await dom.cleanup();
    globalThis.fetch = originalFetch;
  });
  await dom.flush();
  const document = dom.window.document;
  const colorButton = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Textfarbe"]',
  );
  assert.ok(colorButton);
  assert.equal(document.querySelector('[aria-label="Rot"]'), null);
  await dom.click(colorButton);
  await dom.flush();
  assert.ok(
    document.querySelector('[role="group"][aria-label="Textfarbe wählen"]'),
  );
  for (const name of ["Schwarz", "Grau", "Rot", "Orange", "Grün", "Blau"])
    assert.ok(document.querySelector(`[aria-label="${name}"]`), `${name} missing`);
  assert.ok(
    document.querySelector<HTMLButtonElement>('[aria-label="Standardfarbe"]'),
  );
  await dom.click(button(document, "Senden"));
  assert.equal(requests.length, 1);
  assert.match(
    String(requests[0]!.contentHtml),
    /<span style="color: rgb\(198, 40, 40\);?">Original<\/span>/u,
  );
});

test("first-request validation errors permit correction without unlocking a previously uncertain send", async (context) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    init?.method === "POST"
      ? Response.json(
          {
            error: {
              code: "INVALID_EMAIL",
              message: "Bitte Empfänger prüfen.",
            },
          },
          { status: 400 },
        )
      : Response.json({ data: draft });
  const dom = await mount(
    createElement(EmailDialog, {
      target: { type: "order", orderNumber: 8003, kind: "offer" },
      onClose: () => {},
    }),
  );
  context.after(async () => {
    await dom.cleanup();
    globalThis.fetch = originalFetch;
  });
  await dom.flush();
  await dom.click(button(dom.window.document, "Senden"));
  assert.match(
    dom.window.document.body.textContent ?? "",
    /Bitte Empfänger prüfen/u,
  );
  assert.equal(
    dom.window.document.querySelector<HTMLInputElement>('input[type="email"]')
      ?.disabled,
    false,
  );
  await dom.click(button(dom.window.document, "Neue E-Mail vorbereiten"));
  assert.equal(button(dom.window.document, "Senden").disabled, false);
});

test("known rejection permits corrections but requires an explicit new-mail action before issuing another key", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_url, init) => {
    if (init?.method !== "POST") return Response.json({ data: draft });
    requests.push(JSON.parse(String(init.body)));
    return requests.length === 1
      ? Response.json(
          {
            data: {
              status: "FAILED",
              errorCode: "ERR_VALIDATION_FAILED",
              outboxId: "mail-2",
            },
          },
          { status: 502 },
        )
      : Response.json({ data: { status: "SENT", outboxId: "mail-3" } });
  };
  let closed = 0;
  const dom = await mount(
    createElement(EmailDialog, {
      target: { type: "order", orderNumber: 8002, kind: "decline" },
      onClose: () => {
        closed++;
      },
    }),
  );
  context.after(async () => {
    await dom.cleanup();
    globalThis.fetch = originalFetch;
  });
  await dom.flush();
  await dom.click(button(dom.window.document, "Senden"));
  assert.equal(closed, 0);
  assert.match(
    dom.window.document.body.textContent ?? "",
    /nicht gesendet \(ERR_VALIDATION_FAILED\)/u,
  );
  assert.equal(
    dom.window.document.querySelector<HTMLInputElement>('input[type="email"]')
      ?.disabled,
    false,
  );
  const subject = [
    ...dom.window.document.querySelectorAll<HTMLInputElement>("input"),
  ].find((input) => input.value === "Original");
  assert.ok(subject);
  await dom.input(subject, "Korrigierter Betreff");
  await dom.click(button(dom.window.document, "Neue E-Mail vorbereiten"));
  assert.equal(requests.length, 1);
  await dom.click(button(dom.window.document, "Senden"));
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0]!.idempotencyKey, requests[1]!.idempotencyKey);
  assert.equal(requests[1]!.subject, "Korrigierter Betreff");
  assert.equal(closed, 1);
});
