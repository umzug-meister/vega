import assert from "node:assert/strict";
import test from "node:test";
import {
  emailDefaults,
  htmlToPlainText,
  passwordResetEmail,
  renderEmailLayout,
  renderReplyEmail,
  sanitizeEmailHtml,
} from "../src/mail/email-template.js";
import {
  HOSTINGER_MAIL_TIMEOUT_MS,
  HostingerMailClient,
  MailDeliveryError,
} from "../src/mail/hostinger-mail-client.js";
import { MailService } from "../src/mail/mail-service.js";
import { EMPTY_SETTINGS } from "../src/settings/settings-input.js";

test("mail service keeps the established branded shell and derives plain text", async () => {
  const sent: unknown[] = [];
  const service = new MailService({
    send: async (message) => {
      sent.push(message);
    },
  });
  const draft = {
    subject: "📦 Umzugsangebot zu Ihrer Anfrage 1042",
    contentHtml: "<p>Vielen Dank für Ihre Anfrage.</p>",
  };
  await service.send({
    kind: "OFFER",
    to: [" Kunde@Example.test ", "kunde@example.test"],
    ...draft,
  });

  assert.equal(sent.length, 1);
  const message = sent[0] as {
    to: string[];
    html: string;
    text: string;
    subject: string;
  };
  assert.deepEqual(message.to, ["kunde@example.test"]);
  assert.equal(message.subject, "📦 Umzugsangebot zu Ihrer Anfrage 1042");
  assert.match(message.html, /Logo-147\.svg/);
  assert.match(message.html, /Ihr Umzug Ruck Zuck Team/);
  assert.match(message.html, /href="tel:\+4917610171990">\+49 176 101 719 90/u);
  assert.match(message.html, /href="tel:\+498930642972">\+49 89 306 429 72/u);
  assert.match(message.html, /href="https:\/\/umzugruckzuck\.de\/"/u);
  assert.match(message.text, /Vielen Dank für Ihre Anfrage/);
});

test("inbox replies use the simple signed layout and preserve To/Cc threading", async () => {
  const sent: unknown[] = [];
  const service = new MailService({ send: async (message) => { sent.push(message); } });
  await service.send({
    kind: "INBOX_REPLY",
    to: ["sender@example.test"],
    cc: ["colleague@example.test"],
    subject: "Re: Umzug",
    contentHtml: '<p>Ich bestätige den Termin.</p><blockquote style="margin-left:24px;padding-left:12px;border-left:2px solid #cccccc">Original</blockquote>',
    replyToMailUid: 42,
    signatureName: "Alexander Berent",
    signatureColor: "#28527A",
  });

  const message = sent[0] as {
    to: string[];
    cc?: string[];
    html: string;
    text: string;
    replyToMailUid?: number;
  };
  assert.deepEqual(message.to, ["sender@example.test"]);
  assert.deepEqual(message.cc, ["colleague@example.test"]);
  assert.equal(message.replyToMailUid, 42);
  assert.match(message.html, /Ich bestätige den Termin/u);
  assert.match(message.html, /style="color:#28527A"/u);
  assert.ok(message.html.indexOf("Freundliche Grüße") < message.html.indexOf("<blockquote"));
  assert.ok(message.html.indexOf("<p>--</p>") < message.html.indexOf("Freundliche Grüße"));
  assert.match(message.html, /Freundliche Grüße,<br>Alexander Berent<br>Ihr Umzug Ruck Zuck Team/u);
  assert.match(message.html, /href="tel:\+4917610171990">\+49 176 101 719 90/u);
  assert.match(message.html, /href="tel:\+498930642972">\+49 89 306 429 72/u);
  assert.match(message.html, /umzugruckzuck\.de/u);
  assert.doesNotMatch(message.html, /Logo-147\.svg|class="container"/u);
  assert.match(message.text, /Alexander Berent/u);
  assert.match(message.text, /umzugruckzuck\.de/u);
});

