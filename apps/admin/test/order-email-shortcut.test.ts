import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { AdminShell } from "../src/components/AdminShell.js";
import {
  OrderEmailActionsContext,
  useOrderEmailActions,
} from "../src/email/order-email-actions.js";
import { CustomerFields } from "../src/orders/CustomerFields.js";
import { CustomerTab } from "../src/orders/CustomerTab.js";
import { createEmptyOrder } from "../src/orders/order-form-types.js";
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
    if (init?.method === "POST") {
      sendBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({ data: { status: "SENT" } });
    }
    return Response.json({
      data: {
        to: "kunde@example.test",
        subject: "Angebot",
        contentHtml: "<p>Angebot</p><p></p><blockquote>Originalmail</blockquote>",
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
    "/api/admin/orders/1014/email-draft?kind=offer&reply=1",
    "/api/admin/orders/1014/emails",
  ]);
  assert.equal(sendBody?.replyToSourceMail, true);
  assert.equal(sendBody?.simpleSignature, true);
  assert.match(String(sendBody?.contentHtml), /<blockquote><p>Originalmail<\/p><\/blockquote>/u);
});
