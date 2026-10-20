import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { AdminShell } from "../src/components/AdminShell.js";
import { OrderCreatePage } from "../src/orders/OrderCreatePage.js";
import { AppointmentFields } from "../src/orders/AppointmentFields.js";
import {
  calculateConditionAmount,
  ConditionsTab,
  mergeCalculatedConditions,
} from "../src/orders/ConditionsTab.js";
import { createEmptyOrder } from "../src/orders/order-form-types.js";
import { resolveAdminRoute } from "../src/routes.js";
import type { StaffUser } from "../src/types.js";
import { mount } from "./dom-test-helpers.js";

function render(element: React.ReactElement) {
  const previous = Reflect.get(globalThis, "React");
  Reflect.set(globalThis, "React", React);
  try {
    return renderToStaticMarkup(element);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "React");
    else Reflect.set(globalThis, "React", previous);
  }
}

function toolbar(role: StaffUser["role"]) {
  const route = resolveAdminRoute("/edit/1004");
  assert.ok(route);
  return render(
    createElement(AdminShell, {
      user: {
        id: "test",
        name: "Test",
        email: "test@example.test",
        role,
        twoFactorEnabled: true,
        mustChangePassword: false,
        blocked: false,
      },
      route,
      pathname: "/edit/1004",
      navigate: () => {},
      children: null,
    }),
  );
}

test("only admins can create an invoice from the saved order", () => {
  const html = toolbar("Admin");
  const header = html.slice(0, html.indexOf("</header>"));
  const invoiceButton = header.match(
    /<button\b[^>]*aria-label="Rechnung aus Auftrag anlegen"[^>]*>/u,
  )?.[0];
  assert.ok(invoiceButton);
  for (const attribute of [
    'form="order-create-form"',
    'name="action"',
    'value="invoice"',
  ])
    assert.ok(invoiceButton.includes(attribute));
  assert.ok(
    !toolbar("Kundenberater").includes(
      'aria-label="Rechnung aus Auftrag anlegen"',
    ),
  );
});

test("content submenu highlights only the selected child route", () => {
  const route = resolveAdminRoute("/offers");
  assert.ok(route);
  const html = render(
    createElement(AdminShell, {
      user: {
        id: "test",
        name: "Test",
        email: "test@example.test",
        role: "Admin",
        twoFactorEnabled: true,
        mustChangePassword: false,
        blocked: false,
      },
      route,
      pathname: "/offers",
      navigate: () => {},
      children: null,
    }),
  );
  const contentItem = html.match(
    /<div class="[^"]*MuiListItemButton-root[^"]*"[^>]*aria-label="Content"[^>]*>/u,
  )?.[0];
  const offersItem = html.match(
    /<div class="[^"]*MuiListItemButton-root[^"]*"[^>]*aria-label="Angebote"[^>]*>/u,
  )?.[0];

  assert.ok(contentItem);
  assert.ok(offersItem);
  assert.doesNotMatch(contentItem, /Mui-selected/u);
  assert.match(offersItem, /Mui-selected/u);
});

test("management submenu groups users and maintenance and highlights the active child", () => {
  const route = resolveAdminRoute("/users");
  assert.ok(route);
  const html = render(
    createElement(AdminShell, {
      user: {
        id: "test",
        name: "Test",
        email: "test@example.test",
        role: "Admin",
        twoFactorEnabled: true,
        mustChangePassword: false,
        blocked: false,
      },
      route,
      pathname: "/users",
      navigate: () => {},
      children: null,
    }),
  );
  const managementItem = html.match(
    /<div class="[^"]*MuiListItemButton-root[^"]*"[^>]*aria-label="Verwaltung"[^>]*>/u,
  )?.[0];
  const usersItem = html.match(
    /<div class="[^"]*MuiListItemButton-root[^"]*"[^>]*aria-label="Nutzer"[^>]*>/u,
  )?.[0];
  const maintenanceItem = html.match(
    /<div class="[^"]*MuiListItemButton-root[^"]*"[^>]*aria-label="Maintenance"[^>]*>/u,
  )?.[0];

  assert.ok(managementItem);
  assert.ok(usersItem);
  assert.ok(maintenanceItem);
  assert.match(managementItem, /aria-expanded="true"/u);
  assert.doesNotMatch(managementItem, /Mui-selected/u);
  assert.match(usersItem, /Mui-selected/u);
  assert.doesNotMatch(maintenanceItem, /Mui-selected/u);
});

