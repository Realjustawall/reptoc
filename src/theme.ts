export type AccentThemeId = "orange" | "blue" | "discord" | "discord-nitro" | "emerald" | "cyan" | "pink" | "ocean" | "sunset" | "gray" | "red" | "yellow" | "sage" | "lavender" | "warm-paper" | "nordic-mist" | "custom";

export interface AccentThemeDefinition {
  id: AccentThemeId;
  label: string;
  description: string;
  accent: string;
  hover: string;
  soft: string;
  border: string;
  textLight: string;
  textDark: string;
  contrast: "#ffffff" | "#171717";
  secondary: string;
  comfort?: boolean;
  harmony?: string;
}

export interface CustomThemeColors {
  accent: string;
  secondary: string;
}

export type UiFontFamily = "estedad" | "vazirmatn" | "noto-sans" | "noto-naskh" | "noto-kufi" | "markazi" | "amiri" | "cairo" | "tajawal" | "changa" | "lemonada" | "system";
export type UiRadius = "sharp" | "soft" | "round";
export type UiMotion = "full" | "reduced";
export type UiContrast = "standard" | "high";

export interface AppearanceSettings {
  fontFamily: UiFontFamily;
  fontScale: number;
  radius: UiRadius;
  motion: UiMotion;
  contrast: UiContrast;
  bookMode: boolean;
  customSurfaces: boolean;
  lightBackground: string;
  lightCard: string;
  lightText: string;
  darkBackground: string;
  darkCard: string;
  darkText: string;
}

export const DEFAULT_CUSTOM_THEME: CustomThemeColors = {
  accent: "#0f766e",
  secondary: "#2563eb",
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  fontFamily: "estedad",
  fontScale: 100,
  radius: "round",
  motion: "full",
  contrast: "standard",
  bookMode: false,
  customSurfaces: false,
  lightBackground: "#f5f5f5",
  lightCard: "#ffffff",
  lightText: "#171717",
  darkBackground: "#07080c",
  darkCard: "#101116",
  darkText: "#f5f3ff",
};

