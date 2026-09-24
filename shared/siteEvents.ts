/**
 * Administrator-managed events.
 *
 * Events used to be a constant compiled into the bundle, so creating or editing
 * one required a deployment. They are database rows now; this module is the
 * contract shared by the admin panel, the public event page and the API, and it
 * owns every validation rule so the client and the server cannot disagree about
 * what a valid event is.
 */

export type SiteEventKind = "views_leaderboard" | "announcement";
export type SiteEventStatus = "draft" | "published" | "archived";
export type SiteEventPhase = "upcoming" | "active" | "completed";
export type SiteEventBannerTheme = "violet" | "emerald" | "amber" | "rose" | "sky" | "slate";

export const SITE_EVENT_KINDS: readonly SiteEventKind[] = ["views_leaderboard", "announcement"] as const;
export const SITE_EVENT_STATUSES: readonly SiteEventStatus[] = ["draft", "published", "archived"] as const;
export const SITE_EVENT_BANNER_THEMES: readonly SiteEventBannerTheme[] = [
  "violet", "emerald", "amber", "rose", "sky", "slate",
] as const;

export const SITE_EVENT_LIMITS = {
  slug: 60,
  title: 140,
  description: 600,
  dateLabel: 80,
  timezoneLabel: 40,
  bannerAlt: 200,
  bannerHeadline: 120,
  bannerSubheadline: 200,
  bannerCtaLabel: 40,
  excludedAuthors: 100,
} as const;

export interface SiteEventBanner {
  imageUrl: string;
  alt: string;
  headline: string;
  subheadline: string;
  ctaLabel: string;
  ctaHref: string;
  theme: SiteEventBannerTheme;
}

export interface SiteEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: SiteEventKind;
  status: SiteEventStatus;
  startsAt: string;
  endsAt: string;
  dateLabel: string;
  timezoneLabel: string;
  banner: SiteEventBanner;
  isFeatured: boolean;
  excludedAuthorNames: string[];
  phase: SiteEventPhase;
  /** Rankings are hidden before the event opens. */
  leaderboardEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SiteEventInput {
  slug?: string;
  title?: string;
  description?: string;
  kind?: string;
  status?: string;
  startsAt?: string;
  endsAt?: string;
  dateLabel?: string;
  timezoneLabel?: string;
  banner?: Partial<SiteEventBanner>;
  isFeatured?: boolean;
  excludedAuthorNames?: unknown;
}

export const DEFAULT_SITE_EVENT_BANNER: SiteEventBanner = {
  imageUrl: "",
  alt: "",
  headline: "",
  subheadline: "",
  ctaLabel: "",
  ctaHref: "",
  theme: "violet",
};

function trimTo(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalizeSiteEventKind(value: unknown): SiteEventKind {
  const requested = String(value || "").trim().toLowerCase();
  return (SITE_EVENT_KINDS as readonly string[]).includes(requested)
    ? (requested as SiteEventKind)
    : "views_leaderboard";
}

export function normalizeSiteEventStatus(value: unknown): SiteEventStatus {
  const requested = String(value || "").trim().toLowerCase();
  return (SITE_EVENT_STATUSES as readonly string[]).includes(requested)
    ? (requested as SiteEventStatus)
    : "draft";
}

export function normalizeSiteEventBannerTheme(value: unknown): SiteEventBannerTheme {
  const requested = String(value || "").trim().toLowerCase();
  return (SITE_EVENT_BANNER_THEMES as readonly string[]).includes(requested)
    ? (requested as SiteEventBannerTheme)
    : "violet";
}

/**
 * URL segment for an event.
 *
 * Kept to lowercase ASCII with single hyphens so the slug is safe in a path, a
 * notification link and a cache key alike. Persian titles therefore need an
 * explicit slug rather than a transliteration guess.
 */
export function normalizeSiteEventSlug(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SITE_EVENT_LIMITS.slug);
}

/**
 * Banner and CTA links must be same-origin paths or HTTPS URLs.
 *
 * A `javascript:` href in an owner-editable banner would be a stored XSS on the
 * home page, and a plain-http image would break the padlock for every visitor.
 */
export function isSafeSiteEventUrl(value: unknown, options: { allowEmpty?: boolean } = {}): boolean {
  const raw = String(value ?? "").trim();
  if (!raw) return options.allowEmpty !== false;
  if (raw.startsWith("/")) return !raw.startsWith("//");
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeExcludedAuthorNames(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[,،\n]/);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of list) {
    const name = String(item ?? "").trim().slice(0, 60);
    if (!name) continue;
    const key = name.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= SITE_EVENT_LIMITS.excludedAuthors) break;
  }
  return names;
}

