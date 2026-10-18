import assert from "node:assert/strict";
import {
  Prisma,
  type CreditNote,
  type Invoice,
  type ReminderEvent,
} from "../src/generated/prisma/client.js";
import test from "node:test";
import PDFDocument from "pdfkit";
import {
  calculateInvoiceTotals,
  generateInvoicePdf,
  invoicePdfFilename,
} from "../src/pdf/invoice-pdf.js";
import { generateCreditNotePdf } from "../src/pdf/credit-note-pdf.js";
import { generateReminderPdf } from "../src/pdf/reminder-pdf.js";
import {
  PAGE,
  euro,
  startAccountingPdf,
  drawBankFooter,
  drawTable,
  drawText,
  drawTotals,
} from "../src/pdf/accounting-pdf.js";

function invoiceFixture(): Invoice {
  return {
    id: "invoice-42",
    revision: 1,
    invoiceNumber: "R-42",
    orderId: null,
    orderNumberSnapshot: null,
    customerNameSnapshot: "Ada Beispiel",
    company: "Beispiel GmbH",
    customerStreet: "Teststraße 1",
    customerPostalCity: "80331 München",
    invoiceDate: new Date("2026-10-09T00:00:00.000Z"),
    taxPercent: new Prisma.Decimal(19),
    text: "Vielen Dank.",
    entries: [{ description: "Umzug", quantity: 2, unitPrice: 100 }],
    dueDates: [],
    archivedAt: null,
    purgeAt: null,
    createdAt: new Date("2026-10-09T00:00:00.000Z"),
    updatedAt: new Date("2026-10-09T00:00:00.000Z"),
  };
}

test("renders the legacy-styled invoice layout as a server-side PDF", async () => {
  const invoice = invoiceFixture();
  const pdf = await generateInvoicePdf(invoice);
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.equal(pdf.subarray(-6).toString("ascii"), "%%EOF\n");
  assert.equal(pdf.toString("latin1").match(/\/Type \/Page\b/gu)?.length, 1);
  assert.equal(invoicePdfFilename(invoice), "R-R-42 Beispiel GmbH.pdf");
});

interface TextCall {
  value: string;
  x: number;
  y: number;
  size: number;
  page: number;
  rendered: string[];
}
interface RenderedLine {
  value: string;
  x: number;
  y: number;
  right: number;
  bottom: number;
  size: number;
  page: number;
}

