import type { PremiumPalette } from "../../shared/premiumTemplates";

function toHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(red: number, green: number, blue: number) {
  const channels = [red, green, blue].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function accessiblePaletteFromPixels(pixels: Uint8ClampedArray, fallback: PremiumPalette): PremiumPalette {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  let accent = { red: 0, green: 0, blue: 0, saturation: -1 };
  for (let index = 0; index < pixels.length; index += 16) {
    if (pixels[index + 3] < 180) continue;
    const [r, g, b] = [pixels[index], pixels[index + 1], pixels[index + 2]];
    red += r; green += g; blue += b; count += 1;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    if (saturation > accent.saturation && luminance(r, g, b) > 0.08) accent = { red: r, green: g, blue: b, saturation };
  }
  if (!count) return fallback;
  const average = { red: red / count, green: green / count, blue: blue / count };
  const darken = luminance(average.red, average.green, average.blue) > 0.2 ? 0.28 : 0.7;
  return {
    primary: toHex(average.red * darken, average.green * darken, average.blue * darken),
    secondary: toHex(average.red * darken + 24, average.green * darken + 18, average.blue * darken + 34),
    accent: accent.saturation >= 0 ? toHex(Math.max(96, accent.red), Math.max(96, accent.green), Math.max(96, accent.blue)) : fallback.accent,
  };
}

export async function extractAccessibleCoverPalette(source: string, fallback: PremiumPalette): Promise<PremiumPalette> {
  if (!source || source.startsWith("blob:")) return fallback;
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 40; canvas.height = 40;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return resolve(fallback);
        context.drawImage(image, 0, 0, 40, 40);
        resolve(accessiblePaletteFromPixels(context.getImageData(0, 0, 40, 40).data, fallback));
      } catch {
        resolve(fallback);
      }
    };
    image.onerror = () => resolve(fallback);
    image.src = source;
  });
}
