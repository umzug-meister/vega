import type { Prisma } from "../generated/prisma/client.js";
import {
  calculateInvoiceTotals, isInvoiceAmount, isInvoiceDate, manualInvoiceNextValue,
  MAX_INVOICE_SEQUENCE_VALUE, validateInvoiceEntries, type InvoiceInput,
} from "@vega/domain";

export function validateInvoice(value: unknown, creating = false): { ok: true; value: InvoiceInput } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: "Ungültige Rechnungsdaten." };
  if (value.taxPercent !== 19 && value.taxPercent !== 0) return { ok: false, message: "Umsatzsteuer muss 19 % oder 0 % sein." };
  const limits = { company: 191, customerName: 300, customerStreet: 191, customerPostalCity: 191, text: 10000 };
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof value[key] !== "string" || value[key].length > limit) return { ok: false, message: "Bitte prüfen Sie die Rechnungsdaten und Textlängen." };
  }
  if (!isInvoiceDate(value.invoiceDate) || !(value.customerName as string).trim()) return { ok: false, message: "Ein gültiges Rechnungsdatum und ein Kunde sind erforderlich." };
  const entries = validateInvoiceEntries(value.entries);
  if (!entries || !isInvoiceAmount(calculateInvoiceTotals(entries, value.taxPercent).total)) return { ok: false, message: "Ungültige Rechnungspositionen oder Rechnungssumme." };
  if (!Array.isArray(value.dueDates) || value.dueDates.length > 20) return { ok: false, message: "Ungültige Fälligkeiten." };
  const dueDates: InvoiceInput["dueDates"] = [];
  for (const entry of value.dueDates) {
    if (!isRecord(entry) || !isInvoiceDate(entry.date) || !isInvoiceAmount(entry.amount)
      || typeof entry.text !== "string" || entry.text.length > 2000) return { ok: false, message: "Ungültige Fälligkeiten." };
    dueDates.push({ date: entry.date, amount: entry.amount, text: entry.text });
  }
  if (value.invoiceNumber !== undefined && (typeof value.invoiceNumber !== "string" || value.invoiceNumber.trim().length > 64)) return { ok: false, message: "Ungültige Rechnungsnummer (max. 64 Zeichen)." };
  const invoiceNumber = typeof value.invoiceNumber === "string" && value.invoiceNumber.trim() ? value.invoiceNumber.trim() : undefined;
  const nextValue = manualInvoiceNextValue(invoiceNumber);
  if (creating && nextValue !== undefined && (!Number.isSafeInteger(nextValue) || nextValue > MAX_INVOICE_SEQUENCE_VALUE)) return { ok: false, message: "Rechnungsnummer überschreitet den unterstützten Nummernkreis (maximal R-2147483646)." };
  return {
    ok: true,
    value: {
      ...(invoiceNumber ? { invoiceNumber } : {}),
      invoiceDate: value.invoiceDate, company: (value.company as string).trim(),
      customerName: (value.customerName as string).trim(), customerStreet: (value.customerStreet as string).trim(),
      customerPostalCity: (value.customerPostalCity as string).trim(), taxPercent: value.taxPercent,
      text: value.text as string, entries, dueDates,
    },
  };
}

export function invoiceData(input: InvoiceInput, invoiceNumber: string): Omit<Prisma.InvoiceUncheckedCreateInput, "id" | "orderId" | "orderNumberSnapshot"> {
  return {
    invoiceNumber,
    invoiceDate: new Date(`${input.invoiceDate}T00:00:00.000Z`),
    company: input.company,
    customerNameSnapshot: input.customerName,
    customerStreet: input.customerStreet,
    customerPostalCity: input.customerPostalCity,
    taxPercent: input.taxPercent,
    text: input.text,
    entries: input.entries as unknown as Prisma.InputJsonValue,
    dueDates: input.dueDates as unknown as Prisma.InputJsonValue,
  };
}

export function toInvoiceDto(invoice: Prisma.InvoiceGetPayload<object>) {
  return {
    id: invoice.id,
    revision: invoice.revision,
    invoiceNumber: invoice.invoiceNumber,
    orderNumber: invoice.orderNumberSnapshot,
    invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
    company: invoice.company,
    customerName: invoice.customerNameSnapshot,
    customerStreet: invoice.customerStreet,
    customerPostalCity: invoice.customerPostalCity,
    taxPercent: Number(invoice.taxPercent),
    text: invoice.text,
    entries: invoice.entries,
    dueDates: invoice.dueDates,
    archivedAt: invoice.archivedAt,
    purgeAt: invoice.purgeAt,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
