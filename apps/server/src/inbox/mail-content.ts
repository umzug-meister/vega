import { convert } from "html-to-text";

export const MAIL_TEXT_MAX_CHARS = 100_000;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const PHONE_CANDIDATE = /(?<![\w.])(?:\+|00)?\(?\d[\d\s()/.-]{6,}\d(?![\w])/gu;
const DATE_LIKE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/u;

/** Plain text of a mail; HTML-only mails are converted and HTML is never rendered. */
export function mailPlainText(text: string, html: string): string {
  const source =
    text.trim() ||
    (html.trim()
      ? convert(html, {
          wordwrap: false,
          selectors: [
            { selector: "a", options: { ignoreHref: true } },
            { selector: "img", format: "skip" },
          ],
        })
      : "");
  return source.replace(/\r\n?/gu, "\n").trim().slice(0, MAIL_TEXT_MAX_CHARS);
}

export interface RedactedText {
  text: string;
  phones: string[];
}

/**
 * Removes e-mail addresses and phone numbers before text leaves the server.
 * Phone numbers are returned so the draft can still be filled locally.
 */
export function redactContactData(input: string): RedactedText {
  const phones: string[] = [];
  const withoutEmails = input.replace(EMAIL_PATTERN, "[E-Mail entfernt]");
  const text = withoutEmails.replace(PHONE_CANDIDATE, (match) => {
    const trimmed = match.trim();
    const digits = trimmed.replace(/\D/gu, "");
    if (digits.length < 8 || digits.length > 15 || DATE_LIKE.test(trimmed))
      return match;
    phones.push(trimmed);
    return "[Telefon entfernt]";
  });
  return { text, phones };
}

export function splitSenderName(name: string): {
  firstName: string;
  lastName: string;
} {
  const cleaned = name
    .replace(/["<>]/gu, "")
    .replace(/\S+@\S+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return { firstName: "", lastName: "" };
  if (cleaned.includes(",")) {
    const [last = "", first = ""] = cleaned.split(",", 2);
    return {
      firstName: first.trim().slice(0, 100),
      lastName: last.trim().slice(0, 100),
    };
  }
  const parts = cleaned.split(" ");
  const lastName = parts.length > 1 ? (parts.pop() ?? "") : "";
  return {
    firstName: parts.join(" ").slice(0, 100),
    lastName: lastName.slice(0, 100),
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

/** Quotes the original message as escaped HTML blockquote for a reply. */
export function quoteForReply(options: {
  from: string;
  date: string;
  text: string;
}): string {
  const body = escapeHtml(options.text.slice(0, 20_000)).replace(
    /\n/gu,
    "<br>",
  );
  const header = escapeHtml(`Am ${options.date} schrieb ${options.from}:`);
  return `<p>${header}</p><blockquote>${body}</blockquote>`;
}
