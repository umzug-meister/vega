import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";
import { AdminShell } from "../src/components/AdminShell.js";
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

function shell(navigate: (path: string) => void = () => {}) {
  const route = resolveAdminRoute("/offers");
  assert.ok(route);
  return createElement(AdminShell, {
    user: admin,
    route,
    pathname: route.path,
    navigate,
    children: null,
  });
}

test("sidebar collapse remains accessible and preserves navigation", async () => {
  const navigated: string[] = [];
  const app = await mount(
    shell((path) => navigated.push(path)),
    "/offers",
  );
  try {
    const navigation = app.container.querySelector('[aria-label="Hauptmenü"]');
    assert.ok(navigation);
    assert.ok(app.container.querySelector('[aria-label="Aufträge"]'));
    assert.ok(
      app.container.querySelector('[title="Abmelden"][aria-label="Abmelden"]'),
    );

    const collapse = () =>
      app.container.querySelector<HTMLButtonElement>(
        'button[aria-label="Seitenleiste einklappen"], button[aria-label="Seitenleiste ausklappen"]',
      );
    assert.equal(
      collapse()?.getAttribute("aria-label"),
      "Seitenleiste einklappen",
    );
    await app.click(collapse()!);
    assert.equal(
      collapse()?.getAttribute("aria-label"),
      "Seitenleiste ausklappen",
    );
    assert.equal(app.container.querySelector('[aria-label="Katalog"]'), null);
    await app.click(collapse()!);

    await app.click(app.container.querySelector('[aria-label="Aufträge"]')!);
    assert.deepEqual(navigated, ["/"]);
  } finally {
    await app.cleanup();
  }
});

test("content navigation maps every section to its icon and highlights the route", async () => {
  const app = await mount(shell(), "/offers");
  try {
    for (const [section, icon] of [
      ["Angebote", "LocalOfferOutlinedIcon"],
      ["Preise", "PaymentsOutlinedIcon"],
      ["Verpackung", "Inventory2OutlinedIcon"],
      ["Leistungen", "HandymanOutlinedIcon"],
      ["Möbel-Kategorien", "CategoryOutlinedIcon"],
      ["Möbel", "ChairOutlinedIcon"],
    ]) {
      assert.ok(
        app.container.querySelector(`[aria-label="${section}"]`),
        section,
      );
      assert.ok(app.container.querySelector(`[data-testid="${icon}"]`), icon);
    }
    assert.ok(
      app.container
        .querySelector('[aria-label="Angebote"]')
        ?.classList.contains("Mui-selected"),
    );
  } finally {
    await app.cleanup();
  }
});

test("archived orders highlight only the orders submenu item, not its group", async () => {
  const route = resolveAdminRoute("/orders/archived");
  assert.ok(route);
  const app = await mount(
    createElement(AdminShell, {
      user: admin,
      route,
      pathname: route.path,
      navigate: () => {},
      children: null,
    }),
    route.path,
  );
  try {
    assert.equal(
      app.container
        .querySelector('[aria-label="Archiv"]')
        ?.classList.contains("Mui-selected"),
      false,
    );
    const selectedItems = app.container.querySelectorAll(
      '[aria-label="Hauptmenü"] .MuiListItemButton-root.Mui-selected',
    );
    assert.equal(selectedItems.length, 1);
    assert.equal(selectedItems[0]?.textContent?.trim(), "Aufträge");
  } finally {
    await app.cleanup();
  }
});