export const ACCENT_THEMES: readonly AccentThemeDefinition[] = [
  { id: "orange", label: "نارنجی", description: "گرم و داستانی", accent: "#c2410c", hover: "#9a3412", soft: "#fff1e8", border: "#fdba94", textLight: "#c2410c", textDark: "#fb923c", contrast: "#ffffff", secondary: "#7c3aed" },
  { id: "blue", label: "آبی", description: "آرام و متمرکز", accent: "#2563eb", hover: "#1d4ed8", soft: "#eff6ff", border: "#93c5fd", textLight: "#1d4ed8", textDark: "#60a5fa", contrast: "#ffffff", secondary: "#06b6d4" },
  { id: "discord", label: "دیسکورد", description: "خاکستری تیره و بلورپل", accent: "#5865f2", hover: "#4752c4", soft: "#eef0ff", border: "#a5b4fc", textLight: "#4752c4", textDark: "#b5b9ff", contrast: "#ffffff", secondary: "#23a559" },
  { id: "discord-nitro", label: "نیترو شب", description: "الهام‌گرفته از تم نیترو", accent: "#7983f5", hover: "#626bd1", soft: "#eef0ff", border: "#b8bdfd", textLight: "#4e57c8", textDark: "#c9ccff", contrast: "#171717", secondary: "#eb459e" },
  { id: "emerald", label: "زمردی", description: "طبیعی و متعادل", accent: "#047857", hover: "#065f46", soft: "#ecfdf5", border: "#6ee7b7", textLight: "#047857", textDark: "#6ee7b7", contrast: "#ffffff", secondary: "#0ea5e9" },
  { id: "cyan", label: "فیروزه‌ای", description: "شفاف و آینده‌نگر", accent: "#0e7490", hover: "#155e75", soft: "#ecfeff", border: "#67e8f9", textLight: "#0e7490", textDark: "#67e8f9", contrast: "#ffffff", secondary: "#2563eb" },
  { id: "pink", label: "صورتی", description: "نرم و پرجنب‌وجوش", accent: "#be185d", hover: "#9d174d", soft: "#fdf2f8", border: "#f9a8d4", textLight: "#be185d", textDark: "#f9a8d4", contrast: "#ffffff", secondary: "#f97316" },
  { id: "ocean", label: "اقیانوس", description: "عمیق و خنک", accent: "#0369a1", hover: "#075985", soft: "#f0f9ff", border: "#7dd3fc", textLight: "#0369a1", textDark: "#7dd3fc", contrast: "#ffffff", secondary: "#14b8a6" },
  { id: "sunset", label: "غروب", description: "گرادیان گرم شبانه", accent: "#c2410c", hover: "#9a3412", soft: "#fff7ed", border: "#fdba74", textLight: "#c2410c", textDark: "#fdba74", contrast: "#ffffff", secondary: "#db2777" },
  { id: "gray", label: "خاکستری", description: "خنثی و مینیمال", accent: "#52525b", hover: "#3f3f46", soft: "#f4f4f5", border: "#d4d4d8", textLight: "#3f3f46", textDark: "#d4d4d8", contrast: "#ffffff", secondary: "#71717a" },
  { id: "red", label: "قرمز", description: "پرقدرت و نمایشی", accent: "#dc2626", hover: "#b91c1c", soft: "#fef2f2", border: "#fca5a5", textLight: "#b91c1c", textDark: "#fb7185", contrast: "#ffffff", secondary: "#f97316" },
  { id: "yellow", label: "زرد", description: "روشن و پرانرژی", accent: "#eab308", hover: "#ca8a04", soft: "#fefce8", border: "#fde047", textLight: "#854d0e", textDark: "#fde047", contrast: "#171717", secondary: "#f97316" },
  { id: "sage", label: "مریم‌گلی", description: "سبز–آبیِ هم‌خانواده و کم‌اشباع", accent: "#477a62", hover: "#35634e", soft: "#eef5f0", border: "#aac4b5", textLight: "#35634e", textDark: "#9fcbb3", contrast: "#ffffff", secondary: "#607d8b", comfort: true, harmony: "هم‌خانواده" },
  { id: "lavender", label: "اسطوخودوس", description: "بنفش–آبیِ ملایم برای تمرکز", accent: "#6b5b95", hover: "#57487d", soft: "#f3f0f8", border: "#c6bdd9", textLight: "#57487d", textDark: "#c8bde0", contrast: "#ffffff", secondary: "#52758a", comfort: true, harmony: "هم‌خانواده" },
  { id: "warm-paper", label: "کاغذ گرم", description: "خنثی گرم با مکمل سبزِ آرام", accent: "#8a6238", hover: "#704b29", soft: "#f7f0e6", border: "#d5bea3", textLight: "#704b29", textDark: "#ddb98f", contrast: "#ffffff", secondary: "#64745d", comfort: true, harmony: "مکمل کنترل‌شده" },
  { id: "nordic-mist", label: "مه شمالی", description: "آبی–فیروزه‌ایِ سرد و متعادل", accent: "#426b78", hover: "#315762", soft: "#edf4f5", border: "#adc5ca", textLight: "#315762", textDark: "#a9cbd2", contrast: "#ffffff", secondary: "#68769a", comfort: true, harmony: "هم‌خانواده" },
] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function readBrowserPreference(key: string): string | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  try {
    const localValue = window.localStorage.getItem(key);
    if (localValue !== null) return localValue;
  } catch {}
  try {
    const prefix = `${encodeURIComponent(key)}=`;
    const cookie = document.cookie.split("; ").find((item) => item.startsWith(prefix));
    return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
  } catch {
    return null;
  }
}

export function writeBrowserPreference(key: string, value: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try { window.localStorage.setItem(key, value); } catch {}
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {}
}

