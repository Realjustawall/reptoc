function hostname(value: string): string {
  const first = String(value || "").split(",")[0]?.trim();
  if (!first) return "";
  try {
    return new URL(`http://${first}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Ad providers authorize an exact publisher hostname. In production, send the
 * public aliases to the configured canonical origin before they can execute an
 * advertisement with an unapproved referrer.
 */
export function canonicalWwwRedirect(
  configuredOrigin: string | undefined,
  requestHost: string | undefined,
  originalUrl: string,
  production: boolean,
): string | null {
  if (!production) return null;
  let canonical: URL;
  try {
    canonical = new URL(String(configuredOrigin || "").trim());
  } catch {
    return null;
  }
  const canonicalHostname = canonical.hostname.toLowerCase();
  const requestHostname = hostname(requestHost || "");
  const publicAliases = new Set([`www.${canonicalHostname}`, `demo.${canonicalHostname}`]);
  if (!canonicalHostname || !publicAliases.has(requestHostname)) return null;
  const path = originalUrl.startsWith("/") ? originalUrl : "/";
  return `${canonical.origin}${path}`;
}
