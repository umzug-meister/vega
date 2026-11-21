import assert from "node:assert/strict";
import test from "node:test";
import { createElement, useState } from "react";
import { AdminShell } from "../src/components/AdminShell.js";
import {
  OrderEmailActionsContext,
  useOrderEmailActions,
} from "../src/email/order-email-actions.js";
import { CustomerFields } from "../src/orders/CustomerFields.js";
import { CustomerTab } from "../src/orders/CustomerTab.js";
import { createEmptyOrder } from "../src/orders/order-form-types.js";
import { OrderCreatePage } from "../src/orders/OrderCreatePage.js";
import { resolveAdminRoute } from "../src/routes.js";
import type { StaffUser } from "../src/types.js";
import { mount } from "./dom-test-helpers.js";

const admin: StaffUser = {
  id: "staff",
  name: "Test",
  email: "staff@example.test",
  role: "Admin",
  twoFactorEnabled: true,
  mustChangePassword: false,
  blocked: false,
};

test("customer tab mail icon opens a blank mail for the saved order", async (context) => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json({
      data: {
        to: "kunde@example.test",
        subject: "",
        contentHtml: "",
        attachmentNames: [],
      },
    });
  };
  const route = resolveAdminRoute("/edit/1014");
  assert.ok(route);
  const dom = await mount(
    createElement(AdminShell, {
      user: admin,
      route,
      pathname: route.path,
      navigate: () => {},
      children: createElement(CustomerTab, {
        value: {
          ...createEmptyOrder(),
          customer: { ...createEmptyOrder().customer, email: "kunde@example.test" },
        },
        update: () => {},
      }),
    }),
    "/edit/1014",
  );
  context.after(async () => {
    await dom.cleanup();
    globalThis.fetch = originalFetch;
  });
  await dom.flush();
  const document = dom.window.document;
  const icon = document.querySelector<HTMLButtonElement>(
    'button[aria-label="E-Mail an den Kunden öffnen"]',
  );
  assert.ok(icon, "mail icon missing");
  assert.equal(icon.disabled, false);

  await dom.click(icon);
  await dom.flush();
  assert.match(document.body.textContent ?? "", /E-Mail versenden/u);
  assert.deepEqual(urls, ["/api/admin/orders/1014/email-draft?kind=message"]);
  assert.equal(
    document.querySelector<HTMLInputElement>('input[type="email"]')?.value,
    "kunde@example.test",
  );
  const subject = [...document.querySelectorAll<HTMLInputElement>("input")].find(
    (input) =>
      input.closest(".MuiFormControl-root")?.textContent?.includes("Betreff"),
  );
  assert.ok(subject, "subject field missing");
  assert.equal(subject.value, "");
  assert.equal(document.querySelectorAll(".MuiChip-root").length, 0);
});

test("the mail icon is disabled with unsaved changes and without a shell", async (context) => {
  const value = createEmptyOrder().customer;
  const dom = await mount(
    createElement(
      OrderEmailActionsContext.Provider,
      { value: { open: () => {}, disabled: true } },
      createElement(CustomerFields, { value, onChange: () => {} }),
    ),
  );
  context.after(() => dom.cleanup());
  await dom.flush();
  assert.equal(
    dom.window.document.querySelector<HTMLButtonElement>(
      'button[aria-label="E-Mail an den Kunden öffnen"]',
    )?.disabled,
    true,
  );

  const standalone = await mount(
    createElement(CustomerFields, { value, onChange: () => {} }),
  );
  context.after(() => standalone.cleanup());
  await standalone.flush();
  assert.equal(
    standalone.window.document.querySelector<HTMLButtonElement>(
      'button[aria-label="E-Mail an den Kunden öffnen"]',
    )?.disabled,
    true,
  );
});