function inspectPdf(context: test.TestContext) {
  const calls: TextCall[] = [];
  const lines: RenderedLine[] = [];
  const rectangles: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    page: number;
  }> = [];
  let pages = 0;
  let active: TextCall | undefined;
  const addPage = PDFDocument.prototype.addPage;
  context.mock.method(
    PDFDocument.prototype,
    "addPage",
    function (this: PDFKit.PDFDocument, options?: PDFKit.PDFDocumentOptions) {
      pages++;
      return addPage.call(this, options);
    },
  );
  const originalText = PDFDocument.prototype.text;
  context.mock.method(
    PDFDocument.prototype,
    "text",
    function (
      this: PDFKit.PDFDocument,
      value: string,
      x: number,
      y: number,
      options?: PDFKit.Mixins.TextOptions,
    ) {
      const call = {
        value,
        x,
        y,
        size: Number(Reflect.get(this, "_fontSize")),
        page: pages,
        rendered: [],
      };
      calls.push(call);
      active = call;
      const result = originalText.call(this, value, x, y, options);
      assert.equal(
        pages,
        call.page,
        `PDFKit implicitly paginated ${value.slice(0, 60)}`,
      );
      active = undefined;
      return result;
    },
  );
  const prototype = PDFDocument.prototype as unknown as {
    _fragment: (
      value: string,
      x: number,
      y: number,
      options: PDFKit.Mixins.TextOptions & {
        lineWidth: number;
        textWidth: number;
      },
    ) => void;
  };
  const fragment = prototype._fragment;
  context.mock.method(
    prototype,
    "_fragment",
    function (
      this: PDFKit.PDFDocument,
      value: string,
      x: number,
      y: number,
      options: PDFKit.Mixins.TextOptions & {
        lineWidth: number;
        textWidth: number;
      },
    ) {
      active?.rendered.push(value);
      const visible = value.replace(/\n/gu, "").trimEnd();
      if (visible) {
        const width = this.widthOfString(visible);
        let left = x;
        if (options.align === "right") left += options.lineWidth - width;
        if (options.align === "center")
          left += options.lineWidth / 2 - options.textWidth / 2;
        lines.push({
          value,
          x: left,
          y,
          right: left + width,
          bottom: y + this.currentLineHeight(false),
          size: Number(Reflect.get(this, "_fontSize")),
          page: pages,
        });
      }
      return fragment.call(this, value, x, y, options);
    },
  );
  const rect = PDFDocument.prototype.rect;
  context.mock.method(
    PDFDocument.prototype,
    "rect",
    function (
      this: PDFKit.PDFDocument,
      x: number,
      y: number,
      width: number,
      height: number,
    ) {
      rectangles.push({ x, y, width, height, page: pages });
      return rect.call(this, x, y, width, height);
    },
  );
  return {
    calls,
    lines,
    rectangles,
    assertBounds(pdf: Buffer, minimumPages: number, maximumPages: number) {
      assert.equal(
        pdf.toString("latin1").match(/\/Type \/Page\b/gu)?.length,
        pages,
      );
      assert.ok(
        pages >= minimumPages && pages <= maximumPages,
        `${pages} pages, expected ${minimumPages}–${maximumPages}`,
      );
      for (const line of lines) {
        assert.ok(
          line.x >= PAGE.left - 0.1 && line.right <= PAGE.right + 0.1,
          `Horizontal overflow: ${JSON.stringify(line)}`,
        );
        assert.ok(
          line.y >= 0 && line.bottom <= 841.89 - PAGE.left,
          `Vertical overflow: ${JSON.stringify(line)}`,
        );
        if (line.size !== 8)
          assert.ok(
            line.bottom <= PAGE.bottom,
            `Body text overlaps the footer area: ${JSON.stringify(line)}`,
          );
        if (line.size === 9) {
          assert.ok(
            line.bottom <= PAGE.bottom,
            `Table text outside the body: ${JSON.stringify(line)}`,
          );
          assert.ok(
            rectangles.some(
              (rect) =>
                rect.page === line.page &&
                rect.y <= line.y &&
                rect.y + rect.height >= line.bottom,
            ),
            `Text outside its table frame: ${JSON.stringify(line)}`,
          );
        }
      }
      for (const rect of rectangles) {
        assert.ok(
          rect.x >= PAGE.left && rect.x + rect.width <= PAGE.right + 0.1,
        );
        assert.ok(
          rect.y >= PAGE.top && rect.y + rect.height <= PAGE.bottom + 0.001,
          `Table frame outside the body: ${JSON.stringify(rect)}`,
        );
      }
    },
  };
}