test("inbox-originated offers keep the offer body but use the simple signature", async () => {
  const sent: unknown[] = [];
  const service = new MailService({ send: async (message) => { sent.push(message); } });
  await service.send({
    kind: "INBOX_OFFER",
    to: ["customer@example.test"],
    subject: "Angebot",
    contentHtml: '<p>Ihr Angebot für Montag.</p><blockquote style="margin-left:24px;padding-left:12px;border-left:2px solid #cccccc">Original</blockquote>',
    signatureName: "Alexander Berent",
    signatureColor: "#CB722F",
  });
  const message = sent[0] as { html: string; text: string };
  assert.match(message.html, /Ihr Angebot für Montag/u);
  assert.match(message.html, /Freundliche Grüße,<br>Alexander Berent<br>Ihr Umzug Ruck Zuck Team/u);
  assert.match(message.html, /style="color:#CB722F"/u);
  assert.ok(message.html.indexOf("Freundliche Grüße") < message.html.indexOf("<blockquote"));
  assert.ok(message.html.indexOf("<p>--</p>") < message.html.indexOf("Freundliche Grüße"));
  assert.match(message.text, /--[\s\S]*Freundliche Grüße[\s\S]*Original/u);
  assert.match(message.html, /tel:\+4917610171990/u);
  assert.doesNotMatch(message.html, /Logo-147\.svg|class="container"/u);
});

test("inbox reply without a saved signature uses the team greeting only", () => {
  const html = renderReplyEmail(
    '<p>Danke.</p><blockquote style="margin-left:24px;padding-left:12px;border-left:2px solid #cccccc">Original</blockquote>',
    null,
  );
  assert.match(html, /Freundliche Grüße,<br>Ihr Umzug Ruck Zuck Team\./u);
  assert.ok(html.indexOf("<p>--</p>") < html.indexOf("Freundliche Grüße"));
  assert.ok(html.indexOf("Freundliche Grüße") < html.indexOf("<blockquote"));
  assert.match(html, /<blockquote style="margin-left:24px;padding-left:12px;border-left:2px solid #cccccc">Original<\/blockquote>/u);
  assert.match(html, /href="tel:\+4917610171990">\+49 176 101 719 90/u);
  assert.match(html, /href="tel:\+498930642972">\+49 89 306 429 72/u);
  assert.doesNotMatch(html, /root_user|undefined|null/u);
});

test("password reset link is escaped in the retained email shell", () => {
  const draft = passwordResetEmail(
    'https://vega.example/reset?token=a&next="bad"',
  );
  const html = renderEmailLayout(draft.contentHtml);
  assert.match(html, /token=a&amp;next=&quot;bad&quot;/);
  assert.doesNotMatch(html, /next="bad"/);
  assert.ok(
    draft.text.includes('https://vega.example/reset?token=a&next="bad"'),
  );
});

test("editable email content keeps basic formatting but removes executable and unsafe markup", () => {
  const html = sanitizeEmailHtml(
    '<p onclick="alert(1)">Text <strong>fett</strong><script>alert(1)</script><a href="javascript:alert(1)">Link</a><a href="https://example.test">OK</a></p>',
  );
  assert.equal(
    html,
    '<p>Text <strong>fett</strong><a>Link</a><a href="https://example.test">OK</a></p>',
  );
});

test("editable email content resists nested tags, comments, encoded links, and event attributes", () => {
  const html = sanitizeEmailHtml(
    "<!-- geheim --><style>p{color:red}</style><scr<script>ipt>alert(1)</scr<script>ipt>" +
      '<p style="color:red" onmouseover="x()">Text</p>' +
      '<p><a href="JaVaScRiPt:alert(1)">bad</a>' +
      '<a href="//evil.test/x">rel</a>' +
      '<a href="https://example.test/?q=a&amp;b">OK</a></p>' +
      '<iframe src="https://evil.test"></iframe><form><input value="x"></form>',
  );
  assert.doesNotMatch(html, /<!--/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<style/i);
  assert.doesNotMatch(html, /<iframe/i);
  assert.doesNotMatch(html, /<form/i);
  assert.doesNotMatch(html, /<input/i);
  assert.doesNotMatch(html, /onclick|onmouseover/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /evil\.test/);
  // Nested-tag leftovers may survive only as escaped text, never as markup.
  assert.doesNotMatch(html, /<[^>]*script/i);
  assert.match(html, /<p>Text<\/p>/);
  assert.match(html, /<a href="https:\/\/example\.test\/\?q=a&amp;b">OK<\/a>/);
  const doubleEncoded = sanitizeEmailHtml(
    "<p>&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</p>",
  );
  assert.doesNotMatch(doubleEncoded, /<script/i);
  assert.doesNotMatch(doubleEncoded, /alert\(1\)<\/script/i);
});

