export const DISPOSABLE_EMAIL_ERROR = "Disposable or temporary email addresses are not allowed. Use a permanent email address you can verify.";

// This small shared fallback gives immediate browser feedback for common
// providers. The server also checks a much larger maintained domain dataset.
const COMMON_DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com",
  "discard.email",
  "emailfake.com",
  "emailondeck.com",
  "fakeinbox.com",
  "generator.email",
  "getnada.com",
  "grr.la",
  "guerrillamail.com",
  "guerrillamailblock.com",
  "mail.tm",
  "maildrop.cc",
  "mailinator.com",
  "mintemail.com",
  "moakt.com",
  "mytemp.email",
  "sharklasers.com",
  "temp-mail.io",
  "temp-mail.org",
  "tempail.com",
  "tempmail.com",
  "throwaway.com",
  "throwawaymail.com",
  "trashmail.com",
  "yopmail.com",
  "yopmail.fr",
]);

export function emailDomain(value: unknown): string | null {
  const email = String(value || "").trim().toLowerCase();
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator === email.length - 1) return null;
  const domain = email.slice(separator + 1).replace(/\.+$/, "");
  return domain && !domain.includes("@") ? domain : null;
}

export function domainMatchesSet(domain: string, domains: ReadonlySet<string>): boolean {
  const labels = domain.toLowerCase().split(".");
  for (let index = 0; index < labels.length - 1; index += 1) {
    if (domains.has(labels.slice(index).join("."))) return true;
  }
  return false;
}

export function isCommonDisposableEmail(value: unknown): boolean {
  const domain = emailDomain(value);
  return !!domain && domainMatchesSet(domain, COMMON_DISPOSABLE_EMAIL_DOMAINS);
}
