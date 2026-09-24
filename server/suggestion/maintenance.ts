import { db, supabase } from "@/server/postgres";
import { sanitizeTaxonomyList } from "@/server/utils/taxonomyFilters";
import { cache } from "@/server/utils/cache";

export async function invalidateSuggestionPreferences(userId: string) {
  if (!userId) return;
  await Promise.all([
    cache.clearPrefix(`recommend:${userId}:`),
    cache.clearPrefix(`profile_full:${userId}`),
    cache.clearPrefix(`candidates:${userId}:`),
  ]);
}

type NovelVectorInput = {
  id: string;
  authorId?: string | null;
  genre?: string | null;
  description?: string | null;
  viewsCount?: number;
  bookmarksCount?: number;
  reviewsCount?: number;
  likesCount?: number;
  tags?: any;
  warnings?: any;
  mainCategories?: any;
  subCategories?: any;
  chapters?: Array<{ content?: string; wordCount?: number }>;
};

const EVENT_STAT_COLUMNS: Record<string, string[]> = {
  impression: ["impressions"],
  click: ["clicks"],
  view: ["views"],
  read: ["views"],
  chapter_start: ["views"],
  chapter_complete: ["ch1_complete"],
  favorite: ["follows"],
  follow: ["follows"],
  comment: ["comments"],
  share: ["shares"],
  library_add: ["library_adds", "bookmarks"],
  bookmark: ["bookmarks"],
  fast_exit: ["fast_exits"],
  hide: ["hides"],
  not_interested: ["hides"],
  report: ["reports"],
  unfollow: ["unfollows"]
};

function asArray(value: any): string[] {
  if (Array.isArray(value)) return sanitizeTaxonomyList(value.map(String).filter(Boolean));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return sanitizeTaxonomyList(parsed.map(String).filter(Boolean));
    } catch {}
    return sanitizeTaxonomyList(value.split(",").map((item) => item.trim()).filter(Boolean));
  }
  return [];
}

function addFeature(vector: Record<string, number>, key: string, weight: number) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized) return;
  vector[normalized] = (vector[normalized] || 0) + weight;
}

function normalizeVector(vector: Record<string, number>) {
  const norm = Math.sqrt(Object.values(vector).reduce((sum, value) => sum + value * value, 0));
  if (!norm) return {};
  return Object.fromEntries(Object.entries(vector).map(([key, value]) => [key, Number((value / norm).toFixed(6))]));
}

/**
 * ✅ FIX B-10: Expanded theme list with Persian/Arabic keywords so that
 * Persian-language novels get meaningful vectors. Previously only 16
 * English themes were checked, which produced empty vectors for Persian
 * descriptions and made recommendations for Persian users essentially
 * random.
 */
const THEME_KEYWORDS: Record<string, string[]> = {
  romance: ["romance", "love", "عشق", "عاشقانه", "دلباختگی", "رمان عاشقانه"],
  system: ["system", "rpg", "سیستم", "سامانه", "بازیگر"],
  magic: ["magic", "wizard", "mage", "ماگ", "جادو", "جادوگر", "ساحر"],
  academy: ["academy", "school", "آکادمی", "مدرسه", "دانشگاه", "آموزشگاه"],
  revenge: ["revenge", "vengeance", "انتقام", "کینه"],
  survival: ["survival", "بقا", "زنده ماندن", "نجات"],
  kingdom: ["kingdom", "empire", "پادشاهی", "امپراتوری", "سلطنت", "پادشاه"],
  monster: ["monster", "beast", "هیولا", "وحش", "دیو"],
  dungeon: ["dungeon", "دانجن", "سیاه‌چال", "زیرزمین"],
  cultivation: ["cultivation", "martial", "ki", "qi", "تمرین", "رشد", "هنر رزمی"],
  mystery: ["mystery", "detective", "راز", "معما", "کارآگاه", "اسرار"],
  horror: ["horror", "scary", "ترسناک", "وحشت", "ددی", "فیلم ترسناک"],
  comedy: ["comedy", "funny", "خنده‌دار", "طنز", "کمدی", "شوخ‌طبع"],
  space: ["space", "galaxy", "cosmos", "فضا", "کهکشان", "کیهان", "ستاره"],
  game: ["game", "gamer", "بازی", "گیمر", "گیمینگ", "ورزشی"],
  villain: ["villain", "antagonist", "شرور", "آنتاگونیست", "تبهکار"],
  action: ["action", "fight", "اکشن", "نبرد", "مبارزه", "جنگ"],
  adventure: ["adventure", "exploration", "ماجراجویی", "کاوش", "سفر"],
  scifi: ["sci-fi", "scifi", "science fiction", "علمی-تخیلی", "تخیلی"],
  fantasy: ["fantasy", "فانتزی", "افسانه", "افسون"],
  thriller: ["thriller", "هیجان‌انگیز", "تعلیق"],
  historical: ["historical", "history", "تاریخی", "تاریخ"],
  reincarnation: ["reincarnation", "reborn", "تناسخ", "بازگشت", "متولد شدن"],
  time_travel: ["time travel", "time-travel", "سفر در زمان", "زمان‌سفر"],
};