test("dirty documents allow only saving and clean saved documents enable follow-up actions", () => {
  const user: StaffUser = {
    id: "test",
    name: "Test",
    email: "test@example.test",
    role: "Admin",
    twoFactorEnabled: true,
    mustChangePassword: false,
    blocked: false,
  };
  for (const kind of ["order", "invoice"] as const) {
    for (const fresh of [true, false]) {
      for (const dirty of [true, false]) {
        for (const busy of [true, false]) {
          const pathname =
            kind === "order"
              ? fresh
                ? "/edit/-1"
                : "/edit/1004"
              : fresh
                ? "/invoices/new"
                : "/invoices/invoice-test";
          const route = resolveAdminRoute(pathname);
          assert.ok(route);
          const html = render(
            createElement(AdminShell, {
              user,
              route,
              pathname,
              navigate: () => {},
              orderDirty: dirty,
              invoiceDirty: dirty,
              orderBusy: busy,
              invoiceBusy: busy,
              children: null,
            }),
          );
          const header = html.slice(0, html.indexOf("</header>"));
          const controls = [
            ...header.matchAll(
              /<(?:button|a)\b[^>]*aria-label="([^"]+)"[^>]*>/gu,
            ),
          ];
          const actions = controls.filter(
            (match) => match[1] !== "Menü öffnen",
          );
          const saveLabel =
            kind === "order" ? "Auftrag speichern" : "Rechnung speichern";
          const expected =
            kind === "order"
              ? [
                  saveLabel,
                  "Angebotskopie anlegen",
                  "PDF erzeugen",
                  "E-Mail versenden",
                  "Auftrag archivieren",
                  "Rechnung aus Auftrag anlegen",
                ]
              : [
                  saveLabel,
                  "Rechnungs-PDF speichern",
                  "Rechnung per E-Mail versenden",
                  "Rechnung archivieren",
                ];
          assert.deepEqual(
            actions.map((match) => match[1]).sort(),
            expected.sort(),
          );
          for (const match of actions) {
            const save = match[1] === saveLabel;
            const disabled = /\bdisabled(?:=""|="true")/u.test(match[0]);
            assert.equal(
              disabled,
              save ? busy : Boolean(busy || dirty || fresh),
              `${pathname}, ${match[1]}, dirty=${dirty}, busy=${busy}`,
            );
            if (save)
              assert.ok(
                match[0].includes(
                  `form="${kind === "order" ? "order-create-form" : "invoice-editor-form"}"`,
                ),
              );
            if (disabled) assert.doesNotMatch(match[0], /\bhref=/u);
          }
        }
      }
    }
  }
});

test("order and invoice editor titles show a new label or their saved number", () => {
  const user: StaffUser = {
    id: "test",
    name: "Test",
    email: "test@example.test",
    role: "Admin",
    twoFactorEnabled: true,
    mustChangePassword: false,
    blocked: false,
  };
  const invoicePath = "/invoices/test-invoice-id";
  const invoiceRoute = resolveAdminRoute(invoicePath);
  assert.ok(invoiceRoute);
  const savedInvoice = render(
    createElement(AdminShell, {
      user,
      route: invoiceRoute,
      pathname: invoicePath,
      navigate: () => {},
      invoiceNumber: "R-201",
      children: null,
    }),
  );
  assert.match(savedInvoice, /<h1[^>]*>Rechnung \| R-201<\/h1>/u);

  const newInvoiceRoute = resolveAdminRoute("/invoices/new");
  assert.ok(newInvoiceRoute);
  const newInvoice = render(
    createElement(AdminShell, {
      user,
      route: newInvoiceRoute,
      pathname: "/invoices/new",
      navigate: () => {},
      children: null,
    }),
  );
  assert.match(newInvoice, /<h1[^>]*>Rechnung \| Neu<\/h1>/u);

  const newOrderRoute = resolveAdminRoute("/edit/-1");
  assert.ok(newOrderRoute);
  const newOrder = render(
    createElement(AdminShell, {
      user,
      route: newOrderRoute,
      pathname: "/edit/-1",
      navigate: () => {},
      children: null,
    }),
  );
  assert.match(newOrder, /<h1[^>]*>Auftrag \| Neu<\/h1>/u);

  const savedOrderRoute = resolveAdminRoute("/edit/1004");
  assert.ok(savedOrderRoute);
  const savedOrder = render(
    createElement(AdminShell, {
      user,
      route: savedOrderRoute,
      pathname: "/edit/1004",
      navigate: () => {},
      children: null,
    }),
  );
  assert.match(savedOrder, /<h1[^>]*>Auftrag \| 1004<\/h1>/u);
});

