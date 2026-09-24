export const READING_MUSIC_TRACKS = [
  { id: "quiet-rain", name: "باران آرام", description: "صدای باران ملایم و فیلترشده همراه با تُنی گرم و دور." },
  { id: "moonlit-library", name: "کتابخانه مهتابی", description: "فضاسازی شبانه‌ای کند و بی‌آزار." },
  { id: "forest-lanterns", name: "فانوس‌های جنگل", description: "هوای ملایم جنگلی با رنگ‌های هارمونیک کم‌شمار." },
  { id: "deep-space", name: "اعماق فضا", description: "سُرشی کم‌فرکانس و آینده‌نگر برای داستان‌های گمانه‌زن." },
  { id: "rose-window", name: "پنجره گل‌سرشت", description: "بستر امبینت سبک و گرم برای فصل‌های تأملی." },
] as const;

export type ReadingMusicTrackId = typeof READING_MUSIC_TRACKS[number]["id"];

export function isReadingMusicTrackId(value: unknown): value is ReadingMusicTrackId {
  return READING_MUSIC_TRACKS.some((track) => track.id === value);
}
