import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function readShell() {
  return readFile(
    new URL("../src/components/AdminShell.tsx", import.meta.url),
    "utf8",
  );
}

test("sidebar can collapse on desktop and mobile and keeps navigation accessible", async () => {
  const source = await readShell();
  assert.match(source, /COLLAPSED_SIDEBAR_WIDTH = 72/u);
  assert.match(
    source,
    /aria-label=\{\s*sidebarCollapsed\s*\?\s*"Seitenleiste ausklappen"\s*:\s*"Seitenleiste einklappen"\s*\}/u,
  );
  assert.match(
    source,
    /onClick=\{\(\) => setSidebarCollapsed\(\(collapsed\) => !collapsed\)\}/u,
  );
  assert.match(source, /aria-label="Aufträge"/u);
  assert.match(source, /title="Abmelden"\s*aria-label="Abmelden"/u);
  assert.match(
    source,
    /width: \{ md: `calc\(100% - \$\{sidebarWidth\}px\)` \},\s*ml: \{ md: `\$\{sidebarWidth\}px` \}/u,
  );
});

test("all content navigation entries have matching icons", async () => {
  const source = await readShell();
  for (const [section, icon] of [
    ["offers", "LocalOfferOutlined"],
    ["prices", "PaymentsOutlined"],
    ["packings", "Inventory2Outlined"],
    ["services", "HandymanOutlined"],
    ["categories", "CategoryOutlined"],
    ["furniture", "ChairOutlined"],
  ]) {
    assert.match(
      source,
      new RegExp(`section: "${section}",[\\s\\S]{0,160}?icon: <${icon} />`, "u"),
    );
  }
  assert.match(
    source,
    /<ListItemIcon sx=\{\{ minWidth: 36 \}\}>\s*\{item\.icon\}\s*<\/ListItemIcon>/u,
  );
  assert.match(
    source,
    /<ListItemIcon>\s*<ViewModuleOutlined \/>\s*<\/ListItemIcon>/u,
  );
  assert.ok(
    source.includes(
      '{!sidebarCollapsed && <ListItemText primary="Katalog" />}',
    ),
  );
});
