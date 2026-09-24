export const AUGUST_VIEWS_EVENT = {
  id: "august-views-2026",
  title: "رویداد بازدیدهای اوت رپتوک ۲۰۲۶",
  startsAt: "2026-08-01T00:00:00.000Z",
  endsAt: "2026-09-01T00:00:00.000Z",
  dateLabel: "۱ تا ۳۱ اوت ۲۰۲۶",
  timezoneLabel: "UTC",
  excludedAuthorNames: ["The_BestX", "The_Lite", "Abyss kid"] as const,
} as const;

export type AugustViewsEventPhase = "upcoming" | "active" | "completed";

export function getAugustViewsEventPhase(now: Date | string | number = Date.now()): AugustViewsEventPhase {
  const timestamp = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const startsAt = Date.parse(AUGUST_VIEWS_EVENT.startsAt);
  const endsAt = Date.parse(AUGUST_VIEWS_EVENT.endsAt);
  if (!Number.isFinite(timestamp) || timestamp < startsAt) return "upcoming";
  if (timestamp >= endsAt) return "completed";
  return "active";
}

export function normalizeAugustViewsAuthorName(value: unknown): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const EXCLUDED_AUTHOR_NAMES = new Set(
  AUGUST_VIEWS_EVENT.excludedAuthorNames.map(normalizeAugustViewsAuthorName),
);

export function isAugustViewsAuthorExcluded(...names: unknown[]): boolean {
  return names.some((name) => EXCLUDED_AUTHOR_NAMES.has(normalizeAugustViewsAuthorName(name)));
}

export interface AugustViewsEventRanking {
  rank: number;
  novelId: string;
  title: string;
  coverUrl: string;
  author: string;
  authorUsername: string;
  eventViews: number;
}

export interface AugustViewsEventResponse {
  event: typeof AUGUST_VIEWS_EVENT & {
    phase: AugustViewsEventPhase;
    leaderboardEnabled: boolean;
    serverTime: string;
  };
  stats: {
    eligibleNovels: number;
    rankedNovels: number;
    eligibleViews: number;
  };
  topThree: AugustViewsEventRanking[];
  rankings: AugustViewsEventRanking[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
