import { supabase } from "../postgres";
import { sanitizePlainText } from "./content";
import { sanitizeSystemSettingsTaxonomy, sanitizeTaxonomyList } from "./taxonomyFilters";
import { mergeContentWarningDefinitions, normalizeContentWarnings } from "../../shared/contentWarnings";

const DEFAULT_FORUM_CATEGORIES = ["همه انجمن‌ها", "اعلانات", "مهارت نویسندگی", "گفت‌وگو درباره کلیشه‌ها", "پیشنهاد رمان", "گفت‌وگوی عمومی"];
const PERSIAN_DEFAULT_FORUM_CATEGORIES = ["همه دسته‌ها", "اعلان‌ها", "هنر نوشتن", "گفت‌وگو درباره کلیشه‌ها", "معرفی رمان", "گفت‌وگوی آزاد"];
const DEFAULT_AGE_RATINGS = ["G", "PG", "PG-13", "R", "R-17", "18+"];
const PERSIAN_DEFAULT_GENRES = ["فانتزی", "فانتزی حماسی"];
const LEGACY_ENGLISH_GENRES = ["High Fantasy"];
const DEFAULT_GENRE_FA = PERSIAN_DEFAULT_GENRES[0];
const DEFAULT_FORUM_CATEGORY_FA = "گفت‌وگوی آزاد";
const FORUM_ALL_SENTINELS = ["all categories", "همه دسته‌ها"];

function isForumAllSentinel(value: string): boolean {
  return FORUM_ALL_SENTINELS.includes(value.trim().toLowerCase());
}

async function readSystemSettings(): Promise<any> {
  const { data } = await supabase.from("settings").select("setting_value").eq("setting_key", "systemSettings").single();
  if (!data?.setting_value) return {};
  try {
    const parsed = typeof data.setting_value === "string" ? JSON.parse(data.setting_value) : data.setting_value;
    return sanitizeSystemSettingsTaxonomy(parsed);
  } catch {
    return {};
  }
}

function normalizeList(value: any): string[] {
  return Array.isArray(value) ? value.map((item) => decodeHtmlEntities(String(item)).trim()).filter(Boolean) : [];
}

function decodeHtmlEntities(value: string): string {
  let decoded = value;
  // sanitize-html may encode an already encoded value, producing &amp;amp;.
  // Decode repeatedly until stable so stored settings and form values compare
  // by their visible text rather than their transport encoding.
  for (let pass = 0; pass < 5; pass++) {
    const next = decoded
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function normalizeAllowedList(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item && typeof item === "object") {
      return [item.id, item.label, item.name, item.title].map((entry) => String(entry || "").trim()).filter(Boolean);
    }
    return [String(item || "").trim()].filter(Boolean);
  });
}

function assertSubset(label: string, selected: string[], allowedRaw: any[], max: number) {
  if (selected.length > max) {
    throw new Error(`${label} allows at most ${max} item(s).`);
  }
  const allowed = normalizeAllowedList(allowedRaw);
  if (allowed.length === 0) return;
  const allowedSet = new Set(allowed.map((item) => item.toLowerCase()));
  const invalid = selected.find((item) => !allowedSet.has(item.toLowerCase()));
  if (invalid) throw new Error(`${label} contains an unsupported value: ${invalid}`);
}

export class TaxonomyValidationError extends Error {
  code = "NOVEL_TAXONOMY_INVALID";
  detail: string;
  field: string;
  invalidValue?: string;

  constructor(message: string, field: string, invalidValue?: string) {
    super(message);
    this.name = "TaxonomyValidationError";
    this.field = field;
    this.invalidValue = invalidValue;
    this.detail = invalidValue ? `Unsupported ${field} value: ${invalidValue}` : message;
  }
}

export async function validateNovelTaxonomy(input: {
  genre?: unknown;
  mainCategories?: unknown;
  subCategories?: unknown;
  warnings?: unknown;
  legacyWarnings?: unknown;
  tags?: unknown;
  ageRating?: unknown;
}) {
  const settings = await readSystemSettings();
  const genres = normalizeList(settings.genres);
  const allowedGenres = Array.from(new Set([...genres, ...normalizeList(settings.mainCategories)]));
  const mainCategories = sanitizeTaxonomyList(normalizeList(input.mainCategories).map((v) => sanitizePlainText(v, 80)));
  const subCategories = sanitizeTaxonomyList(normalizeList(input.subCategories).map((v) => sanitizePlainText(v, 80)));
  const warningInput = sanitizeTaxonomyList(normalizeList(input.warnings).map((v) => sanitizePlainText(v, 120)));
  const configuredWarnings = [
    ...mergeContentWarningDefinitions(settings.contentWarnings),
    ...normalizeList(input.legacyWarnings),
  ];
  const normalizedWarnings = normalizeContentWarnings(warningInput, configuredWarnings);
  if (normalizedWarnings.invalid.length) {
    const invalid = normalizedWarnings.invalid[0];
    throw new TaxonomyValidationError(`Content warnings contains an unsupported value: ${invalid}`, "warnings", invalid);
  }
  const warnings = normalizedWarnings.values;
  const tags = sanitizeTaxonomyList(normalizeList(input.tags).map((v) => sanitizePlainText(v, 60)));
  const genre = decodeHtmlEntities(sanitizePlainText(input.genre || DEFAULT_GENRE_FA, 80));
  const ageRating = sanitizePlainText(input.ageRating || "PG-13", 20);

  // Accept if the value is in dbConfiguredValues ∪ Persian defaults ∪ legacy
  // English values. When nothing is configured in the database the check is
  // skipped entirely (pre-existing behavior for unconfigured instances).
  if (allowedGenres.length) {
    const acceptedGenres = new Set(
      [...allowedGenres, ...PERSIAN_DEFAULT_GENRES, ...LEGACY_ENGLISH_GENRES].map((item) => item.toLowerCase())
    );
    if (!acceptedGenres.has(genre.toLowerCase())) {
      throw new Error(`Genre contains an unsupported value: ${genre}`);
    }
  }

  assertSubset("Main categories", mainCategories, settings.mainCategories, 4);
  assertSubset("Sub categories", subCategories, settings.subCategories, 25);
  if (warnings.length > 20) {
    throw new TaxonomyValidationError("Content warnings allows at most 20 item(s).", "warnings");
  }

  if (!DEFAULT_AGE_RATINGS.includes(ageRating)) {
    throw new Error(`Age rating contains an unsupported value: ${ageRating}`);
  }

  return { genre, mainCategories, subCategories, warnings, tags: tags.slice(0, 40), ageRating };
}

export async function validateForumCategory(category: unknown) {
  const settings = await readSystemSettings();
  const allowed = normalizeList(settings.forumCategories).filter((c) => !isForumAllSentinel(c));
  const value = sanitizePlainText(category || DEFAULT_FORUM_CATEGORY_FA, 100);
  // Persian-first fallback, with legacy English categories still accepted so
  // older clients and unconfigured instances keep working.
  const fallbackAllowed = [
    ...PERSIAN_DEFAULT_FORUM_CATEGORIES,
    ...DEFAULT_FORUM_CATEGORIES
  ].filter((c) => !isForumAllSentinel(c));
  const finalAllowed = allowed.length ? allowed : fallbackAllowed;
  if (!finalAllowed.some((item) => item.toLowerCase() === value.toLowerCase())) {
    throw new TaxonomyValidationError(`Forum category contains an unsupported value: ${value}`, "category", value);
  }
  return value;
}
