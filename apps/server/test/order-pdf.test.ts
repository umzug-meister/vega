import assert from "node:assert/strict";
import test from "node:test";
import {
  generateOrderPdf,
  orderPdfEditDate,
  orderPdfFilename,
} from "../src/pdf/order-pdf.js";
import { orderPdfFixture } from "./order-pdf-fixture.js";

const now = new Date("2026-10-10T10:00:00Z");
const streams = (pdf: Buffer) =>
  [...pdf.toString("latin1").matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(
    (match) => match[1]!,
  );

test("order PDF renders saved customer, positions and amounts with a valid attachment filename", () => {
  const input = orderPdfFixture();
  input.services.push(
    {
      id: 22,
      name: "Nicht im Kundenformular",
      price: 42,
      sort: 3,
      kind: "service",
    },
    {
      id: 23,
      name: "Ausgeblendete Verpackung",
      price: 7,
      sort: 4,
      kind: "packaging",
    },
  );
  const pdf = generateOrderPdf(input, now);
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  const pageCount = pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length;
  assert.equal(pageCount, 4);
  const content = pdf.toString("latin1");
  assert.match(content, /%%EOF\s*$/u);
  for (const value of [
    "Ada",
    "Beispiel",
    "Sofa",
    "Bett",
    "Bohren",
    "Umzugskarton",
    "Halteverbot",
    "Leistungen",
    "Einzelpreis",
    "1.190,00",
    "119,00",
    "1.309,00",
    "Nicht im Kundenformular",
    "Ausgeblendete Verpackung",
  ])
    assert.ok(content.includes(value), value);
  assert.equal(
    orderPdfFilename(orderPdfFixture()),
    "24.10.2026_Beispiel_1042_3+2x3.5_4_Std_1xHVZ.pdf",
  );
});

test("order PDF retains the saved multiline hourly crew description", () => {
  const input = orderPdfFixture();
  input.data.details!.conditions = [
    {
      description:
        "5 Träger / 2 x LKW 3,5t\nMindestabnahme: 6 Stunden, jede weitere Stunde: 265 €/Std\nMaximale Abnahme: 7 Stunden",
      quantity: 2,
      unitPrice: 735,
      amount: 1470,
      kind: "base",
    },
  ];
  const pdf = generateOrderPdf(input, now).toString("latin1");
  for (const text of [
    "2 x LKW 3,5t",
    "Mindestabnahme: 6 Stunden",
    "jede weitere Stunde:",
    "265",
    "Maximale Abnahme: 7 Stunden",
    "735,00",
    "2",
    "1.470,00",
  ])
    assert.ok(pdf.includes(text), text);
});

test("historically archived and restored orders recover their last edit date from the journal", () => {
  const createdAt = new Date("2026-08-01T10:00:00Z");
  const editedAt = new Date("2026-09-15T10:00:00Z");
  const updatedAt = new Date("2026-10-11T10:00:00Z");
  for (const action of ["ARCHIVED", "RESTORED"]) {
    const order = { createdAt, updatedAt };
    assert.equal(
      orderPdfEditDate(
        order,
        { action, createdAt: updatedAt },
        { createdAt: editedAt },
      ),
      editedAt,
    );
    assert.equal(
      orderPdfEditDate(order, { action, createdAt: updatedAt }, null),
      createdAt,
    );
    const recovered = orderPdfEditDate(
      order,
      { action, createdAt: updatedAt },
      { createdAt: editedAt },
    );
    assert.ok(
      generateOrderPdf(orderPdfFixture(), recovered)
        .toString("latin1")
        .includes("15.9.2026"),
    );
  }
  assert.equal(
    orderPdfEditDate(
      { createdAt, updatedAt },
      { action: "UPDATED", createdAt: updatedAt },
      { createdAt: editedAt },
    ),
    updatedAt,
  );
  assert.equal(
    orderPdfEditDate({ createdAt, updatedAt }, null, null),
    updatedAt,
  );
});

test("order PDF displays the supplied last-edit date rather than today's export date", () => {
  const pdf = generateOrderPdf(
    orderPdfFixture(),
    new Date("2025-02-03T23:30:00Z"),
  ).toString("latin1");
  assert.ok(pdf.includes("4.2.2025"));
  assert.ok(!pdf.includes("10.10.2026"));
});

test("PDF handles incomplete saved drafts without invalid dates or invented data", () => {
  const input = orderPdfFixture();
  input.data.movingDate = "";
  input.data.customer.lastName = "";
  delete input.data.details;
  const pdf = generateOrderPdf(input, now);
  assert.ok(pdf.length > 1000);
  assert.ok(!pdf.toString("latin1").includes("NaN"));
  assert.ok(!pdf.toString("latin1").includes("undefined"));
  assert.equal(orderPdfFilename(input), "_Auftrag_1042_1xHVZ.pdf");
});

test("saved custom-item notes, own furniture lists and removed services are retained", () => {
  const input = orderPdfFixture();
  const details = input.data.details!;
  details.furniture.expensive = true;
  details.furniture.expensiveText = "Antike Vase";
  details.furniture.heavy = true;
  details.furniture.heavyText = "Tresor";
  details.furniture.bulky = true;
  details.furniture.bulkyText = "Fluegel";
  details.furniture.ownItems = "Eigene Liste: Tisch und zwei Stuehle";
  details.extras.services.push({
    kind: "service",
    catalogId: 999,
    name: "Entfernter Katalogeintrag",
    quantity: 2,
  });
  details.basis.hours = 0;
  const pdf = generateOrderPdf(input, now).toString("latin1");
  for (const text of [
    "Antike Vase",
    "Tresor",
    "Fluegel",
    "Eigene Liste",
    "Entfernter Katalogeintrag",
    "Gesamt:",
  ])
    assert.ok(pdf.includes(text), text);
  assert.ok(!pdf.includes("Gesamtpreis f"));
});

test("long content paginates and every page has its own numbered footer", () => {
  const input = orderPdfFixture();
  input.data.note = "Zusatzinformation ".repeat(2000);
  input.data.details!.furniture.items = Array.from({ length: 150 }, (_, i) => ({
    name: `Moebel ${i}`,
    quantity: 1,
    category: "Wohnzimmer",
  }));
  const pdf = generateOrderPdf(input, now);
  const count = pdf.toString("latin1").match(/\/Type \/Page\b/g)!.length;
  assert.ok(count > 4);
  for (const [index, stream] of streams(pdf).slice(0, count).entries())
    assert.ok(stream.includes(`1042 | Seite ${index + 1}/${count}`));
});

test("attachment filenames cannot contain paths or control characters", () => {
  const input = orderPdfFixture();
  input.data.customer.lastName = "Test/..\\Name\r\n";
  assert.ok(!/[/\\\r\n]/u.test(orderPdfFilename(input)));
});
