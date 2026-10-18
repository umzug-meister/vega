import assert from "node:assert/strict";
import test from "node:test";
import {
  addInvoiceAmounts,
  calculateInvoiceTotals,
  invoiceLineTotal,
  isInvoiceDate,
  MAX_INVOICE_AMOUNT,
  roundInvoiceAmount,
} from "@vega/domain";
import { validateInvoice } from "../src/invoices/invoice-input.js";
import {
  validateCreditNote,
  validateReminder,
} from "../src/invoices/accounting-input.js";

const input = {
  invoiceDate: "2026-10-11",
  company: "",
  customerName: "Test",
  customerStreet: "",
  customerPostalCity: "",
  taxPercent: 19,
  text: "",
  entries: [],
  dueDates: [],
};
const credit = {
  creditNumber: "G-42",
  creditDate: "2026-10-11",
  text: "",
  entries: [],
};
const reminder = {
  dueDate: "2026-10-11",
  text: "",
  fee: 10,
  outstandingAmount: 238,
};

test("all financial dates require real calendar dates in the MySQL range", () => {
  for (const date of [
    "2026-02-31",
    "2026-02-29",
    "2024-04-31",
    "2026-00-01",
    "2026-01-00",
    "2026-13-01",
    "2026-1-01",
    "2026-01-01T00:00:00Z",
    "",
    "0000-01-01",
    "0999-12-31",
    "10000-01-01",
    null,
    20260101,
  ]) {
    assert.equal(isInvoiceDate(date), false, String(date));
    assert.equal(
      validateInvoice({ ...input, invoiceDate: date }).ok,
      false,
      String(date),
    );
    assert.equal(
      validateInvoice({ ...input, dueDates: [{ date, amount: 0, text: "" }] })
        .ok,
      false,
      String(date),
    );
    assert.equal(
      validateCreditNote({ ...credit, creditDate: date }).ok,
      false,
      String(date),
    );
    assert.equal(
      validateReminder({ ...reminder, dueDate: date }).ok,
      false,
      String(date),
    );
  }
  for (const date of ["1000-01-01", "2000-02-29", "2024-02-29", "9999-12-31"]) {
    assert.equal(
      validateInvoice({ ...input, invoiceDate: date }).ok,
      true,
      date,
    );
    assert.equal(
      validateCreditNote({ ...credit, creditDate: date }).ok,
      true,
      date,
    );
    assert.equal(
      validateReminder({ ...reminder, dueDate: date }).ok,
      true,
      date,
    );
  }
});

test("invoice, credit, due amounts and reminder amounts reject nonfinite and out-of-range values", () => {
  const overflowJson: unknown = JSON.parse("1e400");
  for (const amount of [
    overflowJson,
    NaN,
    -Infinity,
    Infinity,
    -0.01,
    10_000_000_000,
    9_999_999_999.995,
    1e30,
    "1",
    null,
  ]) {
    for (const key of ["quantity", "unitPrice"]) {
      const entry = {
        description: "x",
        quantity: 1,
        unitPrice: 1,
        [key]: amount,
      };
      assert.equal(
        validateInvoice({ ...input, entries: [entry] }).ok,
        false,
        `${key}: ${String(amount)}`,
      );
      assert.equal(
        validateCreditNote({ ...credit, entries: [entry] }).ok,
        false,
      );
    }
    assert.equal(
      validateInvoice({
        ...input,
        dueDates: [{ date: "2026-10-11", amount, text: "" }],
      }).ok,
      false,
    );
    assert.equal(validateReminder({ ...reminder, fee: amount }).ok, false);
    assert.equal(
      validateReminder({ ...reminder, outstandingAmount: amount }).ok,
      false,
    );
  }
  for (const amount of [0, 0.001, 10.005, MAX_INVOICE_AMOUNT]) {
    assert.equal(
      validateInvoice({
        ...input,
        taxPercent: 0,
        entries: [{ description: "", quantity: 1, unitPrice: amount }],
        dueDates: [{ date: "2026-10-11", amount, text: "" }],
      }).ok,
      true,
    );
    assert.equal(
      validateReminder({ ...reminder, fee: amount, outstandingAmount: amount })
        .ok,
      true,
    );
  }
  assert.equal(
    validateInvoice({
      ...input,
      entries: [
        { description: "", quantity: 2, unitPrice: MAX_INVOICE_AMOUNT },
      ],
    }).ok,
    false,
  );
  assert.equal(
    validateInvoice({
      ...input,
      taxPercent: 0,
      entries: [
        { description: "", quantity: 1, unitPrice: MAX_INVOICE_AMOUNT },
        { description: "", quantity: 1, unitPrice: 0.01 },
      ],
    }).ok,
    false,
  );
  assert.equal(
    validateInvoice({
      ...input,
      entries: [
        { description: "", quantity: 1, unitPrice: MAX_INVOICE_AMOUNT },
      ],
    }).ok,
    true,
  );
});

