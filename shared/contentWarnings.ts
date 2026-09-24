export interface ContentWarningDefinition {
  id: string;
  label: string;
  description: string;
  aliases?: readonly string[];
}

export const CONTENT_WARNING_DEFINITIONS = [
  {
    id: "ai_assisted",
    label: "محتوای با کمک هوش مصنوعی",
    description: "نویسنده از ابزار هوش مصنوعی برای ویرایش یا بازخوانی متن بهره گرفته است.",
    aliases: ["AI Assisted", "AI-Assisted"],
  },
  {
    id: "ai_generated",
    label: "محتوای تولیدشده با هوش مصنوعی",
    description: "داستان با ابزار هوش مصنوعی تولید و توسط نویسنده هدایت یا ویرایش شده است.",
    aliases: ["AI Generated", "AI-Generated"],
  },
  {
    id: "graphic_violence",
    label: "خشونت گرافیکی",
    description: "توصیف‌های تفصیلی یا آزاردهنده از خشونت یا آسیب جسمی.",
    aliases: ["Violence & Gore", "Violence and Gore"],
  },
  {
    id: "profanity",
    label: "الفاظ رکیک",
    description: "کاربرد مکرر زبان تند، رکیک یا توهین‌آمیز.",
    aliases: ["Strong Language"],
  },
  {
    id: "sensitive_content",
    label: "محتوای حساس",
    description: "مواد بالغ‌پسندِ نگران‌کننده که تحت هیچ هشدار دیگری نمی‌گنجند.",
  },
  {
    id: "dark_themes",
    label: "درون‌مایه‌های تاریک",
    description: "کاوش پیوسته درون‌مایه‌های آشفته، تیره یا از نظر روانی طاقت‌فرسا.",
    aliases: ["Dark Theme"],
  },
  {
    id: "tragic_elements",
    label: "عناصر تراژیک",
    description: "درون‌مایه‌ها یا رویدادهایی همراه با فقدان بزرگ، اندوه یا تراژدی.",
    aliases: ["Tragic elements", "Tragedy"],
  },
] as const satisfies readonly ContentWarningDefinition[];

export type CanonicalContentWarningId = typeof CONTENT_WARNING_DEFINITIONS[number]["id"];

function warningKey(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/&/g, " and ")
    // Keep every Unicode letter/number (Persian included) so localized
    // catalogue labels resolve to their canonical ids instead of collapsing.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function configuredWarningValues(configured: unknown): Array<{ id: string; names: string[] }> {
  if (!Array.isArray(configured)) return [];
  return configured.flatMap((item) => {
    if (typeof item === "string") {
      const value = item.trim();
      return value ? [{ id: value, names: [value] }] : [];
    }
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const id = String(record.id || record.label || record.name || record.title || "").trim();
    const names = [record.id, record.label, record.name, record.title]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return id ? [{ id, names }] : [];
  });
}

export function normalizeContentWarnings(
  input: unknown,
  configured: unknown = [],
): { values: string[]; invalid: string[] } {
  const lookup = new Map<string, string>();
  for (const definition of CONTENT_WARNING_DEFINITIONS) {
    const aliases = "aliases" in definition ? definition.aliases : [];
    for (const value of [definition.id, definition.label, ...aliases]) {
      lookup.set(warningKey(value), definition.id);
    }
  }
  for (const definition of configuredWarningValues(configured)) {
    for (const value of [definition.id, ...definition.names]) {
      const key = warningKey(value);
      if (key && !lookup.has(key)) lookup.set(key, definition.id);
    }
  }

  const values: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(input) ? input : []) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) continue;
    const canonical = lookup.get(warningKey(trimmed));
    if (!canonical) {
      invalid.push(trimmed);
      continue;
    }
    const duplicateKey = warningKey(canonical);
    if (!seen.has(duplicateKey)) {
      seen.add(duplicateKey);
      values.push(canonical);
    }
  }
  return { values, invalid };
}

export function mergeContentWarningDefinitions(configured: unknown): ContentWarningDefinition[] {
  const merged = new Map<string, ContentWarningDefinition>(
    CONTENT_WARNING_DEFINITIONS.map((definition) => [definition.id, { ...definition }]),
  );
  for (const definition of configuredWarningValues(configured)) {
    const canonical = normalizeContentWarnings([definition.id], configured).values[0] || definition.id;
    if (merged.has(canonical)) continue;
    const label = definition.names.find((name) => name !== definition.id) || definition.id;
    merged.set(canonical, { id: canonical, label, description: "" });
  }
  return [...merged.values()];
}
