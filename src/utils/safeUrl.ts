/**
 * URL safety check for client-side sanitizers.
 *
 * Browsers strip tab/newline/CR characters anywhere inside a URL before
 * navigation, so "java\tscript:alert(1)" executes even though a naive
 * startsWith("javascript:") check passes. We remove every ASCII control
 * character first, then evaluate the scheme on the cleaned value.
 */
export function isSafeUrl(raw: unknown): boolean {
  const href = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "");
  if (!href) return false;
  const lowered = href.toLowerCase().trim();
  // Allow only http(s), protocol-relative and same-site relative URLs.
  if (lowered.startsWith("https:") || lowered.startsWith("http:")) return true;
  if (lowered.startsWith("//")) return true;
  if (lowered.startsWith("/")) return true;
  if (lowered.startsWith("#")) return true;
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lowered)) return true;
  return false;
}