export function normalizeAccentTheme(value: unknown): AccentThemeId {
  const candidate = String(value || "").trim().toLowerCase();
  return ([...ACCENT_THEMES.map((theme) => theme.id), "custom"] as string[]).includes(candidate)
    ? candidate as AccentThemeId
    : "orange";
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  const candidate = String(value || "").trim();
  return HEX_COLOR.test(candidate) ? candidate.toLowerCase() : fallback;
}

export function normalizeCustomTheme(value: unknown): CustomThemeColors {
  const raw = value && typeof value === "object" ? value as Partial<CustomThemeColors> : {};
  return {
    accent: normalizeHexColor(raw.accent, DEFAULT_CUSTOM_THEME.accent),
    secondary: normalizeHexColor(raw.secondary, DEFAULT_CUSTOM_THEME.secondary),
  };
}

export function normalizeAppearance(value: unknown): AppearanceSettings {
  const raw = value && typeof value === "object" ? value as Partial<AppearanceSettings> : {};
  const fontFamily: UiFontFamily = ["estedad", "vazirmatn", "noto-sans", "noto-naskh", "noto-kufi", "markazi", "amiri", "cairo", "tajawal", "changa", "lemonada", "system"].includes(String(raw.fontFamily)) ? raw.fontFamily as UiFontFamily : DEFAULT_APPEARANCE.fontFamily;
  const radius: UiRadius = ["sharp", "soft", "round"].includes(String(raw.radius)) ? raw.radius as UiRadius : DEFAULT_APPEARANCE.radius;
  const motion: UiMotion = raw.motion === "reduced" ? "reduced" : "full";
  const contrast: UiContrast = raw.contrast === "high" ? "high" : "standard";
  const requestedScale = Number(raw.fontScale);
  return {
    fontFamily,
    fontScale: Number.isFinite(requestedScale) ? Math.min(120, Math.max(85, Math.round(requestedScale))) : DEFAULT_APPEARANCE.fontScale,
    radius,
    motion,
    contrast,
    bookMode: raw.bookMode === true,
    customSurfaces: raw.customSurfaces === true,
    lightBackground: normalizeHexColor(raw.lightBackground, DEFAULT_APPEARANCE.lightBackground),
    lightCard: normalizeHexColor(raw.lightCard, DEFAULT_APPEARANCE.lightCard),
    lightText: normalizeHexColor(raw.lightText, DEFAULT_APPEARANCE.lightText),
    darkBackground: normalizeHexColor(raw.darkBackground, DEFAULT_APPEARANCE.darkBackground),
    darkCard: normalizeHexColor(raw.darkCard, DEFAULT_APPEARANCE.darkCard),
    darkText: normalizeHexColor(raw.darkText, DEFAULT_APPEARANCE.darkText),
  };
}

