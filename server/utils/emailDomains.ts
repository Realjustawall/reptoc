import { isDisposableEmail } from "@visulima/disposable-email-domains";
import {
  domainMatchesSet,
  emailDomain,
  isCommonDisposableEmail,
} from "../../shared/emailValidation";

function configuredDomains(value: string | undefined): Set<string> {
  return new Set(
    String(value || "")
      .split(",")
      .map((domain) => domain.trim().toLowerCase().replace(/^@/, "").replace(/\.+$/, ""))
      .filter(Boolean),
  );
}

const additionalDisposableDomains = configuredDomains(process.env.DISPOSABLE_EMAIL_DOMAINS);
const allowedDomains = configuredDomains(process.env.DISPOSABLE_EMAIL_ALLOW_DOMAINS);

/** Authoritative registration check. Exact domains and their subdomains match. */
export function isDisposableRegistrationEmail(value: unknown): boolean {
  const email = String(value || "").trim().toLowerCase();
  const domain = emailDomain(email);
  if (!domain) return false;
  if (domainMatchesSet(domain, allowedDomains)) return false;
  if (isCommonDisposableEmail(email)) return true;

  try {
    return isDisposableEmail(email, { customDomains: additionalDisposableDomains });
  } catch (error) {
    console.error("[auth:register] Disposable email dataset could not be read", {
      error: error instanceof Error ? error.message : String(error),
    });
    return domainMatchesSet(domain, additionalDisposableDomains);
  }
}
