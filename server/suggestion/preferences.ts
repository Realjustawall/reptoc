export type PreferenceNovel = {
  novelId: string;
  genre?: string | null;
  authorId?: string | null;
};

export type ReadingPreferenceSignal = {
  novelId: string;
  scrollPercentage?: number | null;
  completed?: boolean | null;
};

export type BookmarkPreferenceSignal = {
  novelId: string;
  shelfStatus?: string | null;
};

export type FollowPreferenceSignal = {
  targetType: "user" | "novel" | string;
  targetId: string;
};

function addScore(target: Record<string, number>, key: unknown, score: number) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey || !Number.isFinite(score) || score <= 0) return;
  target[normalizedKey] = (target[normalizedKey] || 0) + score;
}

function normalizeScores(scores: Record<string, number>) {
  const maximum = Math.max(0, ...Object.values(scores));
  if (maximum === 0) return {};
  return Object.fromEntries(
    Object.entries(scores).map(([key, value]) => [key, Number((value / maximum).toFixed(4))])
  );
}

/**
 * Turns durable, explicit product signals into bounded recommendation affinity.
 * These signals are intentionally stronger than passive impressions: adding a
 * story to the library or following an author is a clear statement of taste.
 */
export function buildExplicitPreferenceSignals(input: {
  novels: PreferenceNovel[];
  reading: ReadingPreferenceSignal[];
  bookmarks: BookmarkPreferenceSignal[];
  follows: FollowPreferenceSignal[];
}) {
  const metadata = new Map(input.novels.map((novel) => [novel.novelId, novel]));
  const genreScores: Record<string, number> = {};
  const authorScores: Record<string, number> = {};
  const activeUnfinishedNovels = new Set<string>();
  const seenNovels = new Set<string>();

  const applyNovelScore = (novelId: string, score: number) => {
    const novel = metadata.get(novelId);
    if (!novel) return;
    addScore(genreScores, novel.genre, score);
    addScore(authorScores, novel.authorId, score);
  };

  for (const progress of input.reading) {
    const novelId = String(progress.novelId || "").trim();
    if (!novelId) continue;
    const scroll = Math.max(0, Math.min(100, Number(progress.scrollPercentage || 0)));
    seenNovels.add(novelId);
    if (!progress.completed && scroll > 0 && scroll < 90) activeUnfinishedNovels.add(novelId);
    applyNovelScore(novelId, 0.25 + (scroll / 100) * 0.75 + (progress.completed ? 0.35 : 0));
  }

  for (const bookmark of input.bookmarks) {
    const novelId = String(bookmark.novelId || "").trim();
    if (!novelId) continue;
    seenNovels.add(novelId);
    const shelfWeight = bookmark.shelfStatus === "dropped" ? 0 : bookmark.shelfStatus === "completed" ? 1.25 : 1.1;
    applyNovelScore(novelId, shelfWeight);
  }

  for (const follow of input.follows) {
    if (follow.targetType === "user") addScore(authorScores, follow.targetId, 1.5);
    if (follow.targetType === "novel") {
      seenNovels.add(follow.targetId);
      applyNovelScore(follow.targetId, 1.4);
    }
  }

  return {
    genreAffinity: normalizeScores(genreScores),
    authorAffinity: normalizeScores(authorScores),
    activeUnfinishedNovels,
    seenNovels,
  };
}

export function mergeAffinityMaps(...maps: Array<Record<string, number> | null | undefined>) {
  const merged: Record<string, number> = {};
  for (const map of maps) {
    for (const [key, rawValue] of Object.entries(map || {})) {
      const value = Number(rawValue);
      if (!key || !Number.isFinite(value)) continue;
      merged[key] = Math.max(merged[key] || 0, Math.max(0, Math.min(1, value)));
    }
  }
  return merged;
}