test("email plain text drops executable markup and contains no HTML tags", () => {
  const text = htmlToPlainText(
    '<script>alert(1)</script><!-- c --><p>Hello<br>World</p><p><a href="https://example.test">Link</a></p>',
  );
  assert.doesNotMatch(text, /</);
  assert.doesNotMatch(text, />/);
  assert.doesNotMatch(text, /alert\(1\)/);
  assert.match(text, /Hello/);
  assert.match(text, /World/);
});

test("Hostinger client uses the documented 204 send response and does not read its body", async () => {
  assert.equal(HOSTINGER_MAIL_TIMEOUT_MS, 30_000);
  let request: Request | undefined;
  const client = new HostingerMailClient(
    {
      apiToken: "test-token",
      mailboxResourceId: "mailbox/with slash",
      apiBaseUrl: new URL("https://mail.example.test"),
    },
    async (input, init) => {
      request = new Request(input, init);
      return new Response(null, { status: 204 });
    },
  );
  await client.send({
    to: ["customer@example.test"],
    cc: ["colleague@example.test"],
    subject: "Test",
    html: "<p>Test</p>",
    text: "Test",
    replyToMailUid: 42,
  });
  assert.equal(
    request?.url,
    "https://mail.example.test/api/v1/mailboxes/mailbox%2Fwith%20slash/send",
  );
  assert.equal(request?.headers.get("authorization"), "Bearer test-token");
  assert.deepEqual(await request?.json(), {
    to: ["customer@example.test"],
    cc: ["colleague@example.test"],
    subject: "Test",
    html: "<p>Test</p>",
    text: "Test",
    inReplyTo: { uid: 42, folder: "INBOX" },
  });
});

test("Hostinger client classifies provider errors without retaining an error body", async () => {
  const client = new HostingerMailClient(
    {
      apiToken: "test-token",
      mailboxResourceId: "mailbox",
      apiBaseUrl: new URL("https://mail.example.test"),
    },
    async () =>
      new Response(
        JSON.stringify({ error: { code: "ERR_INVALID_RECIPIENT" } }),
        { status: 422 },
      ),
  );
  await assert.rejects(
    () =>
      client.send({
        to: ["customer@example.test"],
        subject: "Test",
        html: "<p>Test</p>",
        text: "Test",
      }),
    (error: unknown) =>
      error instanceof MailDeliveryError &&
      error.code === "ERR_INVALID_RECIPIENT" &&
      !error.retryable,
  );
});

test("Hostinger send network loss, timeout and upstream failures are ambiguous, not retryable", async () => {
  const config = {
    apiToken: "test-token",
    mailboxResourceId: "mailbox",
    apiBaseUrl: new URL("https://mail.example.test"),
  };
  const message = {
    to: ["customer@example.test"],
    subject: "Test",
    html: "<p>Test</p>",
    text: "Test",
  };
  for (const status of [500, 502, 504, 200]) {
    const client = new HostingerMailClient(config, async () =>
      Response.json({ code: "ERR_GATEWAY_TIMEOUT" }, { status }),
    );
    await assert.rejects(
      client.send(message),
      (error: unknown) =>
        error instanceof MailDeliveryError &&
        error.outcome === "UNKNOWN" &&
        !error.retryable,
    );
  }
  const network = new HostingerMailClient(config, async () => {
    throw new TypeError("connection lost");
  });
  await assert.rejects(
    network.send(message),
    (error: unknown) =>
      error instanceof MailDeliveryError &&
      error.code === "MAIL_NETWORK_ERROR" &&
      error.outcome === "UNKNOWN" &&
      !error.retryable,
  );
  const timeout = new HostingerMailClient(
    config,
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
    1,
  );
  await assert.rejects(
    timeout.send(message),
    (error: unknown) =>
      error instanceof MailDeliveryError &&
      error.code === "MAIL_TIMEOUT" &&
      error.outcome === "UNKNOWN" &&
      !error.retryable,
  );
});

