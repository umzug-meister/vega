import assert from "node:assert/strict";
import test from "node:test";
import PDFDocument from "pdfkit";
import {
  addIsoDays,
  formatGermanDate,
  reminderDelayDays,
  reminderGreeting,
  reminderText,
} from "@vega/domain";
import {
  Prisma,
  type CreditNote,
  type Invoice,
  type ReminderEvent,
} from "../src/generated/prisma/client.js";
import {
  validateCreditNote,
  validateReminder,
} from "../src/invoices/accounting-input.js";
import { invoiceDueDate } from "../src/invoices/reminder-routes.js";
import {
  creditNoteEmail,
  reminderEmail,
} from "../src/mail/staff-email-templates.js";
import {
  creditNotePdfFilename,
  generateCreditNotePdf,
} from "../src/pdf/credit-note-pdf.js";
import {
  generateReminderPdf,
  reminderPdfFilename,
} from "../src/pdf/reminder-pdf.js";

const created = new Date("2026-10-01T00:00:00.000Z");
const invoice = {
  invoiceNumber: "R-42",
  invoiceDate: created,
  company: "",
  customerNameSnapshot: "Ada Beispiel",
  customerStreet: "Teststraße 1",
  customerPostalCity: "80331 München",
  entries: [{ description: "Umzug", quantity: 2, unitPrice: 100 }],
  taxPercent: new Prisma.Decimal(19),
} satisfies Partial<Invoice>;

function capturedTexts(context: test.TestContext) {
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
  return texts;
}

test("reminder dates follow the legacy 10-day rhythm and inclusive Verzug count", () => {
  assert.equal(addIsoDays("2026-12-28", 10), "2027-01-07");
  assert.equal(formatGermanDate("2026-03-05"), "05.03.2026");
  assert.equal(reminderDelayDays("2026-10-11", "2026-10-21"), 11);
  assert.equal(
    invoiceDueDate({ invoiceDate: created, dueDates: [] }),
    "2026-10-11",
  );
  assert.equal(
    invoiceDueDate({
      invoiceDate: created,
      dueDates: [{ date: "2026-10-20", amount: 0, text: "" }],
    }),
    "2026-10-20",
  );
});

test("reminder greeting uses the order salutation and falls back to a neutral greeting", () => {
  assert.equal(
    reminderGreeting({ company: "", salutation: "Frau", lastName: "Beispiel" }),
    "Sehr geehrte Frau Beispiel,",
  );
  assert.equal(
    reminderGreeting({ company: "", salutation: "Herr", lastName: "Muster" }),
    "Sehr geehrter Herr Muster,",
  );
  assert.equal(
    reminderGreeting({
      company: "Beispiel GmbH",
      salutation: "Herr",
      lastName: "Muster",
    }),
    "Sehr geehrte Damen und Herren,",
  );
  assert.equal(
    reminderGreeting({ company: "" }),
    "Sehr geehrte Damen und Herren,",
  );
});

test("reminder texts port the three legacy levels", () => {
  const dueDates = ["2026-10-11", "2026-10-21", "2026-10-31", "2026-11-10"];
  const first = reminderText({
    level: 1,
    greeting: "Sehr geehrte Damen und Herren,",
    outstandingAmount: 238,
    dueDates: dueDates.slice(0, 2),
  });
  assert.match(
    first,
    /^Sehr geehrte Damen und Herren,\n\ngewiss ist es Ihnen entgangen, dass ein Betrag in Höhe von 238,00\s€ bereits am 11\.10\.2026 fällig war\./u,
  );
  assert.match(first, /bis zum 21\.10\.2026 vorzunehmen/u);
  assert.match(first, /Mit freundlichen Grüßen\nAlexander Berent$/u);
  assert.match(
    reminderText({
      level: 2,
      greeting: "x",
      outstandingAmount: 238,
      dueDates: dueDates.slice(0, 3),
    }),
    /auf unsere Mahnung vom 21\.10\.2026 haben Sie leider nicht reagiert\. Bitte überweisen Sie den fälligen Betrag bis zum 31\.10\.2026\./u,
  );
  assert.match(
    reminderText({ level: 3, greeting: "x", outstandingAmount: 238, dueDates }),
    /Mahnung vom 21\.10\.2026 und 2\. Mahnung vom 31\.10\.2026 haben Sie nicht reagiert\. Bitte überweisen Sie den fälligen Betrag bis spätestens 10\.11\.2026\. .*gerichtliche Schritte/u,
  );
});

