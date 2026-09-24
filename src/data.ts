import { Novel } from "./types";
import {
  CONTENT_WARNING_DEFINITIONS,
  mergeContentWarningDefinitions,
} from "../shared/contentWarnings";

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

export function isBannedTaxonomyValue(value: unknown): boolean {
  const normalized = normalizeTaxonomyKey(taxonomyText(value));
  if (!normalized) return false;
  const tokens = normalized.split(" ");
  return tokens.includes("gay")
    || tokens.includes("lesbian")
    || tokens.includes("sexual")
    || tokens.some((token) => token.startsWith("lgbtq"));
}

export function filterTaxonomyList<T>(items: T[]): T[] {
  return (Array.isArray(items) ? items : []).filter((item) => !isBannedTaxonomyValue(item));
}

export let MAIN_CATEGORIES = [
  "اکشن", "ماجراجویی", "کمدی", "معاصر", "درام", "فانتزی",
  "تاریخی", "ترسناک", "معمایی", "روان‌شناختی", "عاشقانه", "طنز",
  "علمی-تخیلی", "داستان کوتاه", "هیجان‌انگیز", "تراژدی", "شکست قدرت"
];

export function normalizeMainGenre(value: unknown): string {
  const requested = String(value || "").trim();
  return MAIN_CATEGORIES.includes(requested) ? requested : "";
}

export let SUB_CATEGORIES = [
  "شخصیت اصلی ضدقهرمان", "شخصیت اصلی ضدشرور", "آخرالزمان", "هوش مصنوعی", "شخصیت اصلی جذاب", "جوانمردی", "معشوق رقیب", "دنج", "صنعتگری", "کولتیویشن", "سایبرپانک", "ساخت دِک", "هسته سیاهچال", "سیاهچال‌گردی", "پادآرمان‌شهر", "فن‌فیکشن", "شخصیت اصلی زن", "نخستین تماس", "گیم‌لیت", "تغییر جنسیت", "مهندسی ژنتیکی‌شده", "گریمدارک", "علمی-تخیلی سخت", "فانتزی والا", "پادشاهی‌سازی", "لیت‌آرپی‌جی", "قهرمان محلی", "فانتزی زمینی", "جادو", "دختر جادویی", "ماجیتک", "شخصیت اصلی مرد", "هنرهای رزمی", "مکا", "دانش مدرن", "تکامل هیولا", "چند شخصیت اصلی", "چند معشوق", "اسطوره‌شناسی", "شخصیت اصلی غیرانسانی", "شخصیت اصلی غیرانسان‌نما", "اوتومه", "فانتزی درگاهی / ایسکای", "پسا آخرالزمانی", "پیشرفت", "تعاملی با خواننده", "تناسخ", "زیرخط داستانی عاشقانه", "طبقه حاکم", "زندگی مدرسه‌ای", "هویت مخفی", "برشی از زندگی", "علمی-تخیلی نرم", "اپرای فضایی", "ورزشی", "استیم‌پانک", "راهبردی", "شخصیت اصلی قدرتمند", "ابرقهرمان‌ها", "فراطبیعی", "بقا", "تهاجم سیستم", "مهندسی فناورانه", "حلقه زمانی", "سفر در زمان", "برج", "فانتزی شهری", "شخصیت اصلی شرور", "واقعیت مجازی"
];

export let CONTENT_WARNINGS: Array<{ id: string; label: string; desc: string }> = CONTENT_WARNING_DEFINITIONS.map((warning) => ({
  id: warning.id,
  label: warning.label,
  desc: warning.description,
}));

export let GENRES = [
  "همه ژانرها",
  "لیت‌آرپی‌جی و فانتزی",
  "علمی-تخیلی و سایبرپانک",
  "عاشقانه و درام",
  "معمایی و نوآر",
];

export function updateDynamicCategories(config: any) {
  if (config.mainCategories && Array.isArray(config.mainCategories)) {
    const configured = filterTaxonomyList(config.mainCategories).map((item) => String(item));
    MAIN_CATEGORIES = configured.some((item) => String(item).toLowerCase() === "شکست قدرت")
      ? configured
      : [...configured, "شکست قدرت"];
  }
  if (config.subCategories && Array.isArray(config.subCategories)) {
    SUB_CATEGORIES = filterTaxonomyList(config.subCategories);
  }
  if (config.contentWarnings && Array.isArray(config.contentWarnings)) {
    CONTENT_WARNINGS = filterTaxonomyList(mergeContentWarningDefinitions(config.contentWarnings)).map((warning) => ({
      id: warning.id,
      label: warning.label,
      desc: warning.description,
    }));
  }
  if (config.genres && Array.isArray(config.genres)) {
    GENRES = filterTaxonomyList(config.genres);
  }
}


export const CONTRAST_THEMES = {
  light: {
    name: "سفید داستانی",
    bg: "bg-[var(--app-bg)]",
    text: "text-[var(--app-text)]",
    accent: "text-[var(--accent-text)]",
    accentBg: "bg-[var(--accent-soft)]",
    border: "border-[var(--app-border)]",
    card: "bg-[var(--app-card)]",
    cardText: "text-[var(--app-text)]",
    shadow: "shadow-[var(--app-shadow)]",
    secondaryText: "text-[var(--app-muted)] animate-none",
    highlight: "bg-[var(--accent-soft)]",
  },
  dark: {
    name: "بنفش سلطنتی و ارغوان",
    bg: "bg-[var(--app-bg)]",
    text: "text-[var(--app-text)]",
    accent: "text-[var(--accent-text)]",
    accentBg: "bg-[var(--accent-soft)]",
    border: "border-[var(--app-border)]",
    card: "bg-[var(--app-card)]",
    cardText: "text-[var(--app-text)]",
    shadow: "shadow-[var(--app-shadow)]",
    secondaryText: "text-[var(--app-muted)]",
    highlight: "bg-[var(--accent-soft)]",
  }
};

export const INITIAL_NOVELS: Novel[] = [];
