import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import type { SetupInfoDto, SetupSmokeTestDto } from "@vega/domain";
import { MaintenancePage } from "../src/maintenance/MaintenancePage.js";
import { AdminNotifications } from "../src/components/AdminNotifications.js";
import { AdminShell } from "../src/components/AdminShell.js";
import type { StaffUser } from "../src/types.js";
import { mount } from "./dom-test-helpers.js";
import { resolveAdminRoute } from "../src/routes.js";

const info: SetupInfoDto = {
  loaderUrl: "https://runtime.example.test/customer-form/loader.js",
  embedCode:
    '<script src="https://runtime.example.test/customer-form/loader.js" defer></script>',
  variables: [
    {
      name: "BETTER_AUTH_SECRET",
      group: "Grundbetrieb",
      requirement: "required",
      status: "set",
      hint: "Mindestens 32 Zeichen.",
    },
    {
      name: "CORS_ALLOWED_ORIGINS",
      group: "Kundenformular",
      requirement: "required",
      status: "missing",
      hint: "WordPress-Origin eintragen.",
    },
    {
      name: "GOOGLE_MAPS_API_KEY",
      group: "Google",
      requirement: "optional",
      status: "missing",
      hint: "Optional für Karten.",
    },
    {
      name: "INITIAL_ADMIN_PASSWORD",
      group: "Seed",
      requirement: "bootstrap",
      status: "set",
      hint: "Nach dem Seed entfernen.",
    },
  ],
};

test("Maintenance is a standalone admin-only page, with the former setup URL redirected", () => {
  const route = resolveAdminRoute("/maintenance");
  assert.equal(route?.adminOnly, true);
  assert.equal(route?.settingsArea, undefined);
  assert.equal(route?.title, "Maintenance");
  assert.equal(resolveAdminRoute("/settings/setup"), null);
  assert.equal(resolveAdminRoute("/options")?.settingsArea, "options");
});

test("Maintenance navigation is visible only to admins and opens the standalone route", async (context) => {
  const navigated: string[] = [];
  const route = resolveAdminRoute("/maintenance");
  assert.ok(route);
  const user: StaffUser = {
    id: "synthetic-admin",
    name: "Test",
    email: "test@example.test",
    role: "Admin",
    blocked: false,
    mustChangePassword: false,
    twoFactorEnabled: true,
  };
  const props = {
    user,
    route,
    pathname: "/maintenance",
    navigate: (path: string) => navigated.push(path),
    children: null,
  };
  const view = await mount(React.createElement(AdminShell, props));
  context.after(() => view.cleanup());
  const navigation = view.container.querySelector('[aria-label="Maintenance"]');
  assert.ok(navigation);
  await view.click(navigation);
  assert.deepEqual(navigated, ["/maintenance"]);
  await view.render(
    React.createElement(AdminShell, {
      ...props,
      user: { ...user, role: "Kundenberater" },
    }),
  );
  assert.equal(
    view.container.querySelector('[aria-label="Maintenance"]'),
    null,
  );
});

test("setup displays runtime embed, copies URL and code, and runs smoke test only on explicit click", async (context) => {
  const calls: string[] = [];
  let finish: (response: Response) => void = () => {};
  context.mock.method(
    globalThis,
    "fetch",
    async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.endsWith("/smoke-test")) {
        assert.equal(init?.method, "POST");
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return Response.json({ data: info });
    },
  );
  const copied: string[] = [];
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        copied.push(value);
      },
    },
  });
  context.after(() => {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else Reflect.deleteProperty(navigator, "clipboard");
  });
  const view = await mount(
    React.createElement(
      AdminNotifications,
      null,
      React.createElement(MaintenancePage),
    ),
  );
  context.after(() => view.cleanup());
  await view.flush();
  assert.equal(calls.length, 1);
  assert.ok(view.container.textContent?.includes("Nach Seed entfernen"));
  assert.ok(view.container.textContent?.includes("Fehlt"));
  const loader = view.container.querySelector<HTMLInputElement>(
    'input[value="https://runtime.example.test/customer-form/loader.js"]',
  );
  assert.ok(loader?.readOnly);
  const button = (label: string) => {
    const found = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.endsWith(label),
    );
    assert.ok(found, label);
    return found;
  };
  await view.click(button("Loader-URL kopieren"));
  await view.click(button("Einbettungscode kopieren"));
  assert.deepEqual(copied, [info.loaderUrl, info.embedCode]);
  await view.click(button("Smoke-Test starten"));
  assert.equal(button("Prüfung läuft …").disabled, true);
  assert.equal(calls.length, 2);
  const result: SetupSmokeTestDto = {
    checkedAt: "2026-10-17T12:00:00Z",
    checks: [
      {
        id: "database",
        label: "Datenbank",
        status: "ok",
        message: "SELECT erfolgreich.",
      },
      {
        id: "mail",
        label: "Hostinger Mail",
        status: "error",
        message: "Mail-Token ungültig.",
      },
      {
        id: "gcs",
        label: "Google Cloud Storage",
        status: "skipped",
        message: "Nicht konfiguriert.",
      },
    ],
  };
  await React.act(async () => finish(Response.json({ data: result })));
  await view.flush();
  for (const text of [
    "SELECT erfolgreich.",
    "Mail-Token ungültig.",
    "Nicht geprüft",
  ])
    assert.ok(view.container.textContent?.includes(text));
  assert.equal(button("Smoke-Test starten").disabled, false);
});

test("setup reports load and clipboard failures with actionable retry/manual copy", async (context) => {
  let first = true;
  context.mock.method(globalThis, "fetch", async () => {
    if (first) {
      first = false;
      return Response.json(
        { error: { message: "Laden fehlgeschlagen." } },
        { status: 503 },
      );
    }
    return Response.json({ data: info });
  });
  const view = await mount(React.createElement(MaintenancePage));
  context.after(() => view.cleanup());
  await view.flush();
  assert.ok(view.container.textContent?.includes("Laden fehlgeschlagen."));
  const retry = [...view.container.querySelectorAll("button")].find((item) =>
    item.textContent?.endsWith("Erneut laden"),
  );
  assert.ok(retry);
  await view.click(retry);
  await view.flush();
  const copy = [...view.container.querySelectorAll("button")].find((item) =>
    item.textContent?.endsWith("Einbettungscode kopieren"),
  );
  assert.ok(copy);
  await view.click(copy);
  assert.ok(view.container.textContent?.includes("manuell kopieren"));
});