/** Author-name comparison key, matching the SQL normalisation exactly. */
export function normalizeEventAuthorName(value: unknown): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function getSiteEventPhase(
  event: { startsAt: string; endsAt: string },
  now: Date | string | number = Date.now(),
): SiteEventPhase {
  const timestamp = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const startsAt = Date.parse(event.startsAt);
  const endsAt = Date.parse(event.endsAt);
  if (!Number.isFinite(timestamp) || !Number.isFinite(startsAt)) return "upcoming";
  if (timestamp < startsAt) return "upcoming";
  if (Number.isFinite(endsAt) && timestamp >= endsAt) return "completed";
  return "active";
}

export interface SiteEventValidationError {
  field: string;
  message: string;
}

/**
 * Validate and normalise an event submitted by an owner.
 *
 * Returns either the clean event or the first field that is wrong, so the admin
 * form can point at it. Both the API and the form call this, which is what keeps
 * the two from disagreeing.
 */
export function validateSiteEventInput(
  input: SiteEventInput,
  options: { existingId?: string } = {},
): { event: Omit<SiteEvent, "phase" | "leaderboardEnabled" | "createdAt" | "updatedAt">; error: null }
  | { event: null; error: SiteEventValidationError } {
  const title = trimTo(input.title, SITE_EVENT_LIMITS.title);
  if (!title) {
    return { event: null, error: { field: "title", message: "عنوان رویداد الزامی است." } };
  }

  const slug = normalizeSiteEventSlug(input.slug || title);
  if (!slug) {
    return {
      event: null,
      error: { field: "slug", message: "نشانی رویداد باید شامل حروف یا ارقام لاتین باشد (مثلاً: winter-2026)." },
    };
  }

  const startsAtRaw = String(input.startsAt || "").trim();
  const endsAtRaw = String(input.endsAt || "").trim();
  const startsAt = Date.parse(startsAtRaw);
  const endsAt = Date.parse(endsAtRaw);
  if (!Number.isFinite(startsAt)) {
    return { event: null, error: { field: "startsAt", message: "تاریخ آغاز رویداد معتبر نیست." } };
  }
  if (!Number.isFinite(endsAt)) {
    return { event: null, error: { field: "endsAt", message: "تاریخ پایان رویداد معتبر نیست." } };
  }
  if (endsAt <= startsAt) {
    return { event: null, error: { field: "endsAt", message: "پایان رویداد باید پس از آغاز آن باشد." } };
  }

  const bannerInput = input.banner || {};
  if (!isSafeSiteEventUrl(bannerInput.imageUrl)) {
    return {
      event: null,
      error: { field: "banner.imageUrl", message: "تصویر بنر باید فایلی بارگذاری‌شده در رپتوک یا نشانی HTTPS باشد." },
    };
  }
  if (!isSafeSiteEventUrl(bannerInput.ctaHref)) {
    return {
      event: null,
      error: { field: "banner.ctaHref", message: "پیوند دکمهٔ بنر باید مسیری در رپتوک یا نشانی HTTPS باشد." },
    };
  }

  return {
    event: {
      id: options.existingId || slug,
      slug,
      title,
      description: trimTo(input.description, SITE_EVENT_LIMITS.description),
      kind: normalizeSiteEventKind(input.kind),
      status: normalizeSiteEventStatus(input.status),
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      dateLabel: trimTo(input.dateLabel, SITE_EVENT_LIMITS.dateLabel),
      timezoneLabel: trimTo(input.timezoneLabel, SITE_EVENT_LIMITS.timezoneLabel) || "UTC",
      banner: {
        imageUrl: String(bannerInput.imageUrl ?? "").trim(),
        alt: trimTo(bannerInput.alt, SITE_EVENT_LIMITS.bannerAlt),
        headline: trimTo(bannerInput.headline, SITE_EVENT_LIMITS.bannerHeadline),
        subheadline: trimTo(bannerInput.subheadline, SITE_EVENT_LIMITS.bannerSubheadline),
        ctaLabel: trimTo(bannerInput.ctaLabel, SITE_EVENT_LIMITS.bannerCtaLabel),
        ctaHref: String(bannerInput.ctaHref ?? "").trim(),
        theme: normalizeSiteEventBannerTheme(bannerInput.theme),
      },
      isFeatured: input.isFeatured === true,
      excludedAuthorNames: normalizeExcludedAuthorNames(input.excludedAuthorNames),
    },
    error: null,
  };
}

/** Should this event be visible to a reader right now? */
export function isSiteEventPublic(event: { status: SiteEventStatus; phase?: SiteEventPhase }): boolean {
  return event.status === "published";
}