test("credit note and reminder input validation rejects incomplete or negative values", () => {
  assert.equal(
    validateCreditNote({
      creditNumber: " ",
      creditDate: "2026-10-01",
      text: "",
      entries: [],
    }).ok,
    false,
  );
  assert.equal(
    validateCreditNote({
      creditNumber: "G-1",
      creditDate: "2026-13-45",
      text: "",
      entries: [],
    }).ok,
    false,
  );
  assert.equal(
    validateCreditNote({
      creditNumber: "G-1",
      creditDate: "2026-10-01",
      text: "",
      entries: [{ description: "x", quantity: -1, unitPrice: 1 }],
    }).ok,
    false,
  );
  assert.deepEqual(
    validateCreditNote({
      creditNumber: " G-1 ",
      creditDate: "2026-10-01",
      text: "t",
      entries: [{ description: "x", quantity: 1, unitPrice: 2, extra: true }],
    }),
    {
      ok: true,
      value: {
        creditNumber: "G-1",
        creditDate: "2026-10-01",
        text: "t",
        entries: [{ description: "x", quantity: 1, unitPrice: 2 }],
      },
    },
  );
  assert.equal(
    validateReminder({
      dueDate: "2026-10-01",
      fee: -1,
      outstandingAmount: 1,
      text: "",
    }).ok,
    false,
  );
  assert.deepEqual(
    validateReminder({
      dueDate: "2026-10-01",
      fee: 10.005,
      outstandingAmount: 238,
      text: "t",
    }),
    {
      ok: true,
      value: {
        dueDate: "2026-10-01",
        fee: 10.01,
        outstandingAmount: 238,
        text: "t",
      },
    },
  );
});

test("credit note PDF negates amounts like the legacy CreditPdf", async (context) => {
  const texts = capturedTexts(context);
  const credit: CreditNote = {
    id: "credit-1",
    creditNumber: "G-7",
    invoiceId: "invoice-1",
    invoiceNumberSnapshot: "R-42",
    orderNumberSnapshot: null,
    customerNameSnapshot: "Frau Ada Beispiel",
    company: "",
    customerStreet: "Teststraße 1",
    customerPostalCity: "80331 München",
    creditDate: created,
    taxPercent: new Prisma.Decimal(19),
    text: "Erstattung",
    entries: invoice.entries,
    archivedAt: null,
    purgeAt: null,
    createdAt: created,
    updatedAt: created,
  };
  const pdf = await generateCreditNotePdf(credit);
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(texts.includes("Gutschrift Nr: G-7  /  Rechnung Nr: R-42"));
  assert.ok(texts.some((value) => /^-200,00\s€$/u.test(value)));
  assert.ok(
    texts.some((value) => /^Gesamtbetrag: {3}- 200,00\s€$/u.test(value)),
  );
  assert.equal(creditNotePdfFilename(credit), "G-G-7 Ada Beispiel.pdf");
});

test("reminder PDF shows invoice, overdue table, fee and total", async (context) => {
  const texts = capturedTexts(context);
  const reminder: ReminderEvent = {
    id: "reminder-1",
    invoiceId: "invoice-1",
    invoiceNumberSnapshot: "R-42",
    orderNumberSnapshot: null,
    customerNameSnapshot: "Ada Beispiel",
    level: 1,
    dueDate: new Date("2026-10-21T00:00:00.000Z"),
    outstandingAmount: new Prisma.Decimal(238),
    fee: new Prisma.Decimal(10),
    text: "Mahntext",
    actorName: "Admin",
    sentAt: null,
    archivedAt: null,
    purgeAt: null,
    createdAt: created,
    updatedAt: created,
  };
  const pdf = await generateReminderPdf(reminder, invoice, "2026-10-11");
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  for (const expected of [
    "1. Mahnung",
    "Mahntext",
    "R-42",
    "11.10.2026",
    "11 Tage",
  ])
    assert.ok(texts.includes(expected), expected);
  assert.ok(
    texts.some((value) => /^Summe fälliger Posten: {3}248,00\s€$/u.test(value)),
  );
  assert.equal(
    reminderPdfFilename(reminder, ""),
    "Mahnung Nr.1 R-42 Ada Beispiel.pdf",
  );
});

test("credit note and reminder mail drafts escape customer data", () => {
  const credit = creditNoteEmail("G-<1>", "R-42", undefined, "Ada");
  assert.equal(credit.subject, "Gutschrift G-<1> zu Ihrer Rechnung R-42");
  assert.match(
    credit.contentHtml,
    /^<p>Hallo Ada,<\/p><p>anbei erhalten Sie die Gutschrift G-&lt;1&gt;/u,
  );
  const reminder = reminderEmail(
    2,
    "R-42",
    "31.10.2026",
    "Sehr geehrte Frau Beispiel,",
  );
  assert.equal(reminder.subject, "2. Mahnung zu Ihrer Rechnung R-42");
  assert.match(
    reminder.contentHtml,
    /die 2\. Mahnung zu Ihrer Rechnung R-42\. Bitte begleichen Sie den offenen Betrag bis zum 31\.10\.2026\./u,
  );
});
