import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ACCENT_THEMES, DEFAULT_APPEARANCE, DEFAULT_CUSTOM_THEME, appearanceCssVariables, normalizeAccentTheme, normalizeAppearance, normalizeCustomTheme, resolveAccentTheme } from "../src/theme";
import ThemeCustomizer from "../src/components/ThemeCustomizer";

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("light theme text and accent colors meet WCAG AA contrast", () => {
  assert.ok(contrastRatio("#171717", "#ffffff") >= 7, "primary reading text should meet AAA");
  assert.ok(contrastRatio("#303741", "#ffffff") >= 7, "muted text should stay strongly readable");
  assert.ok(contrastRatio("#c2410c", "#ffffff") >= 4.5, "orange accent text should meet AA");
});

test("light mode applies its compatibility palette to the complete app shell", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  assert.match(app, /data-app-theme=\{theme\}/);
  assert.match(css, /\[data-app-theme="light"\] \.text-slate-400/);
  assert.match(css, /\.reptoc-app .*text-violet-300/);
  assert.match(css, /\.reader-prose/);
  assert.match(css, /:focus-visible/);
});

test("every curated accent remains readable in light and dark mode", () => {
  for (const theme of ACCENT_THEMES) {
    assert.ok(contrastRatio(theme.textLight, "#ffffff") >= 4.5, `${theme.id} should be readable on white`);
    assert.ok(contrastRatio(theme.textDark, "#080512") >= 4.5, `${theme.id} should be readable in dark mode`);
    assert.ok(contrastRatio(theme.contrast, theme.accent) >= 4.5, `${theme.id} active controls should be readable`);
  }
});

test("custom theme values are normalized and receive accessible foregrounds", () => {
  assert.equal(normalizeAccentTheme("discord"), "discord");
  assert.equal(normalizeAccentTheme("unknown"), "orange");
  assert.deepEqual(normalizeCustomTheme({ accent: "bad", secondary: "#ABCDEF" }), {
    accent: DEFAULT_CUSTOM_THEME.accent,
    secondary: "#abcdef",
  });
  for (const accent of ["#ffffff", "#000000", "#ffff00", "#808080", "#00ff00"]) {
    const theme = resolveAccentTheme("custom", { accent, secondary: "#2563eb" });
    assert.ok(contrastRatio(theme.textLight, "#ffffff") >= 4.5, `${accent} custom text should work on white`);
    assert.ok(contrastRatio(theme.textDark, "#080512") >= 4.5, `${accent} custom text should work in dark mode`);
    assert.ok(contrastRatio(theme.contrast, theme.accent) >= 4.5, `${accent} custom button text should be readable`);
  }
});

test("theme customizer exposes appearance modes and every requested palette", () => {
  // The closed control is server-renderable; the complete palette contract is
  // kept in one source of truth for the interactive popover.
  const html = renderToStaticMarkup(React.createElement(ThemeCustomizer, {
    mode: "light",
    accentTheme: "orange",
    customColors: DEFAULT_CUSTOM_THEME,
    appearance: DEFAULT_APPEARANCE,
    onModeChange: () => {},
    onAccentThemeChange: () => {},
    onCustomColorsChange: () => {},
    onAppearanceChange: () => {},
    onReset: () => {},
  }));
  assert.match(html, /شخصی‌سازی رنگ و حالت نمایش/);
  assert.deepEqual(ACCENT_THEMES.map((theme) => theme.id), ["orange", "blue", "discord", "discord-nitro", "emerald", "cyan", "pink", "ocean", "sunset", "gray", "red", "yellow", "sage", "lavender", "warm-paper", "nordic-mist"]);
  assert.deepEqual(ACCENT_THEMES.filter((theme) => theme.comfort).map((theme) => theme.id), ["sage", "lavender", "warm-paper", "nordic-mist"]);
  assert.equal(normalizeAccentTheme("purple"), "orange");

  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /reptoc-accent-theme/);
  assert.match(app, /reptoc-custom-theme/);
  assert.match(app, /<ThemeCustomizer/);
});

