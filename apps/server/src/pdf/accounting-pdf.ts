import { Buffer } from "node:buffer";
import { invoiceLineTotal } from "@vega/domain";
import PDFDocument from "pdfkit";
import { LEGACY_RZ24_LOGO } from "./legacy-logo.js";

export { calculateInvoiceTotals } from "@vega/domain";

/** Shared PDFKit layout of the legacy accounting documents (invoice, credit note, reminder). */
export const PAGE = {
  left: 56.7,
  right: 595.28 - 34,
  width: 595.28 - 34 - 56.7,
  top: 40,
  bottom: 690,
};
const pageNumbers = new WeakMap<PDFKit.PDFDocument, number>();

export interface InvoiceEntry {
  description: string;
  quantity: number;
  unitPrice: number;
}

export function startAccountingPdf(
  title: string,
  information: string[],
  customer: string[],
) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    info: { Title: title },
  });
  pageNumbers.set(doc, 1);
  doc.on("pageAdded", () =>
    pageNumbers.set(doc, (pageNumbers.get(doc) ?? 0) + 1),
  );
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const logo = Buffer.from(
    LEGACY_RZ24_LOGO.slice(LEGACY_RZ24_LOGO.indexOf(",") + 1),
    "base64",
  );
  doc.image(logo, PAGE.left, 22.7, { width: 96, height: 102 });
  drawRight(
    doc,
    [
      "Alexander Berent",
      "Am Münchfeld 31, 80999 München",
      "089 30642972 | 0176 10171990",
      "info@umzugruckzuck.de",
      "Steuernummer: 144/139/21180",
    ],
    37.1,
    8,
  );
  // Match the supplied reference PDF's postal block after the legacy header flow.
  let y = (8 + 5 + 15) / 0.353 + 5 * 12 + 3 * 6 - 6;
  // jsPDF uses baselines; PDFKit positions Helvetica text at the top (ascender 718/1000).
  text(
    doc,
    "Alexander Berent, Am Münchfeld 31, 80999 München",
    PAGE.left,
    y + 9.2 - 5.744,
    8,
  );
  y += 18.4 + 5 / 0.353;
  information.forEach((line) => {
    drawRight(doc, [line], y + 7 - 7.18, 10);
    y += 14;
  });
  y += 5 / 0.353;
  const customerY = y;
  customer.filter(Boolean).forEach((line, index) => {
    text(doc, line, PAGE.left, customerY + index * 14 + 7 - 7.18, 10);
  });
  return { doc, done };
}

export function drawHeading(
  doc: PDFKit.PDFDocument,
  value: string,
  y: number,
  size = 12,
) {
  doc
    .font("Helvetica-Bold")
    .fontSize(size)
    .fillColor("black")
    .text(value, PAGE.left, y, { width: PAGE.width, align: "center" });
}

export function drawEntriesTable(
  doc: PDFKit.PDFDocument,
  entries: InvoiceEntry[],
  y: number,
  sign: 1 | -1 = 1,
): number {
  const columns = [PAGE.left, 315, 393, 475, PAGE.right];
  return drawTable(
    doc,
    ["Bezeichnung", "Menge", "Einzelpreis", "Betrag"],
    entries.map((entry) => [
      entry.description,
      formatNumber(entry.quantity),
      euro(sign * entry.unitPrice),
      euro(sign * invoiceLineTotal(entry)),
    ]),
    columns,
    y,
    ["left", "right", "right", "right"],
  );
}

export function drawTable(
  doc: PDFKit.PDFDocument,
  head: string[],
  rows: string[][],
  columns: number[],
  y: number,
  align: Array<"left" | "right" | "center">,
  color = "black",
): number {
  doc.font("Helvetica").fontSize(9);
  const width = (i: number) => columns[i + 1]! - columns[i]! - 8;
  const height = (values: string[]) =>
    Math.max(
      14.4,
      ...values.map(
        (value, i) => doc.heightOfString(value, { width: width(i) }) + 4,
      ),
    );
  const headerHeight = height(head);
  const minimumRowHeight = Math.max(14.4, doc.currentLineHeight(true) + 4);
  const left = columns[0]!;
  const right = columns[columns.length - 1]!;
  let rowsOnPage = 0;
  const header = () => {
    rowsOnPage = 0;
    doc
      .fillColor("#6987a3")
      .rect(left, y, right - left, headerHeight)
      .fill();
    doc.fillColor("white").font("Helvetica").fontSize(9);
    head.forEach((label, i) =>
      doc.text(label, columns[i]! + 4, y + 5, {
        width: width(i),
        align: align[i] ?? "left",
      }),
    );
    y += headerHeight;
  };
  const nextPage = () => {
    doc.addPage();
    y = PAGE.top;
    header();
  };
  y = accountingSpace(
    doc,
    y,
    headerHeight + (rows.length ? minimumRowHeight : 0),
  );
  header();
  for (const row of rows) {
    const rowHeight = height(row);
    if (
      rowsOnPage &&
      y + rowHeight > PAGE.bottom &&
      rowHeight <= PAGE.bottom - PAGE.top - headerHeight
    )
      nextPage();
    let remaining = row;
    do {
      if (y + minimumRowHeight > PAGE.bottom) nextPage();
      const parts = remaining.map((value, i) =>
        fitText(doc, value, width(i), PAGE.bottom - y - 4),
      );
      const fragmentHeight = height(parts.map((part) => part.text));
      doc
        .strokeColor("#6987a3")
        .rect(left, y, right - left, fragmentHeight)
        .stroke();
      doc.fillColor(color);
      parts.forEach((part, i) => {
        if (part.text)
          doc.text(part.text, columns[i]! + 4, y + 5, {
            width: width(i),
            align: align[i] ?? "left",
          });
      });
      y += fragmentHeight;
      rowsOnPage++;
      remaining = parts.map((part) => part.rest);
      if (remaining.some(Boolean)) nextPage();
    } while (remaining.some(Boolean));
  }
  doc.fillColor("black");
  return y;
}

