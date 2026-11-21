import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { mount } from "./dom-test-helpers.js";
import { useOrderPdfFilename } from "../src/orders/useOrderPdfFilename.js";

function Harness({ action, scope }: { action: () => void; scope?: string }) {
  const { ensurePdfFilename, filenameDialog } = useOrderPdfFilename(scope);
  return React.createElement(React.Fragment, null,
    React.createElement("button", {
      onClick: async () => { if (await ensurePdfFilename(1042)) action(); },
    }, "PDF herunterladen"),
    filenameDialog,
  );
}

test("first PDF action waits for a persisted name, cancellation stops it and remount reuses the name", async (context) => {
  let filename: string | null = null;
  let actions = 0;
  const writes: unknown[] = [];
  context.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { filename: string; revision: number };
      writes.push(body);
      filename = `${body.filename}.pdf`;
      return Response.json({ data: { pdfFilename: filename } });
    }
    return Response.json({ data: {
      revision: 7, pdfFilename: filename, defaultPdfFilename: "Standard_1042.pdf",
    } });
  });
  const action = () => { actions++; };
  const view = await mount(React.createElement(Harness, { action }));
  context.after(() => view.cleanup());
  const button = () => [...view.window.document.querySelectorAll("button")].find((item) => item.textContent === "PDF herunterladen")!;
  const dialogButton = (label: string) => [...view.window.document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === label)!;
  await view.click(button());
  await view.flush();
  const input = view.window.document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  assert.equal(input.value, "Standard_1042");
  assert.equal(actions, 0);
  await view.click(dialogButton("Abbrechen"));
  await view.flush();
  assert.deepEqual(writes, []);
  assert.equal(actions, 0);
  await view.click(button());
  await view.flush();
  await view.input(view.window.document.querySelector('[role="dialog"] input')!, "Mein Angebot");
  await view.click(dialogButton("OK"));
  await view.flush();
  assert.deepEqual(writes, [{ filename: "Mein Angebot", revision: 7 }]);
  assert.equal(filename, "Mein Angebot.pdf");
  assert.equal(actions, 1);
  await view.render(null);
  await view.render(React.createElement(Harness, { action }));
  await view.click(button());
  await view.flush();
  assert.equal(actions, 2);
  assert.equal(writes.length, 1);
  assert.equal(view.window.document.querySelector('[role="dialog"]'), null);
});

test("the default filename is confirmed without its extension and retains dots in the name", async (context) => {
  let actions = 0;
  let saved: unknown;
  context.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") {
      saved = JSON.parse(String(init.body));
      return Response.json({ data: { pdfFilename: "Angebot.v2.pdf" } });
    }
    return Response.json({ data: { revision: 7, pdfFilename: null, defaultPdfFilename: "Angebot.v2.PDF" } });
  });
  const view = await mount(React.createElement(Harness, { action: () => { actions++; } }));
  context.after(() => view.cleanup());
  await view.click(view.container.querySelector("button")!);
  await view.flush();
  assert.equal(view.window.document.querySelector<HTMLInputElement>('[role="dialog"] input')?.value, "Angebot.v2");
  assert.equal(view.window.document.querySelector('[role="dialog"] .MuiInputAdornment-root')?.textContent, ".pdf");
  const ok = [...view.window.document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === "OK")!;
  await view.click(ok);
  await view.flush();
  assert.deepEqual(saved, { filename: "Angebot.v2", revision: 7 });
  assert.equal(actions, 1);
});

test("filename save errors keep the modal open and prevent the requested action", async (context) => {
  let actions = 0;
  context.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) =>
    init?.method === "PUT"
      ? Response.json({ error: { message: "Auftrag wurde geändert." } }, { status: 409 })
      : Response.json({ data: { revision: 7, pdfFilename: null, defaultPdfFilename: "Standard.pdf" } }));
  const view = await mount(React.createElement(Harness, { action: () => { actions++; } }));
  context.after(() => view.cleanup());
  await view.click(view.container.querySelector("button")!);
  await view.flush();
  const ok = [...view.window.document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === "OK")!;
  await view.click(ok);
  await view.flush();
  assert.equal(actions, 0);
  assert.ok(view.window.document.querySelector('[role="dialog"]')?.textContent?.includes("Auftrag wurde geändert."));
});

test("changing the page cancels a delayed filename check without starting the old action", async (context) => {
  let complete!: (response: Response) => void;
  let actions = 0;
  context.mock.method(globalThis, "fetch", () => new Promise<Response>((done) => { complete = done; }));
  const action = () => { actions++; };
  const view = await mount(React.createElement(Harness, { action, scope: "first" }));
  context.after(() => view.cleanup());
  await view.click(view.container.querySelector("button")!);
  await view.render(React.createElement(Harness, { action, scope: "next" }));
  await React.act(async () => {
    complete(Response.json({ data: { pdfFilename: "Existing.pdf" } }));
  });
  assert.equal(actions, 0);
  assert.equal(view.window.document.querySelector('[role="dialog"]'), null);
});
