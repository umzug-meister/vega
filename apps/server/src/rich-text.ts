import sanitizeHtml from "sanitize-html";

// Keep this allowlist aligned with the Tiptap editor's supported formatting.
const ALLOWED_TAGS = [
  "a",
  "b",
  "br",
  "blockquote",
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

const ALLOWED_STYLES = {
  blockquote: {
    "margin-left": [/^\d{1,2}px$/],
    "padding-left": [/^\d{1,2}px$/],
    "border-left": [/^\d{1,2}px solid #[0-9a-f]{6}$/i],
  },
  span: {
    color: [/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i],
  },
};

const RGB_COLOR = /rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi;

function normalizeRgbColors(style: string): string {
  return style.replace(RGB_COLOR, (match, red, green, blue) => {
    const channels = [red, green, blue].map(Number);
    return channels.some((channel) => channel > 255)
      ? match
      : `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  });
}

/** Sanitize rich descriptions and email bodies to the same formatting subset. */
export function sanitizeRichTextHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href"],
      blockquote: ["style"],
      span: ["style"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedStyles: ALLOWED_STYLES,
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