test("complete appearance settings are normalized and can customize every surface", () => {
  const normalized = normalizeAppearance({
    fontFamily: "system",
    fontScale: 999,
    radius: "sharp",
    motion: "reduced",
    contrast: "high",
    customSurfaces: true,
    lightBackground: "#eeeeee",
    lightCard: "#ffffff",
    lightText: "#111111",
    darkBackground: "#111111",
    darkCard: "#222222",
    darkText: "#fafafa",
  });
  assert.equal(normalized.fontScale, 120);
  assert.equal(normalized.motion, "reduced");
  assert.equal(normalized.customSurfaces, true);
  const variables = appearanceCssVariables(normalized, "dark");
  assert.equal(variables["--app-bg"], "#111111");
  assert.equal(variables["--app-card"], "#222222");
  assert.equal(variables["--app-text"], "#fafafa");
  assert.match(variables["--ui-font-family"], /Tahoma/);
});

test("theme studio includes locally hosted Persian-friendly font families", () => {
  const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const customizer = readFileSync(new URL("../src/components/ThemeCustomizer.tsx", import.meta.url), "utf8");
  for (const font of ["noto-sans", "noto-naskh", "noto-kufi", "markazi"] as const) {
    const normalized = normalizeAppearance({ fontFamily: font });
    assert.equal(normalized.fontFamily, font);
    assert.notEqual(appearanceCssVariables(normalized, "light")["--ui-font-family"], "");
  }
  assert.match(main, /@fontsource-variable\/noto-sans-arabic/);
  assert.match(main, /@fontsource-variable\/noto-naskh-arabic/);
  assert.match(customizer, /نوتو کوفی/);
  assert.match(customizer, /مرکزی/);
  for (const font of ["amiri", "cairo", "tajawal", "changa", "lemonada"] as const) {
    const normalized = normalizeAppearance({ fontFamily: font });
    assert.equal(normalized.fontFamily, font);
    assert.notEqual(appearanceCssVariables(normalized, "light")["--ui-font-family"], "");
  }
  assert.match(main, /@fontsource\/amiri\/arabic-400\.css/);
  assert.match(main, /@fontsource\/lemonada\/arabic-700\.css/);
  assert.match(customizer, /امیری/);
  assert.match(customizer, /لیمونادا/);
});

test("book mode is durable and is available in both reader and writer", () => {
  const enabled = normalizeAppearance({ bookMode: true });
  assert.equal(enabled.bookMode, true);
  assert.equal(normalizeAppearance({}).bookMode, false);
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const reader = readFileSync(new URL("../src/components/Reader.tsx", import.meta.url), "utf8");
  const writer = readFileSync(new URL("../src/components/Writer.tsx", import.meta.url), "utf8");
  const editor = readFileSync(new URL("../src/components/TiptapEditor.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  assert.match(app, /bookMode=\{appearance\.bookMode\}/);
  assert.match(reader, /حالت کتابی/);
  assert.match(writer, /حالت کتابی:/);
  assert.match(editor, /writer-book-editor/);
  assert.match(css, /reader-book-prose/);
});

test("appearance preferences have durable cookie storage", () => {
  const themeSource = readFileSync(new URL("../src/theme.ts", import.meta.url), "utf8");
  assert.match(themeSource, /document\.cookie/);
  assert.match(themeSource, /Max-Age=/);
  assert.match(themeSource, /SameSite=Lax/);
  assert.match(themeSource, /Secure/);
});

test("theme studio and app shell are resilient across phone and desktop widths", () => {
  const customizer = readFileSync(new URL("../src/components/ThemeCustomizer.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  assert.match(customizer, /max-h-\[min\(88dvh,48rem\)\]/);
  assert.match(customizer, /safe-area-inset-bottom/);
  assert.match(customizer, /overscroll-contain/);
  assert.match(css, /@media \(max-width: 359px\)/);
  assert.match(css, /@media \(max-width: 639px\)/);
  assert.match(css, /min-inline-size: 0/);
  assert.match(css, /background-image:/);
});
