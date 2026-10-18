import { addInvoiceAmounts, type CreateOrderInput } from "@vega/domain";
import { escapeHtml } from "./email-template.js";

/**
 * Editable drafts for staff-sent mails, ported from the legacy um-admin
 * templates. Only tags the admin rich-text editor keeps (p, h2, h3, strong,
 * ul/li, br, table) are used so the draft survives editing unchanged. The
 * closing greeting and footer are added by renderEmailLayout, never here.
 */
export interface EmailDraftContent {
  subject: string;
  contentHtml: string;
}

export interface OfferOption {
  orderNumber: number;
  data: CreateOrderInput;
}

type Customer = Pick<
  CreateOrderInput["customer"],
  "salutation" | "firstName" | "lastName" | "company"
>;

const euro = (value: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    value,
  );
const amount = (value: number) => new Intl.NumberFormat("de-DE").format(value);

export function salutationLine(customer: Customer | undefined): string {
  const firstName = customer?.firstName?.trim() ?? "";
  const lastName = customer?.lastName?.trim() ?? "";
  if (!lastName && !firstName) return "Sehr geehrte Damen und Herren,";
  if (customer?.salutation === "Frau" && lastName)
    return `Sehr geehrte Frau ${lastName},`;
  if (customer?.salutation === "Herr" && lastName)
    return `Sehr geehrter Herr ${lastName},`;
  return `Hallo ${[firstName, lastName].filter(Boolean).join(" ")},`;
}

function printableDate(isoDate: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

export function offerValidUntil(now: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(now.getTime() + 24 * 60 * 60 * 1000));
}

function appointment(data: CreateOrderInput): string {
  const parts = [
    /^\d{4}-\d{2}-\d{2}$/u.test(data.movingDate)
      ? `am ${printableDate(data.movingDate)}`
      : "",
    data.movingTime ? `ab ${data.movingTime}` : "",
  ].filter(Boolean);
  return parts.length
    ? `${parts.join(" ")}, Alternativen nach Absprache`
    : "zu einem Termin nach Absprache";
}

function hasAssembly(data: CreateOrderInput): boolean {
  const details = data.details;
  return Boolean(
    data.from.demontage ||
    data.to.montage ||
    (details?.showSecondaryFrom && details.secondaryFrom?.demontage) ||
    (details?.showSecondaryTo && details.secondaryTo?.montage),
  );
}