test("document title follows new and saved order and invoice pages", async (context) => {
  const user: StaffUser = {
    id: "title-test",
    name: "Test",
    email: "test@example.test",
    role: "Admin",
    twoFactorEnabled: true,
    mustChangePassword: false,
    blocked: false,
  };
  const app = await mount(null);
  context.after(() => app.cleanup());
  const renderPage = async (path: string, invoiceNumber?: string) => {
    const route = resolveAdminRoute(path);
    assert.ok(route);
    await app.render(
      createElement(AdminShell, {
        user,
        route,
        pathname: path,
        navigate: () => {},
        children: null,
        ...(invoiceNumber ? { invoiceNumber } : {}),
      }),
    );
    await app.flush();
  };

  await renderPage("/edit/-1");
  assert.equal(app.window.document.title, "Vega | Auftrag | Neu");
  await renderPage("/edit/1008");
  assert.equal(app.window.document.title, "Vega | Auftrag | 1008");
  await renderPage("/invoices/new");
  assert.equal(app.window.document.title, "Vega | Rechnung | Neu");
  await renderPage("/invoices/invoice-id", "R-202");
  assert.equal(app.window.document.title, "Vega | Rechnung | R-202");
});

test("order editor omits accounting and links the journal as the seventh tab", () => {
  const html = render(
    createElement(OrderCreatePage, {
      navigate: () => {},
      onDirtyChange: () => {},
      onBusyChange: () => {},
      dirty: false,
    }),
  );
  assert.ok(!html.includes("Buchhaltung"));
  assert.ok(!html.includes("Rechnung aus Auftrag anlegen"));
  assert.match(
    html,
    /id="order-tab-6" aria-controls="order-tabpanel-6"[^>]*>Journal/u,
  );
  assert.ok(!html.includes('id="order-tab-7"'));
  const tabs = html.slice(
    html.indexOf('aria-label="Auftragsschritte"') - 500,
    html.indexOf('aria-label="Auftragsschritte"') + 200,
  );
  assert.ok(!tabs.includes("MuiPaper-outlined"));
});