function creditFixture(invoice: Invoice): CreditNote {
  return {
    id: "credit-1",
    creditNumber: "G-1",
    invoiceId: invoice.id,
    invoiceNumberSnapshot: invoice.invoiceNumber,
    orderNumberSnapshot: invoice.orderNumberSnapshot,
    customerNameSnapshot: invoice.customerNameSnapshot,
    company: invoice.company,
    customerStreet: invoice.customerStreet,
    customerPostalCity: invoice.customerPostalCity,
    creditDate: invoice.invoiceDate,
    taxPercent: invoice.taxPercent,
    text: invoice.text,
    entries: invoice.entries,
    archivedAt: null,
    purgeAt: null,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}

function reminderFixture(text: string): ReminderEvent {
  return {
    id: "reminder-1",
    invoiceId: "invoice-42",
    invoiceNumberSnapshot: "R-42",
    orderNumberSnapshot: null,
    customerNameSnapshot: "Ada Beispiel",
    level: 1,
    dueDate: new Date("2026-10-21T00:00:00Z"),
    outstandingAmount: new Prisma.Decimal(238),
    fee: new Prisma.Decimal(10),
    text,
    actorName: "Admin",
    sentAt: null,
    archivedAt: null,
    purgeAt: null,
    createdAt: new Date("2026-10-09"),
    updatedAt: new Date("2026-10-09"),
  };
}

function assertFooterAndTotals(
  capture: ReturnType<typeof inspectPdf>,
  prefixes: string[],
) {
  const totals = prefixes.map((prefix) => {
    const matches = capture.calls.filter((call) =>
      call.value.startsWith(prefix),
    );
    assert.equal(matches.length, 1, prefix);
    return matches[0]!;
  });
  assert.ok(
    totals.every((call) => call.page === totals[0]!.page),
    "Totals must stay together",
  );
  const bank = capture.calls.filter((call) => call.value === "Bankverbindung:");
  const iban = capture.calls.filter((call) => call.value.startsWith("IBAN:"));
  const bic = capture.calls.filter((call) => call.value.startsWith("BIC:"));
  assert.equal(bank.length, 1);
  assert.equal(iban.length, 1);
  assert.equal(bic.length, 1);
  const lastPage = Math.max(...capture.calls.map((call) => call.page));
  assert.ok([...bank, ...iban, ...bic].every((call) => call.page === lastPage));
  for (const call of capture.calls.filter(
    (call) => call.size !== 8 && call.page === lastPage,
  )) {
    assert.ok(call.y < bank[0]!.y, "Body must not overlap the bank footer");
  }
}

for (const kind of ["invoice", "credit"] as const) {
  const render = (invoice: Invoice) =>
    kind === "invoice"
      ? generateInvoicePdf(invoice)
      : generateCreditNotePdf(creditFixture(invoice));
  test(`${kind}: empty tax-free documents preserve the short one-page layout`, async (context) => {
    const capture = inspectPdf(context);
    const pdf = await render({
      ...invoiceFixture(),
      entries: [],
      text: "",
      taxPercent: new Prisma.Decimal(0),
    });
    capture.assertBounds(pdf, 1, 1);
    assertFooterAndTotals(capture, [
      "Nettobetrag:",
      "0% MwSt:",
      "Gesamtbetrag:",
    ]);
    assert.ok(
      capture.calls.some(
        (call) =>
          call.value ===
          `Gesamtbetrag:   ${kind === "credit" ? "- " : ""}${euro(0)}`,
      ),
    );
  });

  test(`${kind}: line amounts and totals use the shared decimal calculation`, async (context) => {
    const capture = inspectPdf(context);
    const pdf = await render({
      ...invoiceFixture(),
      entries: [{ description: "Dezimalpreis", quantity: 3, unitPrice: 1.005 }],
    });
    capture.assertBounds(pdf, 1, 1);
    assert.ok(
      capture.calls.some(
        (call) => call.value === euro(kind === "credit" ? -3.015 : 3.015),
      ),
    );
    assert.ok(
      capture.calls.some(
        (call) =>
          call.value ===
          `Nettobetrag:   ${kind === "credit" ? "- " : ""}${euro(2.535)}`,
      ),
    );
    assert.ok(
      capture.calls.some(
        (call) =>
          call.value ===
          `Gesamtbetrag:   ${kind === "credit" ? "- " : ""}${euro(3.015)}`,
      ),
    );
  });

  test(`${kind}: 50 short positions fit two pages instead of producing off-page text`, async (context) => {
    const capture = inspectPdf(context);
    const invoice = invoiceFixture();
    const entries = Array.from({ length: 50 }, (_, i) => ({
      description: `Position ${i + 1}`,
      quantity: 1,
      unitPrice: 1,
    }));
    invoice.entries = entries;
    const pdf = await render(invoice);
    capture.assertBounds(pdf, 2, 2);
    const descriptions = capture.calls.filter(
      (call) =>
        call.size === 9 &&
        call.x === PAGE.left + 4 &&
        call.value !== "Bezeichnung",
    );
    assert.deepEqual(
      descriptions.map((call) => call.value),
      entries.map((entry) => entry.description),
    );
    const headers = capture.calls.filter(
      (call) => call.value === "Bezeichnung",
    );
    assert.deepEqual(
      headers.map((call) => call.page),
      [1, 2],
    );
    assertFooterAndTotals(capture, [
      "Nettobetrag:",
      "19% MwSt:",
      "Gesamtbetrag:",
    ]);
    assert.ok(
      capture.calls.some(
        (call) =>
          call.value ===
          `Gesamtbetrag:   ${kind === "credit" ? "- " : ""}${euro(50)}`,
      ),
    );
  });

  test(`${kind}: 200 mixed multiline positions and maximum-length payment text retain every entry`, async (context) => {
    const capture = inspectPdf(context);
    const invoice = invoiceFixture();
    const entries = Array.from({ length: 200 }, (_, i) => ({
      description:
        `Position ${i + 1}: ${"Verpacken mit Schutzmaterial. ".repeat(i % 25 === 0 ? 75 : 4)}`.slice(
          0,
          2000 - `ENDE-${i + 1}`.length,
        ) + `ENDE-${i + 1}`,
      quantity: 2,
      unitPrice: 10,
    }));
    invoice.entries = entries;
    invoice.text =
      `ZAHLUNG-ANFANG\n${"Bitte überweisen Sie den fälligen Betrag.\n".repeat(300)}`.slice(
        0,
        10000 - "TEXT-ENDE".length,
      ) + "TEXT-ENDE";
    const pdf = await render(invoice);
    capture.assertBounds(pdf, 10, 45);
    const descriptions = capture.calls.filter(
      (call) =>
        call.size === 9 &&
        call.x === PAGE.left + 4 &&
        call.value !== "Bezeichnung",
    );
    assert.equal(
      descriptions.map((call) => call.value).join(""),
      entries.map((entry) => entry.description).join(""),
    );
    assert.equal(
      descriptions
        .flatMap((call) => call.rendered)
        .join("")
        .replace(/\s/gu, ""),
      entries
        .map((entry) => entry.description)
        .join("")
        .replace(/\s/gu, ""),
    );
    for (const page of new Set(descriptions.map((call) => call.page))) {
      assert.equal(
        capture.calls.filter(
          (call) => call.value === "Bezeichnung" && call.page === page,
        ).length,
        1,
        `Missing/repeated header on page ${page}`,
      );
    }
    for (const header of capture.calls.filter(
      (call) => call.value === "Bezeichnung",
    )) {
      assert.ok(
        descriptions.some((call) => call.page === header.page),
        `Orphaned header on page ${header.page}`,
      );
    }
    const payment = capture.calls.filter(
      (call) =>
        call.size === 10 &&
        call.x === PAGE.left &&
        ![
          invoice.company,
          invoice.customerNameSnapshot,
          invoice.customerStreet,
          invoice.customerPostalCity,
        ].includes(call.value),
    );
    assert.equal(payment.map((call) => call.value).join(""), invoice.text);
    assert.equal(
      payment
        .flatMap((call) => call.rendered)
        .join("")
        .replace(/\s/gu, ""),
      invoice.text.replace(/\s/gu, ""),
    );
    assertFooterAndTotals(capture, [
      "Nettobetrag:",
      "19% MwSt:",
      "Gesamtbetrag:",
    ]);
    for (const value of [
      `Nettobetrag:   ${kind === "credit" ? "- " : ""}${euro(3361.34)}`,
      `19% MwSt:     ${kind === "credit" ? "- " : ""}${euro(638.66)}`,
      `Gesamtbetrag:   ${kind === "credit" ? "- " : ""}${euro(4000)}`,
    ]) {
      assert.ok(
        capture.calls.some((call) => call.value === value),
        value,
      );
    }
    const lastRow = descriptions.at(-1)!;
    const net = capture.calls.find((call) =>
      call.value.startsWith("Nettobetrag:"),
    )!;
    assert.ok(
      net.page > lastRow.page ||
        (net.page === lastRow.page && net.y > lastRow.y),
    );
  });

  test(`${kind}: all 200 positions can each exceed a page at the permitted 2000-character limit`, async (context) => {
    const capture = inspectPdf(context);
    const entries = Array.from({ length: 200 }, (_, i) => ({
      description: `${String(i).padStart(3, "0")}${"W".repeat(1997)}`,
      quantity: 1,
      unitPrice: 1,
    }));
    const pdf = await render({ ...invoiceFixture(), entries });
    capture.assertBounds(pdf, 200, 300);
    const descriptions = capture.calls.filter(
      (call) =>
        call.size === 9 &&
        call.x === PAGE.left + 4 &&
        call.value !== "Bezeichnung",
    );
    assert.equal(
      descriptions.map((call) => call.value).join(""),
      entries.map((entry) => entry.description).join(""),
    );
    assert.equal(
      descriptions.flatMap((call) => call.rendered).join(""),
      entries.map((entry) => entry.description).join(""),
    );
    assertFooterAndTotals(capture, [
      "Nettobetrag:",
      "19% MwSt:",
      "Gesamtbetrag:",
    ]);
  });

  for (const description of [
    `ANFANG-${"W".repeat(1950)}-ENDE`,
    `ANFANG\n${Array.from({ length: 120 }, (_, i) => `Zeile ${i}\n`).join("")}ENDE`,
  ]) {
    test(`${kind}: a description taller than a whole page splits without loss or duplicated amounts (${description.includes("\n") ? "newlines" : "unbroken word"})`, async (context) => {
      const capture = inspectPdf(context);
      const invoice = {
        ...invoiceFixture(),
        text: "",
        entries: [{ description, quantity: 2, unitPrice: 123.45 }],
      };
      const pdf = await render(invoice);
      capture.assertBounds(pdf, 2, 4);
      const descriptions = capture.calls.filter(
        (call) =>
          call.size === 9 &&
          call.x === PAGE.left + 4 &&
          call.value !== "Bezeichnung",
      );
      assert.equal(
        descriptions.map((call) => call.value).join(""),
        description,
      );
      assert.equal(
        descriptions
          .flatMap((call) => call.rendered)
          .join("")
          .replace(/\s/gu, ""),
        description.replace(/\s/gu, ""),
      );
      assert.equal(
        capture.calls.filter(
          (call) => call.value === euro(kind === "credit" ? -246.9 : 246.9),
        ).length,
        1,
      );
      assertFooterAndTotals(capture, [
        "Nettobetrag:",
        "19% MwSt:",
        "Gesamtbetrag:",
      ]);
    });
  }
}

for (const text of [
  "Mahntext",
  `ANFANG\n${"Bitte begleichen Sie den offenen Betrag.\n".repeat(300)}`.slice(
    0,
    9990,
  ) + "ENDE",
  "A".repeat(10000),
]) {
  test(`reminder: text, both payment tables, totals and footer stay in bounds (${text.length} characters)`, async (context) => {
    const capture = inspectPdf(context);
    const invoice = invoiceFixture();
    const pdf = await generateReminderPdf(
      reminderFixture(text),
      invoice,
      "2026-10-11",
    );
    capture.assertBounds(
      pdf,
      text.length === 8 ? 1 : 3,
      text.length === 8 ? 1 : 9,
    );
    const paragraphs = capture.calls.filter(
      (call) =>
        call.size === 10 &&
        call.x === PAGE.left &&
        ![
          invoice.company,
          invoice.customerNameSnapshot,
          invoice.customerStreet,
          invoice.customerPostalCity,
        ].includes(call.value),
    );
    assert.equal(paragraphs.map((call) => call.value).join(""), text);
    assert.equal(
      paragraphs
        .flatMap((call) => call.rendered)
        .join("")
        .replace(/\s/gu, ""),
      text.replace(/\s/gu, ""),
    );
    for (const expected of [
      "Rechnung Nr.",
      "vom",
      "Betrag",
      "Offener Betrag",
      "Fälligkeit",
      "Verzug",
      "R-42",
      "11.10.2026",
      "11 Tage",
      `Mahngebühr:   ${euro(10)}`,
      `Summe fälliger Posten:   ${euro(248)}`,
    ]) {
      assert.equal(
        capture.calls.filter((call) => call.value === expected).length,
        1,
        expected,
      );
    }
    assertFooterAndTotals(capture, ["Mahngebühr:", "Summe fälliger Posten:"]);
  });
}

test("table heights account for every column, and totals/footer handle exact page boundaries", async (context) => {
  const capture = inspectPdf(context);
  const { doc, done } = startAccountingPdf("Layout test", [], []);
  const longNumber = "1234567890 ".repeat(60);
  const y = drawTable(
    doc,
    ["A", "B"],
    [["short", longNumber]],
    [PAGE.left, 315, PAGE.right],
    PAGE.bottom - 20,
    ["left", "right"],
  );
  const summaryY = drawTotals(doc, ["Netto:", "Steuer:", "Gesamt:"], y + 28);
  drawText(doc, "Zahlung", summaryY);
  drawBankFooter(doc, 810);
  doc.end();
  const pdf = await done;
  capture.assertBounds(pdf, 3, 3);
  assert.equal(
    capture.calls
      .filter((call) => /^[0-9 ]+$/u.test(call.value))
      .map((call) => call.value)
      .join(""),
    longNumber,
  );
  assertFooterAndTotals(capture, ["Netto:", "Steuer:", "Gesamt:"]);
});

test("a totals block that cannot fit moves intact before payment text and the footer", async (context) => {
  const capture = inspectPdf(context);
  const { doc, done } = startAccountingPdf("Page boundary", [], []);
  const y = drawTable(
    doc,
    ["Position"],
    [["Last row"]],
    [PAGE.left, PAGE.right],
    PAGE.bottom - 60,
    ["left"],
  );
  const afterTotals = drawTotals(doc, ["Netto:", "Steuer:", "Gesamt:"], y + 28);
  const afterText = drawText(doc, "Bitte zahlen.", afterTotals);
  drawBankFooter(doc, Math.max(afterText, 711.7), "Maschinell erstellt.");
  doc.end();
  capture.assertBounds(await done, 2, 2);
  assert.equal(
    capture.calls.find((call) => call.value === "Last row")!.page,
    1,
  );
  assert.equal(capture.calls.find((call) => call.value === "Netto:")!.page, 2);
  assertFooterAndTotals(capture, ["Netto:", "Steuer:", "Gesamt:"]);
});

test("one text line exactly at the body boundary does not create an extra page or lose text", async (context) => {
  const capture = inspectPdf(context);
  const { doc, done } = startAccountingPdf("Exact text boundary", [], []);
  doc.font("Helvetica").fontSize(10);
  drawText(doc, "Letzte Zeile", PAGE.bottom - doc.currentLineHeight(true));
  drawBankFooter(doc, 725);
  doc.end();
  capture.assertBounds(await done, 1, 1);
  assert.equal(
    capture.calls.filter((call) => call.value === "Letzte Zeile").length,
    1,
  );
});

test("invoice PDF uses the form invoice date even after editing or archiving", async (context) => {
  const texts: string[] = [];
  const original = PDFDocument.prototype.text;
  context.mock.method(
    PDFDocument.prototype,
    "text",
    function (
      this: PDFKit.PDFDocument,
      value: string,
      x: number,
      y: number,
      options?: PDFKit.Mixins.TextOptions,
    ) {
      texts.push(value);
      return original.call(this, value, x, y, options);
    },
  );
  await generateInvoicePdf({
    ...invoiceFixture(),
    updatedAt: new Date("2026-10-11T10:00:00Z"),
    archivedAt: new Date("2026-10-12T10:00:00Z"),
  });
  assert.ok(texts.includes("Rechnungsdatum: 9.10.2026"));
  assert.ok(!texts.includes("Rechnungsdatum: 11.10.2026"));
  assert.ok(!texts.includes("Rechnungsdatum: 12.10.2026"));
});
