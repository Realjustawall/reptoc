export const PREMIUM_TEMPLATE_IDS = ["royal", "nocturne", "enchanted", "blossom", "neon"] as const;
export type PremiumTemplateId = typeof PREMIUM_TEMPLATE_IDS[number];

export interface PremiumPalette {
  primary: string;
  secondary: string;
  accent: string;
}

export interface PremiumPresentation {
  enabled: boolean;
  templateId: PremiumTemplateId;
  palette?: PremiumPalette;
}

export interface PremiumTemplateDefinition {
  id: PremiumTemplateId;
  name: string;
  description: string;
  colors: PremiumPalette;
  background: string;
  overlay: string;
  typography: string;
  button: string;
  card: string;
  badge: string;
  animation: "shimmer" | "mist" | "sparkle" | "float" | "pulse";
  cover: string;
  decoration: string;
}

export const PREMIUM_TEMPLATES: readonly PremiumTemplateDefinition[] = [
  {
    id: "royal", name: "سلطنتی آب‌طلا", description: "لاجوردی عمیق، طلای گرم و نور تشریفاتیِ مهارشده.",
    colors: { primary: "#172554", secondary: "#713f12", accent: "#fbbf24" },
    background: "radial-gradient(circle at 15% 10%, rgba(251,191,36,.18), transparent 32%), linear-gradient(135deg,#070b1f,#172554 55%,#21130a)",
    overlay: "linear-gradient(120deg,rgba(255,255,255,.04),transparent 42%)", typography: "premium-type-royal",
    button: "premium-button-royal", card: "premium-card-royal", badge: "premium-badge-royal",
    animation: "shimmer", cover: "premium-cover-royal", decoration: "حاشیه‌های روشن تاج",
  },
  {
    id: "nocturne", name: "نوکتورن مخملی", description: "حال‌وهوایی مرموز و ابسیدینی با مه بنفش.",
    colors: { primary: "#09090b", secondary: "#3b0764", accent: "#c084fc" },
    background: "radial-gradient(circle at 80% 5%,rgba(192,132,252,.2),transparent 34%),linear-gradient(145deg,#030305,#181021 60%,#09090b)",
    overlay: "linear-gradient(90deg,rgba(88,28,135,.09),transparent)", typography: "premium-type-nocturne",
    button: "premium-button-nocturne", card: "premium-card-nocturne", badge: "premium-badge-nocturne",
    animation: "mist", cover: "premium-cover-nocturne", decoration: "مه جوهریِ آرام",
  },
  {
    id: "enchanted", name: "دره افسون‌زده", description: "جادوی زمردی، ستاره‌افشانی و ژرفای کتاب قصه.",
    colors: { primary: "#052e2b", secondary: "#164e63", accent: "#5eead4" },
    background: "radial-gradient(circle at 20% 20%,rgba(94,234,212,.2),transparent 28%),linear-gradient(135deg,#022c22,#083344 60%,#172554)",
    overlay: "radial-gradient(circle at 70% 25%,rgba(255,255,255,.08) 0 1px,transparent 2px)", typography: "premium-type-enchanted",
    button: "premium-button-enchanted", card: "premium-card-enchanted", badge: "premium-badge-enchanted",
    animation: "sparkle", cover: "premium-cover-enchanted", decoration: "ذرات جادویی پراکنده",
  },
  {
    id: "blossom", name: "رؤیای گلگون", description: "پالتی عاشقانه و لطیف با گرمای درخشان گل رز.",
    colors: { primary: "#4c0519", secondary: "#831843", accent: "#fda4af" },
    background: "radial-gradient(circle at 80% 20%,rgba(253,164,175,.24),transparent 34%),linear-gradient(145deg,#2b0a18,#701a3e 58%,#431407)",
    overlay: "linear-gradient(120deg,rgba(255,255,255,.06),transparent 50%)", typography: "premium-type-blossom",
    button: "premium-button-blossom", card: "premium-card-blossom", badge: "premium-badge-blossom",
    animation: "float", cover: "premium-cover-blossom", decoration: "گلبرگ‌های شناور لطیف",
  },
  {
    id: "neon", name: "افق نئونی", description: "میدانی دقیق و آینده‌نگر از فیروزه‌ای و بنفش الکتریکی.",
    colors: { primary: "#020617", secondary: "#312e81", accent: "#22d3ee" },
    background: "linear-gradient(rgba(34,211,238,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,238,.06) 1px,transparent 1px),linear-gradient(145deg,#020617,#111827 52%,#312e81)",
    overlay: "linear-gradient(110deg,transparent,rgba(34,211,238,.08),transparent)", typography: "premium-type-neon",
    button: "premium-button-neon", card: "premium-card-neon", badge: "premium-badge-neon",
    animation: "pulse", cover: "premium-cover-neon", decoration: "شبکه افق کم‌نور",
  },
] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function sanitizePremiumPresentation(value: unknown): PremiumPresentation {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const templateId = PREMIUM_TEMPLATE_IDS.includes(input.templateId as PremiumTemplateId)
    ? input.templateId as PremiumTemplateId
    : "royal";
  const rawPalette = input.palette && typeof input.palette === "object"
    ? input.palette as Record<string, unknown>
    : null;
  const palette = rawPalette
    && HEX_COLOR.test(String(rawPalette.primary || ""))
    && HEX_COLOR.test(String(rawPalette.secondary || ""))
    && HEX_COLOR.test(String(rawPalette.accent || ""))
    ? {
        primary: String(rawPalette.primary).toLowerCase(),
        secondary: String(rawPalette.secondary).toLowerCase(),
        accent: String(rawPalette.accent).toLowerCase(),
      }
    : undefined;
  return { enabled: input.enabled === true, templateId, ...(palette ? { palette } : {}) };
}

export function premiumTemplateById(id: unknown): PremiumTemplateDefinition {
  return PREMIUM_TEMPLATES.find((template) => template.id === id) || PREMIUM_TEMPLATES[0];
}