test("newly saved orders navigate to their editor without a separate success view", async () => {
  const source = await readFile(
    new URL("../src/orders/OrderCreatePage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /if \(orderNumber === undefined\) \{\s*onDirtyChange\(false\);\s*navigate\(`\/edit\/\$\{body\.data\.orderNumber\}`\);/u,
  );
  assert.doesNotMatch(
    source,
    /setSaved|if \(saved\)|Zur Auftragsübersicht|onSaved/u,
  );
});

test("admin shell uses a restrained brand in a persistent sidebar", async () => {
  const source = await readFile(
    new URL("../src/components/AdminSidebar.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("VEGA"));
  assert.doesNotMatch(source, /Auftragsverwaltung/u);
  assert.match(source, /variant=\{isMobile \? "temporary" : "permanent"\}/u);
  assert.match(source, /EXPANDED_SIDEBAR_WIDTH = 264/u);
  assert.ok(source.includes('"& .MuiDivider-root": { mx: 2 }'));
});

test("sidebar navigation starts with consistent spacing after the brand", async () => {
  const source = await readFile(
    new URL("../src/components/AdminSidebar.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /<Divider sx=\{\{ mb: 1 \}\} \/>\s*<List disablePadding>/u,
  );
  assert.match(source, /height: \{ xs: 58, md: 68 \}/u);
  const ordersNavigationItem = source.slice(
    source.indexOf('aria-label="Aufträge"'),
    source.indexOf('aria-label="Rechnungen"'),
  );
  assert.ok(ordersNavigationItem.includes('primary="Aufträge"'));
  assert.doesNotMatch(ordersNavigationItem, /<Divider/u);
});

test("archived orders offer PDF and restoration without editing", async () => {
  const source = await readFile(
    new URL("../src/orders/OrdersPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /archived \? order\.orderNumber : <Button/u);
  assert.match(source, /if \(!archived &&/u);
  assert.match(source, /aria-label="Auftrags-PDF herunterladen"/u);
  assert.match(source, /aria-label="Auftrag wiederherstellen"/u);
  const editor = await readFile(
    new URL("../src/orders/OrderCreatePage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    editor,
    /if \(body\.data\.archivedAt\) \{\s*navigate\("\/orders\/archived"\);\s*return;\s*\}/u,
  );
});

test("staff can view but cannot edit the customer alternative date range", () => {
  const html = render(
    createElement(AppointmentFields, {
      value: {
        movingDate: "2026-11-01",
        movingTime: "10:00",
        dateFrom: "2026-11-02",
        dateTo: "2026-11-04",
        dateFixed: false,
      },
      onChange: () => {},
    }),
  );
  const inputs = [...html.matchAll(/<input\b[^>]*>/gu)].map(
    (match) => match[0],
  );
  assert.equal(inputs.filter((input) => /readOnly=""/u.test(input)).length, 2);
  for (const date of ["2026-11-02", "2026-11-04"]) {
    const input = inputs.find((entry) => entry.includes(`value="${date}"`));
    assert.ok(input);
    assert.match(input, /readOnly=""/u);
    assert.match(input, /type="date"/u);
  }
  for (const value of ["2026-11-01", "10:00"]) {
    const input = inputs.find((entry) => entry.includes(`value="${value}"`));
    assert.ok(input);
    assert.doesNotMatch(input, /readOnly/u);
  }
});

test("empty customer alternative dates are hidden from staff", () => {
  const html = render(
    createElement(AppointmentFields, {
      value: {
        movingDate: "2026-11-01",
        movingTime: "10:00",
        dateFrom: "",
        dateTo: "",
        dateFixed: false,
      },
      onChange: () => {},
    }),
  );

  assert.doesNotMatch(html, />Von</u);
  assert.doesNotMatch(html, />Bis</u);
  assert.doesNotMatch(html, /Alternativer Zeitraum/u);
});

test("order positions keep manual editing and expose an explicit server calculation action", () => {
  const value = createEmptyOrder();
  value.details.conditions = [
    { description: "Manuelle Position", amount: 125 },
  ];
  const html = render(
    createElement(ConditionsTab, {
      value,
      onConditionsChange: () => {},
      onCalculate: () => {},
    }),
  );
  assert.ok(html.includes("Positionen berechnen"));
  assert.ok(html.includes("Beschreibung"));
  assert.ok(html.includes("Betrag (€)"));
  assert.ok(html.includes("Manuelle Position"));
  assert.ok(html.includes("125,00"));
});

test("zero amount is displayed as an empty field for a new position", () => {
  const value = createEmptyOrder();
  value.details.conditions = [
    { description: "", quantity: 1, unitPrice: 3, amount: 0 },
  ];
  const html = render(
    createElement(ConditionsTab, {
      value,
      onConditionsChange: () => {},
      onCalculate: () => {},
    }),
  );
  const numberInputs = [
    ...html.matchAll(/<input\b[^>]*type="number"[^>]*>/gu),
  ].map((match) => match[0]);
  const amountInput = numberInputs.find((input) => input.includes('value=""'));
  assert.ok(amountInput);
  assert.match(amountInput, /value=""/u);
  assert.doesNotMatch(amountInput, /value="0"/u);
});

test("manual position amount is the rounded quantity multiplied by unit price", () => {
  assert.equal(calculateConditionAmount(2, 15.255), 30.51);
  assert.equal(calculateConditionAmount(0, 15), 0);
  assert.equal(calculateConditionAmount(2, undefined), undefined);
  assert.equal(calculateConditionAmount(undefined, 15), undefined);

  const value = createEmptyOrder();
  value.details.conditions = [
    {
      description: "Möbelmontage",
      quantity: 2,
      unitPrice: 15.255,
      amount: 30.51,
    },
  ];
  const html = render(
    createElement(ConditionsTab, {
      value,
      onConditionsChange: () => {},
      onCalculate: () => {},
    }),
  );
  assert.match(html, /Menge/u);
  assert.match(html, /Einzelpreis \(€\)/u);
  assert.match(html, /30,51/u);
  assert.match(html, /disabled=""/u);
});

test("manual order positions are separate and survive recalculation until removed", () => {
  const calculated = [
    { description: "Personal", amount: 500, kind: "base" as const },
    { description: "Anfahrt", amount: 90, kind: "travel" as const },
  ];
  const manual = {
    description: "Entsorgung",
    amount: 35,
    kind: "manual" as const,
  };
  const merged = mergeCalculatedConditions(calculated, [...calculated, manual]);
  assert.deepEqual(merged, [...calculated, manual]);
  const afterRemovingManual = mergeCalculatedConditions(calculated, calculated);
  assert.deepEqual(afterRemovingManual, calculated);

  const value = createEmptyOrder();
  value.details.conditions = [...calculated, manual];
  const html = render(
    createElement(ConditionsTab, {
      value,
      onConditionsChange: () => {},
      onCalculate: () => {},
    }),
  );
  assert.match(html, /Positionen aus dem Auftrag/u);
  assert.match(html, /Manuell hinzugefügt/u);
  assert.ok(html.indexOf("Personal") < html.indexOf("Manuell hinzugefügt"));
  assert.ok(html.indexOf("Manuell hinzugefügt") < html.indexOf("Entsorgung"));
  assert.match(html, /Summe:[\s\S]*625,00/u);
});

test("order position descriptions retain all lines in autosizing textareas", () => {
  const value = createEmptyOrder();
  const description =
    "5 Träger / 2 x LKW 3,5t\nMindestabnahme: 6 Stunden, jede weitere Stunde: 265 €/Std";
  value.details.conditions = [
    { description, amount: 1470, kind: "base" },
    { description: "Manuelle\nZusatzposition", amount: 10 },
  ];
  const html = render(
    createElement(ConditionsTab, {
      value,
      onConditionsChange: () => {},
      onCalculate: () => {},
    }),
  );
  const textareas = [
    ...html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gu),
  ].filter((match) => !match[1]!.includes('aria-hidden="true"'));
  assert.equal(textareas.length, 2);
  assert.doesNotMatch(textareas[0]![1]!, /\brows=/u);
  assert.equal(textareas[0]![2], description);
  assert.equal(textareas[1]![2], "Manuelle\nZusatzposition");
});

test("new order positions suggest both services and packaging and apply selected prices", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url);
    return Response.json({
      data: path.endsWith("/packings")
        ? [
            {
              id: 7,
              name: "Kleiderbox",
              price: 4.5,
              description: "",
              media: null,
              sort: 0,
              show: false,
            },
          ]
        : [{ id: 9, name: "Entsorgung", price: 35, sort: 0, show: false }],
    });
  };
  const value = createEmptyOrder();
  value.details.conditions = [{ description: "", amount: 0, kind: "manual" }];
  let updatedConditions = value.details.conditions;
  const app = await mount(
    createElement(ConditionsTab, {
      value,
      onConditionsChange: (conditions) => {
        updatedConditions = conditions;
      },
      onCalculate: () => {},
    }),
  );
  try {
    await app.flush();
    const description = app.container.querySelector<HTMLTextAreaElement>(
      'textarea[role="combobox"]',
    );
    assert.ok(description);
    await app.input(description, "e");
    await app.flush();
    const options = [
      ...app.window.document.querySelectorAll<HTMLElement>('[role="option"]'),
    ];
    assert.ok(
      options.some((option) => option.textContent?.trim() === "Entsorgung"),
    );
    const packing = options.find(
      (option) => option.textContent?.trim() === "Kleiderbox",
    );
    assert.ok(packing);
    await app.click(packing);
    assert.deepEqual(updatedConditions[0], {
      description: "Kleiderbox",
      kind: "manual",
      quantity: 1,
      unitPrice: 4.5,
      amount: 4.5,
    });
  } finally {
    globalThis.fetch = originalFetch;
    await app.cleanup();
  }
});
