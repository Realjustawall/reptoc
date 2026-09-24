/**
 * ✅ FIX B-7: Expanded blacklist with Persian/Arabic terms.
 *
 * Previously, only 4 English tokens were checked. This missed common
 * non-English slurs and category names. The list is still conservative —
 * it only filters explicit sexual-orientation categories from public
 * taxonomies, not legitimate literary themes.
 */

function taxonomyText(value: any): string {
  if (value && typeof value === "object") {
    return [value.id, value.label, value.name, value.title]
      .map((item) => String(item || ""))
      .join(" ");
  }
  return String(value || "");
}

export function normalizeTaxonomyKey(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ✅ FIX B-7: Comprehensive blacklist including Persian/Arabic terms.
 * Also matches on the raw text (not just the normalized version) so
 * that non-ASCII tokens are caught.
 */
export function isBannedTaxonomyValue(value: unknown): boolean {
  const text = taxonomyText(value);
  if (!text.trim()) return false;

  const normalized = normalizeTaxonomyKey(text);
  const tokens = normalized.split(" ");

  // English tokens
  const bannedEnglish = ["gay", "lesbian", "sexual", "queer", "homo", "fag", "dyke", "tranny", "lgbtq", "lgbt"];
  if (tokens.some((token) => bannedEnglish.includes(token) || token.startsWith("lgbtq"))) {
    return true;
  }

  // Persian/Arabic tokens — check against raw text since normalize strips them.
  const bannedPersian = [
    "همجنسگرا", "همجنس‌گرا", "همجنسگرایی", "لزبین", "گی", "کوئیر",
    "همجنسباز", "همجنس‌باز", "همجنس", "جنسگرایی", "ترنس",
    // Arabic variants
    "مثلي", "مثليه", "سحاق", "لواط"
  ];
  const lowerText = text.toLowerCase();
  for (const term of bannedPersian) {
    if (lowerText.includes(term)) return true;
  }

  return false;
}

export function sanitizeTaxonomyList<T>(items: T[]): T[] {
  return (Array.isArray(items) ? items : []).filter((item) => !isBannedTaxonomyValue(item));
}

const POWER_BREAK_TOKEN_EN = "power break";
const POWER_BREAK_TOKEN_FA = "شکست قدرت";
const POWER_BREAK_LABEL_EN = "Power Break";
const POWER_BREAK_LABEL_FA = "شکست قدرت";

function containsPersianText(value: string): boolean {
  return /[\u0600-\u06FF]/.test(value);
}

export function sanitizeSystemSettingsTaxonomy(settings: any) {
  const cloned = { ...(settings || {}) };
  for (const key of ["genres", "mainCategories", "subCategories", "forumCategories", "leaderboardTags"]) {
    if (Array.isArray(cloned[key])) cloned[key] = sanitizeTaxonomyList(cloned[key]);
  }
  if (Array.isArray(cloned.mainCategories)) {
    const items = cloned.mainCategories.map((item: any) => taxonomyText(item));
    const hasEnglishToken = items.some((item: string) => normalizeTaxonomyKey(item) === POWER_BREAK_TOKEN_EN);
    const hasPersianToken = items.some((item: string) => item.includes(POWER_BREAK_TOKEN_FA));
    if (!hasEnglishToken && !hasPersianToken) {
      const isPersianList = items.some((item: string) => containsPersianText(item));
      cloned.mainCategories = [...cloned.mainCategories, isPersianList ? POWER_BREAK_LABEL_FA : POWER_BREAK_LABEL_EN];
    }
  }
  if (Array.isArray(cloned.contentWarnings)) {
    cloned.contentWarnings = sanitizeTaxonomyList(cloned.contentWarnings);
  }
  return cloned;
}