function optionHtml({ data }: OfferOption): string {
  const basis = data.details?.basis;
  const blocks: string[] = [];
  if (basis && (basis.workers > 0 || basis.trucks > 0)) {
    const crew = [
      basis.workers > 0 ? `${basis.workers} Mann` : "",
      basis.trucks > 0 ? `mit ${basis.trucks} x LKW (à 3,5t / 20 m³)` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const lines = [`<strong>${escapeHtml(crew)}</strong>`];
    if (basis.hours > 0) {
      const route = [
        data.from.city ? `Start: ${data.from.city}` : "",
        data.to.city ? `Ende: ${data.to.city}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(
        escapeHtml(
          `Mindestabnahme ${amount(basis.hours)} Stunden${route ? ` (${route})` : ""}`,
        ),
      );
      if (basis.extraHourPrice > 0)
        lines.push(
          escapeHtml(`Jede weitere Stunde: ${euro(basis.extraHourPrice)}`),
        );
      if (basis.hours <= 4)
        lines.push(
          escapeHtml(`Maximale Abnahme: ${amount(basis.hours + 1)} Stunden`),
        );
    }
    blocks.push(`<h3>Personalkosten</h3><p>${lines.join("<br>")}</p>`);
  }
  const rows = (data.details?.conditions ?? []).map(
    (entry) =>
      `<tr><td><p>${escapeHtml(entry.description)}</p></td><td><p>${escapeHtml(euro(entry.amount))}</p></td></tr>`,
  );
  rows.push(
    `<tr><td><p><strong>Gesamtbetrag inkl. MwSt:</strong></p></td><td><p><strong>${escapeHtml(euro(addInvoiceAmounts((data.details?.conditions ?? []).map((entry) => entry.amount))))}</strong></p></td></tr>`,
  );
  blocks.push(
    `<h3>Positionen</h3><table><tbody>${rows.join("")}</tbody></table>`,
  );
  return blocks.join("");
}

/**
 * Single offer or the two-option offer (current order = 1. Option, partner =
 * 2. Option). `referenceNumber` is the family root for the pair.
 */
export function offerEmail(input: {
  option: OfferOption;
  secondOption?: OfferOption;
  referenceNumber: number;
  now: Date;
}): EmailDraftContent {
  const { option, secondOption, referenceNumber, now } = input;
  const data = option.data;
  const volume = data.details?.furniture.volume ?? 0;
  const assembly =
    hasAssembly(data) ||
    (secondOption ? hasAssembly(secondOption.data) : false);
  const included = [
    "Anfahrt / Lastfahrtkosten",
    ...(assembly ? ["Möbelabbau und Aufbau"] : []),
    "Bereitstellung eines Umzugswagens",
    "Versicherung: bis 2 Mio. Euro",
    "Be- und Entladen des LKWs",
    "Spanngurte, Dieselkosten sowie ausreichend Schutzdecken",
    "Ordentliche Rechnungsstellung",
  ];
  const html = [
    `<p>Bitte halten Sie bei Rückfragen folgende Nummer bereit: <strong>${referenceNumber}</strong></p>`,
    `<p>${escapeHtml(salutationLine(data.customer))}</p>`,
    `<p>vielen Dank für Ihre Anfrage. Gerne übernehmen wir Ihren Umzug <strong>${escapeHtml(appointment(data))}</strong><br/>und freuen uns, Ihnen folgende Positionen anbieten zu können.</p>`,
    volume > 0
      ? `<p><strong>Berechnetes Umzugsvolumen: ${escapeHtml(amount(volume))} m³</strong></p>`
      : "",
    `<p><strong>Unser Kostenvoranschlag ist bis zum ${offerValidUntil(now)} gültig.</strong> ${secondOption ? "Im Anhang finden Sie beide Aufträge." : "Im Anhang finden Sie den Auftrag."}</p>`,
    "<p><strong>Sollten Sie unser Angebot annehmen, bitten wir Sie um eine kurze Bestätigung per E-Mail.</strong> Das Unterschreiben des Auftrages ist hierfür nicht erforderlich.</p>",
    secondOption ? "<h2>1. Option</h2>" : "",
    optionHtml(option),
    secondOption ? `<h2>2. Option</h2>${optionHtml(secondOption)}` : "",
    "<h3>Alle unsere Kostenvoranschläge beinhalten</h3>",
    `<ul>${included.map((item) => `<li><p>${escapeHtml(item)}</p></li>`).join("")}</ul>`,
    "<p><strong>Wir bitten um Ihre Rückmeldung.</strong></p>",
  ].join("");
  return {
    subject: `📦 Umzugsangebot zu Ihrer Anfrage ${referenceNumber}`,
    contentHtml: html,
  };
}

export function declineEmail(
  orderNumber: number,
  customer: Customer,
): EmailDraftContent {
  return {
    subject: `Ihre Umzugsanfrage ${orderNumber}`,
    contentHtml: `<p>${escapeHtml(salutationLine(customer))}</p><p>wir bedauern sehr, Ihnen mitteilen zu müssen, dass wir derzeit leider keine Kapazitäten haben, um Ihren Umzug übernehmen zu können. Daher können wir Ihnen momentan kein Angebot unterbreiten. Wir wünschen Ihnen jedoch viel Erfolg bei der weiteren Suche nach einem passenden Umzugsunternehmen.</p>`,
  };
}

/** Blanco invoices have no order customer; fall back to the invoice name snapshot. */
export function invoiceEmail(
  invoiceNumber: string,
  customer: Customer | undefined,
  fallbackName: string,
): EmailDraftContent {
  const greeting = accountingGreeting(customer, fallbackName);
  return {
    subject: `Rechnung zu Ihrem Umzug ${invoiceNumber}`,
    contentHtml: `<p>${escapeHtml(greeting)}</p><p>herzlichen Dank, dass Sie sich für unsere Leistungen entschieden haben. Anbei finden Sie Ihre Rechnung im Anhang.<br>Bei Fragen stehen wir Ihnen jederzeit gerne zur Verfügung.</p>`,
  };
}

export function creditNoteEmail(
  creditNumber: string,
  invoiceNumber: string,
  customer: Customer | undefined,
  fallbackName: string,
): EmailDraftContent {
  return {
    subject: `Gutschrift ${creditNumber} zu Ihrer Rechnung ${invoiceNumber}`,
    contentHtml: `<p>${escapeHtml(accountingGreeting(customer, fallbackName))}</p><p>anbei erhalten Sie die Gutschrift ${escapeHtml(creditNumber)} zu Ihrer Rechnung ${escapeHtml(invoiceNumber)}.<br>Bei Fragen stehen wir Ihnen jederzeit gerne zur Verfügung.</p>`,
  };
}

export function reminderEmail(
  level: number,
  invoiceNumber: string,
  dueDate: string,
  greeting: string,
): EmailDraftContent {
  return {
    subject: `${level}. Mahnung zu Ihrer Rechnung ${invoiceNumber}`,
    contentHtml: `<p>${escapeHtml(greeting)}</p><p>anbei erhalten Sie die ${level}. Mahnung zu Ihrer Rechnung ${escapeHtml(invoiceNumber)}. Bitte begleichen Sie den offenen Betrag bis zum ${escapeHtml(dueDate)}.</p><p>Sofern Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.</p>`,
  };
}

function accountingGreeting(
  customer: Customer | undefined,
  fallbackName: string,
): string {
  return customer
    ? salutationLine(customer)
    : fallbackName.trim()
      ? `Hallo ${fallbackName.trim()},`
      : salutationLine(undefined);
}
