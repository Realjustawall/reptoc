import React, { useEffect, useRef, useState } from "react";
import { Check, Moon, Palette, RotateCcw, SlidersHorizontal, Sun, Type, X } from "lucide-react";
import {
  ACCENT_THEMES,
  DEFAULT_CUSTOM_THEME,
  resolveAccentTheme,
  type AccentThemeId,
  type AppearanceSettings,
  type CustomThemeColors,
  type UiFontFamily,
} from "../theme";

interface ThemeCustomizerProps {
  mode: "light" | "dark";
  accentTheme: AccentThemeId;
  customColors: CustomThemeColors;
  onModeChange: (mode: "light" | "dark") => void;
  onAccentThemeChange: (theme: AccentThemeId) => void;
  onCustomColorsChange: (colors: CustomThemeColors) => void;
  appearance: AppearanceSettings;
  onAppearanceChange: (settings: AppearanceSettings) => void;
  onReset: () => void;
}

export default function ThemeCustomizer({
  mode,
  accentTheme,
  customColors,
  onModeChange,
  onAccentThemeChange,
  onCustomColorsChange,
  appearance,
  onAppearanceChange,
  onReset,
}: ThemeCustomizerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = resolveAccentTheme(accentTheme, customColors);
  const isDark = mode === "dark";
  const updateAppearance = (change: Partial<AppearanceSettings>) => onAppearanceChange({ ...appearance, ...change });

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    if (window.matchMedia("(max-width: 639px)").matches) document.body.style.overflow = "hidden";
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const customTheme = {
    ...resolveAccentTheme("custom", {
      accent: customColors.accent || DEFAULT_CUSTOM_THEME.accent,
      secondary: customColors.secondary || DEFAULT_CUSTOM_THEME.secondary,
    }),
    description: "دو رنگ دلخواه",
    comfort: false,
  };
  const themeGroups = [
    { label: "پالت‌های آرام بر پایهٔ نظریهٔ رنگ", description: "اشباع کنترل‌شده و سطوح مناسب استفادهٔ طولانی", themes: ACCENT_THEMES.filter((theme) => theme.comfort) },
    { label: "تم‌های اصلی", description: "تم‌های فعلی رپتوک", themes: ACCENT_THEMES.filter((theme) => !theme.comfort) },
    { label: "تم شخصی", description: "رنگ‌های خودتان را بسازید", themes: [customTheme] },
  ];
  const fontOptions: ReadonlyArray<{ id: UiFontFamily; label: string; description: string; family: string }> = [
    { id: "estedad", label: "استعداد", description: "مدرن و متعادل", family: '"Estedad", sans-serif' },
    { id: "vazirmatn", label: "وزیرمتن", description: "خوانا و آشنا", family: '"Vazirmatn", sans-serif' },
    { id: "noto-sans", label: "نوتو سنس", description: "ساده و چشم‌آرام", family: '"Noto Sans Arabic Variable", sans-serif' },
    { id: "noto-naskh", label: "نوتو نسخ", description: "ادبی و مناسب متن", family: '"Noto Naskh Arabic Variable", serif' },
    { id: "noto-kufi", label: "نوتو کوفی", description: "هندسی و رسمی", family: '"Noto Kufi Arabic Variable", sans-serif' },
    { id: "markazi", label: "مرکزی", description: "کلاسیک و فشرده", family: '"Markazi Text Variable", serif' },
    { id: "amiri", label: "امیری", description: "کتابی و خوش‌خوان", family: '"Amiri", serif' },
    { id: "cairo", label: "قاهره", description: "مدرن و همه‌کاره", family: '"Cairo", sans-serif' },
    { id: "tajawal", label: "تجوال", description: "تمیز و مینیمال", family: '"Tajawal", sans-serif' },
    { id: "changa", label: "چانگا", description: "نمایشی و هندسی", family: '"Changa", sans-serif' },
    { id: "lemonada", label: "لیمونادا", description: "نرم و شخصیت‌دار", family: '"Lemonada", serif' },
    { id: "system", label: "سیستمی", description: "فونت دستگاه", family: "Tahoma, Arial, sans-serif" },
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`relative flex h-10 w-10 items-center justify-center rounded-xl border transition-all sm:h-9 sm:w-9 ${
          isDark ? "border-slate-700/70 bg-[#11131a] text-slate-200 hover:border-[var(--accent)]" : "border-[#d8d8d8] bg-white text-stone-800 shadow-sm hover:border-[var(--accent)]"
        }`}
        aria-label="شخصی‌سازی رنگ و حالت نمایش"
        aria-expanded={open}
        title="رنگ و حالت نمایش"
      >
        <Palette className="h-[19px] w-[19px]" />
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--app-card)]" style={{ background: `linear-gradient(135deg, ${active.accent} 50%, ${active.secondary} 50%)` }} />
      </button>

      {open && (
        <>
        <button type="button" className="fixed inset-0 z-[79] bg-black/35 backdrop-blur-[2px] sm:hidden" onClick={() => setOpen(false)} aria-label="بستن تنظیمات ظاهر" />
        <section
          className={`fixed inset-x-0 bottom-0 z-[80] max-h-[min(88dvh,48rem)] w-auto overflow-y-auto overscroll-contain rounded-t-3xl border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:max-h-[calc(100dvh-5rem)] sm:w-[23rem] sm:rounded-2xl ${
            isDark ? "border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text)]" : "border-[#d8d8d8] bg-white text-[#171717]"
          }`}
          aria-label="تنظیمات پوسته"
          role="dialog"
          aria-modal="true"
          dir="rtl"
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--app-border)] sm:hidden" />
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]"><SlidersHorizontal className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-black">ظاهر رپتوک</h2>
              <p className="text-[10px] text-slate-500">حالت و رنگ دلخواه شما روی همهٔ بخش‌ها اعمال می‌شود.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--app-border)] text-slate-500 hover:border-[var(--accent)] hover:text-[var(--accent-text)]" aria-label="بستن"><X className="h-4 w-4" /></button>
          </div>

          <div className={`grid grid-cols-2 rounded-xl p-1 ${isDark ? "bg-black/25" : "bg-[#f1f1f1]"}`} role="group" aria-label="حالت روشن یا تیره">
            {([
              { id: "light" as const, label: "روشن", icon: Sun },
              { id: "dark" as const, label: "تیره", icon: Moon },
            ]).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onModeChange(option.id);
                  // A mode switch changes the header colors but must not be
                  // interpreted as an outside click that dismisses this panel.
                  setOpen(true);
                }}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-black transition-all ${mode === option.id ? "bg-[var(--accent)] text-[var(--accent-contrast)] shadow-sm" : "text-slate-500 hover:text-[var(--accent-text)]"}`}
                aria-pressed={mode === option.id}
              >
                <option.icon className="h-4 w-4" /> {option.label}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-4">
            {themeGroups.map((group) => (
              <div key={group.label}>
                <div className="mb-2 flex items-end justify-between gap-3">
                  <p className="text-[10px] font-black text-slate-500">{group.label}</p>
                  <span className="text-[8px] text-slate-400">{group.description}</span>
                </div>
                <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
                  {group.themes.map((option) => {
                    const selected = accentTheme === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          onAccentThemeChange(option.id);
                          if (option.id === "discord" || option.id === "discord-nitro") onModeChange("dark");
                        }}
                        className={`flex min-h-14 items-center gap-2.5 rounded-xl border p-2 text-start transition-all ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)]" : isDark ? "border-[var(--app-border)] hover:border-[var(--accent-border)]" : "border-[#e2e2e2] hover:border-[var(--accent-border)] hover:bg-[#fafafa]"}`}
                        aria-pressed={selected}
                      >
                        <span className="h-8 w-8 shrink-0 rounded-lg shadow-inner" style={{ background: `linear-gradient(135deg, ${option.accent} 50%, ${option.secondary} 50%)` }} />
                        <span className="min-w-0 flex-1">
                          <strong className="flex items-center gap-1 text-[11px] font-black">
                            {option.label}
                            {option.comfort && <span className="rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[7px] text-[var(--accent-text)]">آرام</span>}
                          </strong>
                          <span className="block truncate text-[9px] text-slate-500">{option.description}</span>
                        </span>
                        {selected && <Check className="h-4 w-4 shrink-0 text-[var(--accent-text)]" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {accentTheme === "custom" && (
            <div className={`mt-3 grid grid-cols-2 gap-3 rounded-xl border p-3 ${isDark ? "border-[var(--app-border)] bg-black/20" : "border-[#e2e2e2] bg-[#fafafa]"}`}>
              <label className="text-[10px] font-bold text-slate-500">
                رنگ اصلی
                <span className="mt-1 flex items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-card)] p-1.5 font-mono text-[10px]">
                  <input type="color" value={customColors.accent} onChange={(event) => onCustomColorsChange({ ...customColors, accent: event.target.value })} className="h-7 w-8 cursor-pointer border-0 bg-transparent p-0" aria-label="رنگ اصلی سفارشی" />
                  {customColors.accent}
                </span>
              </label>
              <label className="text-[10px] font-bold text-slate-500">
                رنگ دوم
                <span className="mt-1 flex items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-card)] p-1.5 font-mono text-[10px]">
                  <input type="color" value={customColors.secondary} onChange={(event) => onCustomColorsChange({ ...customColors, secondary: event.target.value })} className="h-7 w-8 cursor-pointer border-0 bg-transparent p-0" aria-label="رنگ دوم سفارشی" />
                  {customColors.secondary}
                </span>
              </label>
            </div>
          )}

          <details className="group mt-4 border-t border-[var(--app-border)] pt-3" open>
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg py-1 text-xs font-black">
              <span className="flex items-center gap-2"><Type className="h-4 w-4 text-[var(--accent-text)]" /> تنظیمات کامل رابط</span>
              <span className="text-[10px] text-slate-500 transition-transform group-open:rotate-180">⌄</span>
            </summary>

            <div className="mt-3 space-y-4">
              <label className="block text-[10px] font-black text-slate-500">
                اندازه نوشته — {appearance.fontScale}٪
                <input
                  type="range"
                  min="85"
                  max="120"
                  step="5"
                  value={appearance.fontScale}
                  onChange={(event) => updateAppearance({ fontScale: Number(event.target.value) })}
                  className="mt-2 h-1.5 w-full cursor-pointer accent-[var(--accent)]"
                />
              </label>

              <div>
                <p className="mb-2 text-[10px] font-black text-slate-500">فونت رابط</p>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-[var(--app-subtle)] p-1 min-[360px]:grid-cols-3">
                  {fontOptions.map((option) => (
                    <button key={option.id} type="button" onClick={() => updateAppearance({ fontFamily: option.id })} style={{ fontFamily: option.family }} className={`min-h-14 rounded-lg px-2 py-2 text-[11px] font-bold leading-tight ${appearance.fontFamily === option.id ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "hover:bg-[var(--accent-soft)]"}`} aria-pressed={appearance.fontFamily === option.id} title={option.description}>
                      <span className="block">{option.label}</span><span className="mt-1 block text-[8px] font-normal opacity-70">{option.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="mb-2 text-[10px] font-black text-slate-500">گوشه‌ها</p>
                  <select value={appearance.radius} onChange={(event) => updateAppearance({ radius: event.target.value as AppearanceSettings["radius"] })} className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-card)] px-2 py-2 text-[10px] font-bold">
                    <option value="sharp">تیز</option><option value="soft">نرم</option><option value="round">گرد</option>
                  </select>
                </div>
                <div>
                  <p className="mb-2 text-[10px] font-black text-slate-500">حرکت‌ها</p>
                  <select value={appearance.motion} onChange={(event) => updateAppearance({ motion: event.target.value as AppearanceSettings["motion"] })} className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-card)] px-2 py-2 text-[10px] font-bold">
                    <option value="full">کامل</option><option value="reduced">کاهش‌یافته</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => updateAppearance({ contrast: appearance.contrast === "high" ? "standard" : "high" })} className={`rounded-xl border px-3 py-2 text-[10px] font-black ${appearance.contrast === "high" ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]" : "border-[var(--app-border)]"}`} aria-pressed={appearance.contrast === "high"}>کنتراست بیشتر</button>
                <button type="button" onClick={() => updateAppearance({ customSurfaces: !appearance.customSurfaces })} className={`rounded-xl border px-3 py-2 text-[10px] font-black ${appearance.customSurfaces ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]" : "border-[var(--app-border)]"}`} aria-pressed={appearance.customSurfaces}>رنگ‌بندی سطوح</button>
              </div>

              {appearance.customSurfaces && (
                <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle)] p-3">
                  <p className="mb-2 text-[10px] font-black">رنگ‌های حالت {isDark ? "تیره" : "روشن"}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      [isDark ? "darkBackground" : "lightBackground", "پس‌زمینه"],
                      [isDark ? "darkCard" : "lightCard", "کارت‌ها"],
                      [isDark ? "darkText" : "lightText", "نوشته"],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="text-center text-[9px] font-bold text-slate-500">
                        <input type="color" value={appearance[key]} onChange={(event) => updateAppearance({ [key]: event.target.value })} className="mx-auto mb-1 block h-9 w-full cursor-pointer rounded-lg border border-[var(--app-border)] bg-transparent p-1" aria-label={label} />
                        {label}
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-[9px] leading-relaxed text-slate-500">برای ویرایش رنگ‌های حالت دیگر، ابتدا همان حالت را از بالای پنل انتخاب کنید.</p>
                </div>
              )}

              <button type="button" onClick={onReset} className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] px-3 py-2 text-[10px] font-black text-slate-500 transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)]">
                <RotateCcw className="h-3.5 w-3.5" /> بازنشانی همه تنظیمات
              </button>
            </div>
          </details>
        </section>
        </>
      )}
    </div>
  );
}
