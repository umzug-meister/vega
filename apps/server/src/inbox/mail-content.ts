import { convert } from "html-to-text";
import sanitizeHtml from "sanitize-html";

export const MAIL_TEXT_MAX_CHARS = 100_000;

const HTML_MARKUP_PATTERN = /<(?:!doctype\s+html\b|html\b|head\b|body\b|table\b|div\b|p\b|br\b|ul\b|ol\b|blockquote\b)/iu;
const EMAIL_STYLE_RULES = {
  "background-color": [/^#[\da-f]{3,8}$/iu, /^(?:rgb|rgba)\([\d\s.,%]+\)$/iu, /^[a-z]{1,20}$/iu],
  color: [/^#[\da-f]{3,8}$/iu, /^(?:rgb|rgba)\([\d\s.,%]+\)$/iu, /^[a-z]{1,20}$/iu],
  "font-family": [/^[\w\s,"'-]{1,100}$/u],
  "font-size": [/^\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem|%)$/iu],
  "font-weight": [/^(?:normal|bold|[1-9]00)$/iu],
  "line-height": [/^\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?$/iu],
  "text-align": [/^(?:left|right|center|justify)$/iu],
  "text-decoration": [/^(?:none|underline|line-through)$/iu],
  "border-collapse": [/^(?:collapse|separate)$/iu],
  width: [/^\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?$/iu],
  "max-width": [/^\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?$/iu],
  padding: [/^\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?$/iu],
  "padding-left": [/^\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?$/iu],
  "padding-right": [/^\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?$/iu],
  "padding-top": [/^\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?$/iu],
  "padding-bottom": [/^\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?$/iu],
  margin: [/^\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?$/iu],
  "margin-left": [/^\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?$/iu],
  "margin-right": [/^\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?$/iu],
  "margin-top": [/^\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?$/iu],
  "margin-bottom": [/^\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?$/iu],
};

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const PHONE_CANDIDATE = /(?<![\w.])(?:\+|00)?\(?\d[\d\s()/.-]{6,}\d(?![\w])/gu;
const DATE_LIKE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/u;

function htmlSource(text: string, html: string): string {
  const source = html.trim() || (HTML_MARKUP_PATTERN.test(text.slice(0, 2048)) ? text : "");
  return source.slice(0, MAIL_TEXT_MAX_CHARS);
}

/** Safe HTML for the inbox view; active content and remote images are excluded. */
export function mailHtml(text: string, html: string): string {
  const source = htmlSource(text, html);
  if (!source) return "";
  return sanitizeHtml(source, {
    allowedTags: [
      "a", "b", "blockquote", "br", "caption", "center", "code", "div", "em",
      "font", "h1", "h2", "h3", "h4", "hr", "i", "li", "ol", "p", "pre",
      "s", "small", "span", "strike", "strong", "sub", "sup", "table", "tbody",
      "td", "tfoot", "th", "thead", "tr", "u", "ul",
    ],
    allowedAttributes: {
      "*": ["style"],
      a: ["href", "title", "target", "rel"],
      table: ["align", "width", "border", "cellpadding", "cellspacing", "role"],
      td: ["align", "valign", "width", "height", "colspan", "rowspan", "bgcolor"],
      th: ["align", "valign", "width", "height", "colspan", "rowspan", "bgcolor"],
      tr: ["align", "valign"],
      div: ["align"],
      p: ["align"],
    },
    allowedStyles: { "*": EMAIL_STYLE_RULES },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
      }),
    },
  });
}

/** Plain text of a mail; HTML-only and HTML-in-text messages are converted. */
export function mailPlainText(text: string, html: string): string {
  const plainText = text.trim();
  const source = plainText && !HTML_MARKUP_PATTERN.test(plainText.slice(0, 2048))
    ? plainText
    : convert(htmlSource(text, html), {
        wordwrap: false,
        selectors: [
          { selector: "a", options: { ignoreHref: true } },
          { selector: "img", format: "skip" },
        ],
      });
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