/** Draws the free text and returns the y position below it. */
export function drawText(
  doc: PDFKit.PDFDocument,
  value: string,
  y: number,
): number {
  if (!value) return y;
  doc.font("Helvetica").fontSize(10);
  while (value) {
    y = accountingSpace(doc, y, doc.currentLineHeight(true));
    const part = fitText(doc, value, PAGE.width, PAGE.bottom - y);
    text(doc, part.text, PAGE.left, y, 10, PAGE.width);
    y += Math.max(20, doc.heightOfString(part.text, { width: PAGE.width }));
    value = part.rest;
    if (value) {
      doc.addPage();
      y = PAGE.top;
    }
  }
  return y;
}

export function drawBankFooter(
  doc: PDFKit.PDFDocument,
  y: number,
  note?: string,
) {
  doc.font("Helvetica").fontSize(8);
  const footerHeight = (note ? 13.2 : 0) + 8 + 28 + doc.currentLineHeight(true);
  if (y + footerHeight > doc.page.height - PAGE.left) {
    doc.addPage();
    y = note ? 711.7 : 725;
  }
  if (note) {
    text(doc, note, PAGE.left, y, 8);
    y += 13.2;
  }
  doc
    .strokeColor("#969696")
    .moveTo(PAGE.left, y)
    .lineTo(PAGE.right, y)
    .stroke();
  y += 8;
  text(doc, "Bankverbindung:", PAGE.left, y, 8);
  [
    "Alexander Berent, Stadtsparkasse München",
    "IBAN: DE41 7015 0000 1005 7863 20",
    "BIC: SSKMDEMMXXX",
  ].forEach((line, index) => drawRight(doc, [line], y + index * 14, 8));
}

export function drawRight(
  doc: PDFKit.PDFDocument,
  lines: string[],
  y: number,
  size: number,
) {
  lines.forEach((line, index) =>
    doc
      .font("Helvetica")
      .fontSize(size)
      .fillColor("#3c3c3c")
      .text(line, 0, y + index * (size + 4), {
        width: PAGE.right,
        align: "right",
      }),
  );
  doc.fillColor("black");
}

/** Keep totals together, retaining the reference position only on the first page. */
export function drawTotals(
  doc: PDFKit.PDFDocument,
  lines: string[],
  y: number,
  height = 55,
  firstPageMinimum = 462.7,
): number {
  y = accountingSpace(
    doc,
    Math.max(y, pageNumbers.get(doc) === 1 ? firstPageMinimum : PAGE.top),
    height,
  );
  drawRight(doc, lines, y, 10);
  return y + height;
}

function accountingSpace(
  doc: PDFKit.PDFDocument,
  y: number,
  height: number,
): number {
  if (y + height <= PAGE.bottom) return y;
  doc.addPage();
  return PAGE.top;
}

/** Measure with PDFKit's own wrapping, splitting even unbroken words without dropping text. */
function fitText(
  doc: PDFKit.PDFDocument,
  value: string,
  width: number,
  height: number,
): { text: string; rest: string } {
  if (!value || doc.heightOfString(value, { width }) <= height + 0.001)
    return { text: value, rest: "" };
  const characters = Array.from(value);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (
      doc.heightOfString(characters.slice(0, middle).join(""), { width }) <=
      height + 0.001
    )
      low = middle;
    else high = middle - 1;
  }
  if (!low)
    throw new Error("Accounting PDF text cannot fit a line on the page");
  let prefix = characters.slice(0, low).join("");
  const boundary = prefix.search(/\s+\S*$/u);
  if (boundary > prefix.length / 2) prefix = prefix.slice(0, boundary + 1);
  return { text: prefix, rest: value.slice(prefix.length) };
}

export function parseEntries(value: unknown): InvoiceEntry[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is InvoiceEntry =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as Record<string, unknown>).description === "string" &&
          typeof (entry as Record<string, unknown>).quantity === "number" &&
          typeof (entry as Record<string, unknown>).unitPrice === "number",
      )
    : [];
}

/** Customer part of accounting file names: company or name without salutation, filesystem-safe. */
export function filenameName(
  company: string,
  customerName: string,
  fallback: string,
): string {
  return (
    (company || customerName)
      .replace(/[^\p{L}\p{N} ._-]/gu, "")
      .replace(/^(Herr|Frau)\s+/u, "")
      .trim() || fallback
  );
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
}
export function euro(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("de-DE").format(value);
}
function text(
  doc: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  size: number,
  width?: number,
) {
  doc
    .font("Helvetica")
    .fontSize(size)
    .fillColor("black")
    .text(value, x, y, width ? { width } : {});
}