function buildNovelVector(input: NovelVectorInput) {
  const vector: Record<string, number> = {};
  addFeature(vector, `genre_${input.genre || "unknown"}`, 1.4);
  asArray(input.mainCategories).forEach((item) => addFeature(vector, `main_${item}`, 1.2));
  asArray(input.subCategories).forEach((item) => addFeature(vector, `sub_${item}`, 1.0));
  asArray(input.tags).forEach((item) => addFeature(vector, `tag_${item}`, 0.85));
  asArray(input.warnings).forEach((item) => addFeature(vector, `warning_${item}`, -0.35));
  if (input.authorId) addFeature(vector, `author_${input.authorId}`, 0.45);

  const text = String(input.description || "").toLowerCase();
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    // ✅ FIX B-10: Check each keyword with word-boundary regex to avoid
    // false matches like "romance" in "neuroscience".
    for (const kw of keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(^|[^\\w])${escaped}([^\\w]|$)`, "i");
      if (re.test(text)) {
        addFeature(vector, `theme_${theme}`, 0.55);
        break; // Only add once per theme
      }
    }
  }

  return normalizeVector(vector);
}

async function loadChapterStats(novelId: string, suppliedChapters?: NovelVectorInput["chapters"]) {
  if (suppliedChapters && suppliedChapters.length > 0) {
    const words = suppliedChapters.map((chapter) => Number(chapter.wordCount || 0) || String(chapter.content || "").replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length);
    return {
      chapterCount: words.length,
      avgChapterLength: Math.round(words.reduce((sum, value) => sum + value, 0) / Math.max(words.length, 1))
    };
  }

  const { data } = await supabase.from("chapters").select("word_count").eq("novel_id", novelId);
  const words = (data || []).map((chapter: any) => Number(chapter.word_count || 0));
  return {
    chapterCount: words.length,
    avgChapterLength: Math.round(words.reduce((sum, value) => sum + value, 0) / Math.max(words.length, 1)) || 1500
  };
}

export async function syncSuggestionNovelArtifacts(input: NovelVectorInput) {
  const chapterStats = await loadChapterStats(input.id, input.chapters);
  const vector = buildNovelVector(input);

  await Promise.all([
    supabase.from("suggestion_novel_vectors").upsert({
      novel_id: input.id,
      vector,
      genre: input.genre || "Uncategorized",
      author_id: input.authorId || null,
      avg_chapter_length: chapterStats.avgChapterLength || 1500,
      created_at: new Date().toISOString()
    }, { onConflict: "novel_id" }),
    supabase.from("suggestion_novel_stats").upsert({
      novel_id: input.id,
      views: Number(input.viewsCount || 0),
      bookmarks: Number(input.bookmarksCount || 0),
      comments: Number(input.reviewsCount || 0),
      likes: Number(input.likesCount || 0),
      updated_at: new Date().toISOString()
    }, { onConflict: "novel_id" })
  ]);
}

export async function syncSuggestionNovelArtifactsFromDb(novelId: string) {
  const { data: novel } = await supabase
    .from("novels")
    .select("id, author_id, genre, description, tags, warnings, main_categories, sub_categories, views_count, bookmarks_count, reviews_count, likes_count")
    .eq("id", novelId)
    .single();
  if (!novel) return;

  await syncSuggestionNovelArtifacts({
    id: novel.id,
    authorId: novel.author_id,
    genre: novel.genre,
    description: novel.description,
    viewsCount: novel.views_count,
    bookmarksCount: novel.bookmarks_count,
    reviewsCount: novel.reviews_count,
    likesCount: novel.likes_count,
    tags: novel.tags,
    warnings: novel.warnings,
    mainCategories: novel.main_categories,
    subCategories: novel.sub_categories
  });
}

export async function deleteSuggestionNovelArtifacts(novelId: string) {
  if (!novelId) return;
  await Promise.allSettled([
    supabase.from("suggestion_novel_vectors").delete().eq("novel_id", novelId),
    supabase.from("suggestion_novel_stats").delete().eq("novel_id", novelId),
    supabase.from("suggestion_user_events").delete().eq("novel_id", novelId)
  ]);
  try {
    await db.query("DELETE FROM suggestion_recommendation_logs WHERE items @> $1::jsonb", [
      JSON.stringify([{ novel_id: novelId }])
    ]);
  } catch {}
}

export async function backfillSuggestionArtifacts(limit = 200) {
  const { data: novels } = await supabase
    .from("novels")
    .select("id")
    .eq("approval_status", "approved")
    .limit(limit);

  for (const novel of novels || []) {
    await syncSuggestionNovelArtifactsFromDb(novel.id).catch((error) => {
      console.warn("Suggestion backfill skipped novel", novel.id, error);
    });
  }
  return novels?.length || 0;
}

/**
 * ✅ FIX SG-2: Engagement counters must be reset periodically. Without
 * this, engagement_24h grows forever and the GrowthBoost computation
 * becomes meaningless. This function resets 24h counters daily and 7d
 * counters weekly. Call it from a cron job (see install.sh which sets up
 * a crontab entry).
 */
export async function resetEngagementCounters() {
  try {
    // Reset 24h counter (called daily at 00:00 UTC by cron)
    await db.query(`UPDATE suggestion_novel_stats SET engagement_24h = 0 WHERE engagement_24h > 0`);
    console.log("[suggestion] Reset engagement_24h counters");
  } catch (err) {
    console.warn("[suggestion] Failed to reset engagement_24h:", err);
  }
}

export async function resetWeeklyEngagementCounters() {
  try {
    // Reset 7d counter (called weekly on Sunday 00:00 UTC by cron)
    await db.query(`UPDATE suggestion_novel_stats SET engagement_7d = 0 WHERE engagement_7d > 0`);
    console.log("[suggestion] Reset engagement_7d counters");
  } catch (err) {
    console.warn("[suggestion] Failed to reset engagement_7d:", err);
  }
}

export async function recordSuggestionStatsEvent(novelId: string, event: string, chapter = 0) {
  if (!novelId) return;
  const columns = new Set(EVENT_STAT_COLUMNS[event] || []);
  if (event === "chapter_complete") {
    if (chapter >= 5) columns.add("ch5_complete");
    if (chapter >= 10) columns.add("ch10_complete");
  }
  if (columns.size === 0) return;

  await supabase.from("suggestion_novel_stats").upsert({
    novel_id: novelId,
    updated_at: new Date().toISOString()
  }, { onConflict: "novel_id" });

  const { data: current } = await supabase.from("suggestion_novel_stats").select("*").eq("novel_id", novelId).single();
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  columns.forEach((column) => {
    updates[column] = Number(current?.[column] || 0) + 1;
  });
  updates.engagement_24h = Number(current?.engagement_24h || 0) + 1;
  updates.engagement_7d = Number(current?.engagement_7d || 0) + 1;

  const impressions = columnValue(updates, current, "impressions");
  const clicks = columnValue(updates, current, "clicks");
  const ch1 = columnValue(updates, current, "ch1_complete");
  const ch5 = columnValue(updates, current, "ch5_complete");
  const ch10 = columnValue(updates, current, "ch10_complete");
  updates.ctr_global = impressions > 0 ? Number((clicks / impressions).toFixed(4)) : Number(current?.ctr_global || 0.05);
  updates.r5_global = ch1 > 0 ? Number((ch5 / ch1).toFixed(4)) : Number(current?.r5_global || 0.2);
  updates.r10_global = ch1 > 0 ? Number((ch10 / ch1).toFixed(4)) : Number(current?.r10_global || 0.1);

  await supabase.from("suggestion_novel_stats").update(updates).eq("novel_id", novelId);
}

function columnValue(updates: Record<string, any>, current: any, column: string) {
  return Number(updates[column] ?? current?.[column] ?? 0);
}
