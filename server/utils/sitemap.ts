export function escapeXml(value: unknown): string {
  return String(value ?? "").replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  }[character] || character));
}

function safeLastModified(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

/**
 * Prefer the explicitly configured public origin over proxy request headers.
 * Public sitemap locations must use HTTPS; loopback HTTP remains available for
 * local smoke tests.
 */
export function canonicalSitemapOrigin(configuredOrigin: unknown, fallbackOrigin: unknown): string {
  const raw = String(configuredOrigin || fallbackOrigin || "").trim();
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Sitemap origin must use HTTP or HTTPS.");
  }
  if (!isLoopbackHostname(url.hostname)) url.protocol = "https:";
  return url.origin;
}

function canonicalSitemapPath(pathname: unknown): string {
  const withoutQueryOrFragment = String(pathname || "/").split(/[?#]/, 1)[0] || "/";
  const withLeadingSlash = withoutQueryOrFragment.startsWith("/")
    ? withoutQueryOrFragment
    : `/${withoutQueryOrFragment}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

export function sitemapUrl(
  origin: string,
  pathname: string,
  options: { lastmod?: unknown; changefreq?: string; priority?: number } = {},
): string {
  const canonicalOrigin = canonicalSitemapOrigin(origin, origin);
  const location = new URL(canonicalSitemapPath(pathname), `${canonicalOrigin}/`).href;
  const lastmodValue = safeLastModified(options.lastmod);
  const lastmod = lastmodValue ? `<lastmod>${escapeXml(lastmodValue)}</lastmod>` : "";
  const changefreq = options.changefreq ? `<changefreq>${escapeXml(options.changefreq)}</changefreq>` : "";
  const priority = options.priority !== undefined ? `<priority>${options.priority.toFixed(1)}</priority>` : "";
  return `<url><loc>${escapeXml(location)}</loc>${lastmod}${changefreq}${priority}</url>`;
}

export function buildSitemapDocument(urls: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
}
