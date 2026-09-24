import sanitizeHtml from "sanitize-html";
import { normalizeStoredImageReference } from "./images";

const HTML_TEXT_ENTITIES: Record<string, string> = {
  amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"'
};

function decodeHtmlTextEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== "#") return HTML_TEXT_ENTITIES[code.toLowerCase()] ?? entity;
    const numeric = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 0x10ffff) return entity;
    try { return String.fromCodePoint(numeric); } catch { return entity; }
  });
}

export function sanitizeStoryHtml(value: unknown): string {
  return sanitizeHtml(String(value || ""), {
    allowedTags: ["p", "br", "strong", "em", "u", "s", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "hr", "span", "a", "img"],
    allowedAttributes: {
      hr: ["data-page-break", "class"],
      span: ["class"],
      a: ["href", "target", "rel"],
      // `data-width` / `data-align` / `data-float` carry the illustration layout
      // chosen in the writing workspace. They are inert data attributes (never
      // styles), so they are safe to persist and are what the reader renders
      // from.
      img: ["src", "alt", "title", "width", "height", "loading", "data-width", "data-align", "data-float"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (_tagName, attributes) => {
        const href = String(attributes.href || "").trim();
        const safe = /^(?:https:\/\/|mailto:|\/)/i.test(href);
        return safe
          ? { tagName: "a", attribs: { href, target: "_blank", rel: "noopener noreferrer" } }
          : { tagName: "span", attribs: {} };
      },
      img: (_tagName, attributes) => {
        try {
          const src = normalizeStoredImageReference(attributes.src, { allowEmpty: false });
          const width = ["small", "medium", "full"].includes(String(attributes["data-width"]))
            ? String(attributes["data-width"])
            : "full";
          const align = ["start", "center", "end"].includes(String(attributes["data-align"]))
            ? String(attributes["data-align"])
            : "center";
          // Text wrapping around the illustration; "none" keeps it on its own line.
          const float = ["start", "end"].includes(String(attributes["data-float"]))
            ? String(attributes["data-float"])
            : "none";
          return {
            tagName: "img",
            attribs: {
              src,
              alt: sanitizePlainText(attributes.alt || "Chapter illustration", 200),
              loading: "lazy",
              "data-width": width,
              "data-align": align,
              "data-float": float,
              ...(attributes.width && /^\d{1,4}$/.test(attributes.width) ? { width: attributes.width } : {}),
              ...(attributes.height && /^\d{1,4}$/.test(attributes.height) ? { height: attributes.height } : {}),
            },
          };
        } catch {
          return { tagName: "span", text: "[Image unavailable]" };
        }
      },
    },
    disallowedTagsMode: "discard"
  }).slice(0, 500000);
}

export function sanitizePlainText(value: unknown, max = 5000): string {
  const sanitized = sanitizeHtml(String(value || ""), { allowedTags: [], allowedAttributes: {} });
  return decodeHtmlTextEntities(sanitized).slice(0, max);
}

export function countWordsFromHtml(value: unknown): number {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}
