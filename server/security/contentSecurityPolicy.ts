import crypto from "crypto";

/**
 * Content Security Policy for the application document.
 *
 * Advertising was removed platform-wide, so no third-party ad origin is
 * authorized any more and there is no `frame-src https:` escape hatch. The only
 * remaining external scripts are the measurement and support-chat loaders
 * referenced by the HTML shell.
 */
const APPLICATION_SCRIPT_ORIGINS: readonly string[] = Object.freeze([
  "https://static.cloudflareinsights.com",
  "https://www.googletagmanager.com",
  "https://goftino.com",
  "https://*.goftino.com",
]);

/** sha256 hash of an inline script, formatted for a CSP source list. */
export function quotedScriptHash(script: string): string {
  const digest = crypto.createHash("sha256").update(script, "utf8").digest("base64");
  return `'sha256-${digest}'`;
}

/**
 * Build the document policy.
 *
 * `inlineScriptHashes` carries the hashes of the inline scripts that actually
 * ship inside the served HTML. `server.ts` extracts them from the built shell at
 * boot, so editing `index.html` can never lock the page out of its own
 * bootstrap.
 */
export function buildApplicationContentSecurityPolicy(inlineScriptHashes: readonly string[] = []): string {
  const scriptSources = new Set<string>(["'self'", ...APPLICATION_SCRIPT_ORIGINS]);
  for (const hash of inlineScriptHashes) {
    if (hash.trim()) scriptSources.add(hash.trim());
  }
  const scriptSourceList = [...scriptSources].join(" ");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "font-src 'self' https: data: https://fonts.gstatic.com",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Author-supplied illustrations and manga pages may be hosted off-site.
    "img-src 'self' data: blob: https:",
    "object-src 'none'",
    `script-src ${scriptSourceList}`,
    `script-src-elem ${scriptSourceList}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://goftino.com https://*.goftino.com",
    "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://goftino.com https://*.goftino.com",
    "connect-src 'self' https: wss:",
    // Reading music and narration clips are served from this origin.
    "media-src 'self' data: blob: https://goftino.com https://*.goftino.com",
    // The support widget renders its conversation surface in an isolated
    // Goftino frame. Keep the allow-list limited to that provider.
    "frame-src 'self' https://goftino.com https://*.goftino.com",
    "upgrade-insecure-requests",
  ].join("; ");
}

export { APPLICATION_SCRIPT_ORIGINS };