test("Inbox can open a saved-order offer outside the order editor", async (context) => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  let sendBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    if (String(url) === "/api/admin/orders/1014")
      return Response.json({ data: { pdfFilename: "Mein Angebot.pdf", revision: 1 } });
    if (init?.method === "POST") {
      sendBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({ data: { status: "SENT" } });
    }
    return Response.json({
      data: {
        to: "kunde@example.test",
        subject: "Angebot",
        contentHtml: '<p>Im Anhang finden Sie den Auftrag.</p><p><strong><span style="color:#28527a">Bitte antworten:</span></strong></p><ul><li><p><strong><span style="color:#28527a">Telefonnummer</span></strong></p></li></ul><p></p><blockquote>Originalmail</blockquote>',
        attachmentNames: [],
      },
    });

  };
  const route = resolveAdminRoute("/inbox");
  assert.ok(route);
  function InboxOfferButton() {
    const actions = useOrderEmailActions();
    return createElement(
      "button",
      { onClick: () => actions?.openForOrder(1014, "offer", true, true) },
      "Angebot öffnen",
    );
  }
  const dom = await mount(
    createElement(AdminShell, {
      user: admin,
      route,
      pathname: route.path,
      navigate: () => {},
      orderDirty: true,
      children: createElement(InboxOfferButton),
    }),
    "/inbox",
  );
  context.after(async () => {
    await dom.cleanup();
    globalThis.fetch = originalFetch;
  });
  await dom.flush();

  const button = [...dom.window.document.querySelectorAll("button")].find(
    (item) => item.textContent === "Angebot öffnen",
  );
  assert.ok(button);
  await dom.click(button);
  await dom.flush();

  assert.ok(dom.window.document.body.textContent?.includes("Angebot versenden"));
  assert.ok(dom.window.document.body.textContent?.includes("Originalmail"));
  const send = [...dom.window.document.querySelectorAll("button")].find(
    (item) => item.textContent?.includes("Senden"),
  );
  assert.ok(send);
  await dom.click(send);
  await dom.flush();

  assert.deepEqual(urls, [
    "/api/admin/orders/1014",
    "/api/admin/orders/1014/email-draft?kind=offer&reply=1",
    "/api/admin/orders/1014/emails",
  ]);
  assert.equal(sendBody?.replyToSourceMail, true);
  assert.equal(sendBody?.simpleSignature, true);
  assert.match(String(sendBody?.contentHtml), /<span style="color: rgb\(40, 82, 122\);"><strong>Bitte antworten:<\/strong><\/span>/u);
  assert.match(String(sendBody?.contentHtml), /<span style="color: rgb\(40, 82, 122\);"><strong>Telefonnummer<\/strong><\/span>/u);
  assert.match(String(sendBody?.contentHtml), /<blockquote><p>Originalmail<\/p><\/blockquote>/u);
});

test("offer mail asks for a filename before loading the mail dialog and cancellation stops it", async (context) => {
  const urls: string[] = [];
  let filename: string | null = null;
  context.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    const path = String(url);
    urls.push(path);
    if (path.endsWith("/pdf-filename")) {
      const body = JSON.parse(String(init?.body)) as { filename: string; revision: number };
      assert.deepEqual(body, { filename: "Mein Mailangebot", revision: 7 });
      filename = "Mein Mailangebot.pdf";
      return Response.json({ data: { pdfFilename: filename } });
    }
    if (path === "/api/admin/orders/1014")
      return Response.json({ data: { pdfFilename: filename, defaultPdfFilename: "Standard_1014.pdf", revision: 7 } });
    assert.equal(path, "/api/admin/orders/1014/email-draft?kind=offer");
    assert.equal(filename, "Mein Mailangebot.pdf");
    return Response.json({ data: {
      to: "kunde@example.test", subject: "Angebot", contentHtml: "<p>Ihr Angebot.</p>",
      attachmentNames: [filename],
    } });
  });
  const route = resolveAdminRoute("/edit/1014");
  assert.ok(route);
  function OfferButton() {
    const actions = useOrderEmailActions();
    return createElement("button", { onClick: () => actions?.open("offer") }, "Angebot öffnen");
  }
  const dom = await mount(createElement(AdminShell, {
    user: admin, route, pathname: route.path, navigate: () => {}, children: createElement(OfferButton),
  }), route.path);
  context.after(() => dom.cleanup());
  const button = [...dom.container.querySelectorAll("button")].find((item) => item.textContent === "Angebot öffnen")!;
  const dialogButton = (label: string) => [...dom.window.document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === label)!;
  await dom.click(button);
  await dom.flush();
  assert.deepEqual(urls, ["/api/admin/orders/1014"]);
  assert.equal(dom.window.document.querySelector<HTMLInputElement>('[role="dialog"] input')?.value, "Standard_1014");
  await dom.click(dialogButton("Abbrechen"));
  await dom.flush();
  assert.equal(filename, null);
  assert.equal(urls.length, 1);
  await dom.click(button);
  await dom.flush();
  await dom.input(dom.window.document.querySelector('[role="dialog"] input')!, "Mein Mailangebot");
  await dom.click(dialogButton("OK"));
  await dom.flush();
  assert.deepEqual(urls, [
    "/api/admin/orders/1014", "/api/admin/orders/1014",
    "/api/admin/orders/1014/pdf-filename", "/api/admin/orders/1014/email-draft?kind=offer",
  ]);
  assert.ok(dom.window.document.querySelector('[aria-labelledby="email-dialog-title"]')?.textContent?.includes("Mein Mailangebot.pdf"));
});

