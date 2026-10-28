import sanitizeHtml from "sanitize-html";
import { convert } from "html-to-text";

/**
 * The established Umzug Ruck Zuck mail frame.  Keep this server-side: callers
 * only provide the editable inner body, never a complete document.
 */
const EMAIL_LAYOUT = `<!doctype html>
<html lang="de-DE"><head><meta charset="UTF-8" /><meta name="x-apple-disable-message-reformatting" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Umzug Ruck Zuck</title><style>
body { margin: 0; padding: 0; font-family: Arial, sans-serif; color: #333333; font-size: 1rem; }
p { margin-block-start: 0.6rem; margin-block-end: 0.6rem; } table { width: 100%; } td { padding: 0.2rem; border: 0; } table tr:last-child { border-top: 1px solid #333; }
.image-container { text-align: center; padding: 10px; } .image { max-width: 100%; height: auto; } .container { max-width: 700px; margin: 0 auto; background: #ececed3b; } .content, .footer { padding: 0.8rem; }
.footer { color: #a8a8a8; background-color: #363636; font-size: 0.8rem; } .footer a { color: #a8a8a8; } .footer a:hover { color: #ffffff; } .rating { color: #ea5b27; } .centered { text-align: center; }
.ql-align-right { text-align: right; } .ql-align-center { text-align: center; }
</style></head><body><div class="container"><div class="image-container"><img class="image" style="width: 360px" alt="Umzug Ruck Zuck" src="https://umzugruckzuck24.de/wp-content/uploads/2026/06/Logo-147.svg" /></div><div class="content">{{content}}<br /><p>Freundliche Grüße, <br />{{signature}}Ihr Umzug Ruck Zuck Team.</p></div><div class="footer"><p class="centered">Mobil: 0176 101 719 90</p><p class="centered">Telefon: 089 306 429 72</p><p class="centered"><a href="https://umzugruckzuck24.de">umzugruckzuck24.de</a></p><p class="centered">© Umzug Ruck Zuck. Alle Rechte vorbehalten.</p></div></div></body></html>`;

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ]!,
  );
}

/** `signatureName` is the sending staff member's name shown above the team greeting. */
export function renderEmailLayout(
  contentHtml: string,
  signatureName?: string | null,
  signatureColor: "#000000" | "#28527A" | "#CB722F" = "#000000",
): string {
  const name = signatureName?.trim();
  const signature = `<span style="color:${signatureColor}">Freundliche Grüße, <br />${name ? `${escapeHtml(name)}<br />` : ""}Ihr Umzug Ruck Zuck Team.</span>`;
  // Function replacers: `$` sequences in user content must not be interpreted as patterns.
  return EMAIL_LAYOUT.replace(
    "Freundliche Grüße, <br />{{signature}}Ihr Umzug Ruck Zuck Team.",
    () => signature,
  ).replace("{{content}}", () => sanitizeEmailHtml(contentHtml));
}

/**
 * Text comes from a rich-text editor, not from a trusted template file. Keep a
 * deliberately small formatting subset and reject executable/event attributes
 * and non-web links before it reaches an HTML email.
 *
 * Implemented with the maintained sanitize-html parser: disallowed elements
 * (including script/style/iframe/object/embed/form/input), comments, event
 * handler/style attributes, and non-http(s)/mailto links are removed. Entity
 * handling stays inside the library so sequential manual decoding cannot
 * double-unescape attacker input.
 */
// colgroup/col/th and colspan/rowspan are emitted by the admin rich-text table extension.
const EMAIL_ALLOWED_TAGS = [
  "a",
  "b",
  "br",
  "col",
  "colgroup",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "i",
  "li",
  "ol",
  "p",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
];

/**
 * The editor's text-color tool emits `<span style="color: rgb(r, g, b)">`
 * because Tiptap serializes through the DOM, which normalizes hex colors to
 * `rgb()`. Convert those three plain channels to hex before filtering so email
 * clients get the compact form and only `color` survives.
 */
const RGB_COLOR = /rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi;

function normalizeRgbColors(style: string): string {
  return style.replace(RGB_COLOR, (match, red, green, blue) => {
    const channels = [red, green, blue].map(Number);
    return channels.some((channel) => channel > 255)
      ? match
      : `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  });
}

const EMAIL_ALLOWED_STYLES = {
  span: {
    color: [/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i],
  },
};

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: EMAIL_ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href"],
      span: ["style"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedStyles: EMAIL_ALLOWED_STYLES,
    transformTags: {
      span: (tagName, attribs) =>
        typeof attribs.style === "string"
          ? {
              tagName,
              attribs: { ...attribs, style: normalizeRgbColors(attribs.style) },
            }
          : { tagName, attribs },
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
  });
}

export function htmlToPlainText(html: string): string {
  // Parser-based conversion: script/style content and comments are dropped,
  // entities are decoded once for text (not HTML) output.
  const text = convert(html, {
    wordwrap: false,
    // `mailto:` links would repeat the address as `[address?subject=...]`. The
    // label already is the address, so plain-text readers see it only once.
    selectors: [
      {
        selector: 'a[href^="mailto:"]',
        format: "inline",
        options: { ignoreHref: true },
      },
    ],
  });
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function passwordResetEmail(url: string): {
  subject: string;
  contentHtml: string;
  text: string;
} {
  const safeUrl = escapeHtml(url);
  return {
    subject: "Passwort zurücksetzen",
    text: `Sie haben angefordert, Ihr Passwort zurückzusetzen.\n\nPasswort zurücksetzen: ${url}\n\nFalls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.`,
    contentHtml: `<p>Sie haben angefordert, Ihr Passwort zurückzusetzen.</p><p><a href="${safeUrl}">Passwort zurücksetzen</a></p><p>Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.</p>`,
  };
}

export const emailDefaults = {
  /**
   * Company notification for a new public inquiry. The Hostinger send API has
   * no Reply-To field, so the customer's address is exposed as a ready-made
   * `mailto:` link instead of a mail header.
   */
  inquiryNotification(
    customerName: string,
    orderNumber: number,
    customerEmail?: string | null,
  ) {
    const email = customerEmail?.trim();
    const replyLink = email
      ? `<p>Antworten an den Kunden: <a href="${escapeHtml(
          `mailto:${email}?subject=${encodeURIComponent(`Ihre Umzugsanfrage ${orderNumber}`)}`,
        )}">${escapeHtml(email)}</a></p>`
      : "";
    return {
      subject: `Neue Umzugsanfrage ${orderNumber}`,
      contentHtml: `<p>Eine neue Umzugsanfrage von ${escapeHtml(customerName)} wurde gespeichert.</p><p>Auftragsnummer: ${orderNumber}. Bitte prüfen Sie die vollständigen Angaben in der Vega-Admin-Oberfläche.</p>${replyLink}`,
    };
  },
  inquiryReceived(customerName: string, orderNumber: number) {
    return {
      subject: `Wir haben Ihre Umzugsanfrage ${orderNumber} erhalten`,
      contentHtml: `<p>Guten Tag ${escapeHtml(customerName)},</p><p>vielen Dank für Ihre Anfrage. Wir haben diese erhalten und melden uns schnellstmöglich bei Ihnen.</p>`,
    };
  },
};