test("preflight failures are known not sent, rate limits can retry and rejections cannot", async () => {
  const config = {
    apiToken: "test-token",
    mailboxResourceId: "mailbox",
    apiBaseUrl: new URL("https://mail.example.test"),
  };
  const message = {
    to: ["customer@example.test"],
    subject: "Test",
    html: "<p>Test</p>",
    text: "Test",
  };
  for (const status of [401, 403, 422, 429]) {
    const client = new HostingerMailClient(config, async () =>
      Response.json({ code: "ERR_REJECTED" }, { status }),
    );
    await assert.rejects(
      client.send(message),
      (error: unknown) =>
        error instanceof MailDeliveryError &&
        error.outcome === "NOT_SENT" &&
        error.retryable === (status === 429),
    );
  }
  let requests = 0;
  const preflight = new HostingerMailClient(config, async () => {
    requests++;
    throw new TypeError("connection lost");
  });
  await assert.rejects(
    preflight.send({ ...message, expectedFromAddress: "sender@example.test" }),
    (error: unknown) =>
      error instanceof MailDeliveryError &&
      error.outcome === "NOT_SENT" &&
      error.retryable,
  );
  assert.equal(requests, 1);
});

test("stored sender settings are used by all server mail flows", async () => {
  const sent: Array<{ displayName?: string; expectedFromAddress?: string }> =
    [];
  const service = new MailService(
    {
      send: async (message) => {
        sent.push(message);
      },
    },
    async () => ({
      ...EMPTY_SETTINGS,
      emailFromName: "Testbetrieb",
      emailFromAddress: "sender@example.test",
    }),
  );
  await service.send({
    kind: "INQUIRY_RECEIVED",
    to: ["customer@example.test"],
    ...emailDefaults.inquiryReceived("Ada", 1042),
  });
  assert.equal(sent[0]?.displayName, "Testbetrieb");
  assert.equal(sent[0]?.expectedFromAddress, "sender@example.test");
});

test("company inquiry notification links the order and the customer's form email for a direct reply", () => {
  const draft = emailDefaults.inquiryNotification(
    "Firma & Co",
    1014,
    new URL("https://runtime.example.test/"),
    " kunde@example.test ",
  );
  assert.equal(draft.subject, "Neue Umzugsanfrage 1014");
  assert.match(draft.contentHtml, /Antworten an den Kunden/u);
  const sanitized = sanitizeEmailHtml(draft.contentHtml);
  assert.match(
    sanitized,
    /<a href="https:\/\/runtime\.example\.test\/edit\/1014">Auftrag in Vega öffnen<\/a>/u,
  );
  assert.match(
    sanitized,
    /<a href="mailto:kunde@example\.test\?subject=Ihre%20Umzugsanfrage%201014">kunde@example\.test<\/a>/u,
  );
  // No form address (e.g. admin-created order): no reply link is invented.
  const withoutEmail = sanitizeEmailHtml(
    emailDefaults.inquiryNotification("Ada", 1014, new URL("https://runtime.example.test/")).contentHtml,
  );
  assert.doesNotMatch(withoutEmail, /Antworten an den Kunden|mailto:/u);
  // The plain-text alternative shows the address once, without the mailto target.
  const text = htmlToPlainText(draft.contentHtml);
  assert.match(text, /https:\/\/runtime\.example\.test\/edit\/1014/u);
  assert.match(text, /Antworten an den Kunden: kunde@example\.test/u);
  assert.doesNotMatch(text, /subject=/u);
  assert.doesNotMatch(emailDefaults.inquiryReceived("Ada", 1014).contentHtml, /\/edit\/|Auftrag in Vega öffnen/u);
});

test("configured sender address must match the actual Hostinger mailbox and is not sent as an unsupported from field", async () => {
  const calls: Request[] = [];
  const client = new HostingerMailClient(
    {
      apiToken: "test-token",
      mailboxResourceId: "mailbox",
      apiBaseUrl: new URL("https://mail.example.test"),
    },
    async (url, init) => {
      const request = new Request(url, init);
      calls.push(request);
      return request.url.endsWith("/me")
        ? Response.json({
            data: {
              mailboxes: [
                { resourceId: "mailbox", address: "sender@example.test" },
              ],
            },
          })
        : new Response(null, { status: 204 });
    },
  );
  const message = {
    to: ["customer@example.test"],
    subject: "Test",
    html: "<p>Test</p>",
    text: "Test",
    expectedFromAddress: "sender@example.test",
  };
  await client.send(message);
  assert.equal(calls.length, 2);
  const body = await calls[1]!.json();
  assert.equal("expectedFromAddress" in body, false);
  assert.equal("from" in body, false);
  await assert.rejects(
    client.send({ ...message, expectedFromAddress: "wrong@example.test" }),
    (error: unknown) =>
      error instanceof MailDeliveryError &&
      error.code === "MAIL_SENDER_ADDRESS_MISMATCH",
  );
  assert.equal(calls.length, 3);
});