test("saved offer names appear in the navbar and its pencil reopens the dialog to rename without exporting", async (context) => {
  let filename: string | null = null;
  let downloads = 0;
  const writes: unknown[] = [];
  context.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/pdf-filename")) {
      const body = JSON.parse(String(init?.body)) as { filename: string; previousFilename?: string };
      writes.push(body);
      assert.equal(body.previousFilename ?? null, filename);
      filename = `${body.filename}.pdf`;
      return Response.json({ data: { pdfFilename: filename } });
    }
    if (path === "/api/admin/orders/1014")
      return Response.json({ data: {
        orderNumber: 1014, revision: 7, archivedAt: null, isCopy: false,
        pdfFilename: filename, defaultPdfFilename: "Standard_1014.pdf", data: createEmptyOrder(),
      } });
    if (path.endsWith("/pdf")) {
      downloads++;
      assert.ok(filename);
      return new Response("%PDF-test", { headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      } });
    }
    if (path === "/api/admin/routes/config")
      return Response.json({ data: { origin: null, available: false } });
    if (path.endsWith("/family")) return Response.json({ data: { items: [] } });
    return Response.json({ data: [] });
  });
  const route = resolveAdminRoute("/edit/1014");
  assert.ok(route);
  const editRoute = route;
  const navigate = () => {};
  function Editor() {
    const [name, setName] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(true);
    return createElement(AdminShell, {
      user: admin, route: editRoute, pathname: "/edit/1014", navigate,
      orderPdfFilename: name, onOrderPdfFilenameChange: setName,
      orderDirty: dirty, orderBusy: busy,
      children: createElement(OrderCreatePage, {
        orderNumber: 1014, navigate, dirty,
        onDirtyChange: setDirty, onBusyChange: setBusy, onPdfFilenameChange: setName,
      }),
    });
  }
  const dom = await mount(createElement(Editor), "/edit/1014");
  context.after(() => dom.cleanup());
  context.mock.method(dom.window.HTMLAnchorElement.prototype, "click", () => {});
  const previousButton = Object.getOwnPropertyDescriptor(globalThis, "HTMLButtonElement");
  Object.defineProperty(globalThis, "HTMLButtonElement", { configurable: true, value: dom.window.HTMLButtonElement });
  context.after(() => {
    if (previousButton) Object.defineProperty(globalThis, "HTMLButtonElement", previousButton);
    else Reflect.deleteProperty(globalThis, "HTMLButtonElement");
  });
  await dom.flush();
  const shownName = () => dom.container.querySelector('[aria-label="Angebotsname"]')?.textContent;
  const pencil = () => dom.container.querySelector('button[aria-label="Angebotsnamen bearbeiten"]')!;
  const dialog = () => [...dom.window.document.querySelectorAll('[role="dialog"]')].at(-1)!;
  const dialogButton = (label: string) => [...dialog().querySelectorAll("button")].find((item) => item.textContent === label)!;
  assert.equal(shownName(), undefined);
  await dom.click(dom.container.querySelector('button[aria-label="PDF erzeugen"]')!);
  await dom.flush();
  await dom.input(dialog().querySelector("input")!, "Mein Angebot");
  await dom.click(dialogButton("OK"));
  await dom.flush();
  assert.equal(shownName(), "Mein Angebot");
  assert.equal(downloads, 1);
  await dom.click(pencil());
  await dom.flush();
  assert.equal(dialog().querySelector<HTMLInputElement>("input")?.value, "Mein Angebot");
  await dom.input(dialog().querySelector("input")!, "Nicht speichern");
  await dom.click(dialogButton("Abbrechen"));
  await dom.flush();
  assert.equal(shownName(), "Mein Angebot");
  assert.equal(writes.length, 1);
  await dom.click(pencil());
  await dom.flush();
  await dom.input(dialog().querySelector("input")!, "Geändertes Angebot");
  await dom.click(dialogButton("OK"));
  await dom.flush();
  assert.equal(shownName(), "Geändertes Angebot");
  assert.deepEqual(writes, [
    { filename: "Mein Angebot", revision: 7 },
    { filename: "Geändertes Angebot", revision: 7, previousFilename: "Mein Angebot.pdf" },
  ]);
  assert.equal(downloads, 1);
  await dom.render(null);
  await dom.render(createElement(Editor));
  await dom.flush();
  assert.equal(shownName(), "Geändertes Angebot");
});