test("financial input bounds collections and strings, strips arbitrary entry properties", () => {
  const entry = { description: "x", quantity: 1, unitPrice: 2 };
  assert.equal(
    validateInvoice({ ...input, entries: Array(200).fill(entry) }).ok,
    true,
  );
  assert.equal(
    validateInvoice({ ...input, entries: Array(201).fill(entry) }).ok,
    false,
  );
  for (const invalid of [null, {}, "entries", [null], [[entry]]]) {
    assert.equal(validateInvoice({ ...input, entries: invalid }).ok, false);
    assert.equal(validateCreditNote({ ...credit, entries: invalid }).ok, false);
  }
  const due = { date: input.invoiceDate, amount: 1, text: "" };
  assert.equal(
    validateInvoice({ ...input, dueDates: Array(20).fill(due) }).ok,
    true,
  );
  assert.equal(
    validateInvoice({ ...input, dueDates: Array(21).fill(due) }).ok,
    false,
  );
  for (const [key, length] of Object.entries({
    company: 191,
    customerName: 300,
    customerStreet: 191,
    customerPostalCity: 191,
    text: 10000,
    invoiceNumber: 64,
  })) {
    assert.equal(
      validateInvoice({ ...input, [key]: "x".repeat(length) }).ok,
      true,
      key,
    );
    assert.equal(
      validateInvoice({ ...input, [key]: "x".repeat(length + 1) }).ok,
      false,
      key,
    );
  }
  assert.equal(
    validateInvoice({
      ...input,
      entries: [{ ...entry, description: "x".repeat(2001) }],
    }).ok,
    false,
  );
  assert.equal(
    validateInvoice({
      ...input,
      dueDates: [{ ...due, text: "x".repeat(2001) }],
    }).ok,
    false,
  );
  assert.equal(
    validateCreditNote({ ...credit, text: "x".repeat(10001) }).ok,
    false,
  );
  assert.equal(
    validateReminder({ ...reminder, text: "x".repeat(10001) }).ok,
    false,
  );
  const normalized = validateInvoice({
    ...input,
    entries: [{ ...entry, extra: "ignored" }],
    dueDates: [{ ...due, extra: true }],
  });
  assert.ok(normalized.ok);
  assert.deepEqual(normalized.value.entries, [entry]);
  assert.deepEqual(normalized.value.dueDates, [due]);
});

test("shared decimal totals avoid float drift and extract VAT from gross line prices", () => {
  assert.equal(invoiceLineTotal({ quantity: 3, unitPrice: 0.1 }), 0.3);
  assert.equal(addInvoiceAmounts([0.1, 0.2]), 0.3);
  assert.equal(addInvoiceAmounts([238, 10]), 248);
  assert.deepEqual(
    calculateInvoiceTotals(
      [
        { quantity: 3, unitPrice: 0.1 },
        { quantity: 1, unitPrice: 0.2 },
      ],
      19,
    ),
    { net: 0.42, tax: 0.08, total: 0.5 },
  );
  assert.deepEqual(
    calculateInvoiceTotals([{ quantity: 0.001, unitPrice: 1e-7 }], 0),
    { net: 1e-10, tax: 0, total: 1e-10 },
  );
  assert.deepEqual(
    calculateInvoiceTotals([{ quantity: 2, unitPrice: 100 }], 19),
    { net: 168.07, tax: 31.93, total: 200 },
  );
  assert.deepEqual(
    calculateInvoiceTotals([{ quantity: 1, unitPrice: 1325 }], 19),
    { net: 1113.45, tax: 211.55, total: 1325 },
  );
  assert.equal(roundInvoiceAmount(10.005), 10.01);
  assert.equal(roundInvoiceAmount(1.005), Math.round(1.005 * 100) / 100);
});