function mixHex(left: string, right: string, ratio: number): string {
  const mix = (offset: number) => Math.round(
    Number.parseInt(left.slice(offset, offset + 2), 16) * (1 - ratio)
    + Number.parseInt(right.slice(offset, offset + 2), 16) * ratio,
  ).toString(16).padStart(2, "0");
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(left: string, right: string): number {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function ensureReadableColor(color: string, background: "#ffffff" | "#080512", toward: "#000000" | "#ffffff"): string {
  if (contrastRatio(color, background) >= 4.5) return color;
  for (let ratio = 0.08; ratio <= 0.88; ratio += 0.08) {
    const candidate = mixHex(color, toward, ratio);
    if (contrastRatio(candidate, background) >= 4.5) return candidate;
  }
  return toward;
}

export function resolveAccentTheme(id: AccentThemeId, custom: CustomThemeColors): AccentThemeDefinition {
  const preset = ACCENT_THEMES.find((theme) => theme.id === id);
  if (preset) return preset;
  const accent = normalizeHexColor(custom.accent, DEFAULT_CUSTOM_THEME.accent);
  const secondary = normalizeHexColor(custom.secondary, DEFAULT_CUSTOM_THEME.secondary);
  return {
    id: "custom",
    label: "سفارشی",
    description: "رنگ‌های انتخابی شما",
    accent,
    hover: mixHex(accent, "#000000", 0.18),
    soft: mixHex(accent, "#ffffff", 0.9),
    border: mixHex(accent, "#ffffff", 0.58),
    textLight: ensureReadableColor(accent, "#ffffff", "#000000"),
    textDark: ensureReadableColor(accent, "#080512", "#ffffff"),
    contrast: contrastRatio("#171717", accent) >= contrastRatio("#ffffff", accent) ? "#171717" : "#ffffff",
    secondary,
  };
}

export function accentThemeCssVariables(id: AccentThemeId, custom: CustomThemeColors): Record<string, string> {
  const theme = resolveAccentTheme(id, custom);
  return {
    "--scheme-accent": theme.accent,
    "--scheme-hover": theme.hover,
    "--scheme-soft": theme.soft,
    "--scheme-border": theme.border,
    "--scheme-text-light": theme.textLight,
    "--scheme-text-dark": theme.textDark,
    "--scheme-contrast": theme.contrast,
    "--scheme-secondary": theme.secondary,
  };
}

export function appearanceCssVariables(settings: AppearanceSettings, mode: "light" | "dark"): Record<string, string> {
  const normalized = normalizeAppearance(settings);
  const fonts: Record<UiFontFamily, string> = {
    estedad: '"Estedad", "Vazirmatn", sans-serif',
    vazirmatn: '"Vazirmatn", "Estedad", sans-serif',
    "noto-sans": '"Noto Sans Arabic Variable", "Estedad", sans-serif',
    "noto-naskh": '"Noto Naskh Arabic Variable", "Vazirmatn", serif',
    "noto-kufi": '"Noto Kufi Arabic Variable", "Estedad", sans-serif',
    markazi: '"Markazi Text Variable", "Noto Naskh Arabic Variable", serif',
    amiri: '"Amiri", "Noto Naskh Arabic Variable", serif',
    cairo: '"Cairo", "Noto Sans Arabic Variable", sans-serif',
    tajawal: '"Tajawal", "Noto Sans Arabic Variable", sans-serif',
    changa: '"Changa", "Noto Kufi Arabic Variable", sans-serif',
    lemonada: '"Lemonada", "Noto Naskh Arabic Variable", serif',
    system: 'Tahoma, Arial, system-ui, sans-serif',
  };
  const radii: Record<UiRadius, [string, string, string]> = {
    sharp: ["0.2rem", "0.3rem", "0.45rem"],
    soft: ["0.45rem", "0.7rem", "0.95rem"],
    round: ["0.65rem", "1rem", "1.4rem"],
  };
  const result: Record<string, string> = {
    "--ui-font-family": fonts[normalized.fontFamily],
    "--font-sans": fonts[normalized.fontFamily],
    "--ui-radius-sm": radii[normalized.radius][0],
    "--ui-radius-md": radii[normalized.radius][1],
    "--ui-radius-lg": radii[normalized.radius][2],
  };
  if (normalized.customSurfaces) {
    const background = mode === "dark" ? normalized.darkBackground : normalized.lightBackground;
    const card = mode === "dark" ? normalized.darkCard : normalized.lightCard;
    const foreground = mode === "dark" ? normalized.darkText : normalized.lightText;
    result["--app-bg"] = background;
    result["--app-card"] = card;
    result["--app-elevated"] = `color-mix(in srgb, ${card} 92%, ${foreground})`;
    result["--app-subtle"] = `color-mix(in srgb, ${background} 92%, ${card})`;
    result["--app-text"] = foreground;
    result["--app-muted"] = `color-mix(in srgb, ${foreground} ${normalized.contrast === "high" ? "88%" : "72%"}, ${background})`;
    result["--app-border"] = `color-mix(in srgb, ${foreground} ${normalized.contrast === "high" ? "34%" : "20%"}, ${card})`;
    result["--app-header"] = `color-mix(in srgb, ${card} 96%, transparent)`;
  }
  return result;
}
