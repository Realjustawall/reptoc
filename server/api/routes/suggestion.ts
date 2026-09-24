import { Router } from "express";
import { NovaXRanker } from '../../suggestion/NovaXRanker';
import { Context } from '../../suggestion/types';
import { cache } from '@/server/utils/cache';
import { getActiveUser } from '../../utils/auth';
import { isChapterVisibleToUser } from '../../utils/chapters';
import { sanitizeTaxonomyList } from '../../utils/taxonomyFilters';
import { z } from 'zod';
import { invalidateSuggestionPreferences } from '../../suggestion/maintenance';

const router = Router();
const ranker = new NovaXRanker();

// ✅ SECURITY: Validate user IDs before they reach the database layer.
// Anonymous IDs must follow a strict format: `anon-` + 32 hex chars.
// Authenticated user IDs are UUIDs (or `u-<uuid>` for password users, or
// `u-<timestamp>-<digits>` for legacy Google OAuth users).
const ANON_ID_PATTERN = /^anon-[a-f0-9]{32}$/i;
const AUTHENTICATED_USER_ID_PATTERN = /^(u-[a-f0-9-]{8,80}|admin-master-[a-f0-9-]{8,80}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

function isValidUserId(value: unknown, allowAnon: boolean): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 120) return false;
  if (allowAnon && ANON_ID_PATTERN.test(value)) return true;
  return AUTHENTICATED_USER_ID_PATTERN.test(value);
}

// ✅ SECURITY: Validate novelId format. UUIDs, `seed-novel-N`, or `chap-...`.
const NOVEL_ID_PATTERN = /^(seed-novel-\d+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-zA-Z0-9_-]{1,100})$/i;
function isValidNovelId(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return false;
  return NOVEL_ID_PATTERN.test(value);
}

function normalizeFacet(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGenreFilter(value: unknown) {
  const normalized = normalizeFacet(value);
  const raw = String(value || "").trim().toLowerCase();
  return normalized === "all genres" || normalized === "all" || raw === "همه ژانرها" || raw === "همه" ? "" : normalized;
}

function novelMatchesGenre(novel: any, genre: string) {
  const target = normalizeGenreFilter(genre);
  if (!target) return true;
  const values = [
    novel.genre,
    ...sanitizeTaxonomyList(Array.isArray(novel.main_categories) ? novel.main_categories : [])
  ];
  return values.some((value) => normalizeFacet(value) === target);
}

function buildPublicIdentity(profile: any = {}, fallback: any = {}) {
  const username = String(profile.username || fallback.username || "").trim();
  const nickname = String(profile.nickname || fallback.nickname || fallback.displayName || "").trim();
  return {
    userId: profile.id || fallback.user_id || fallback.userId || null,
    username,
    displayName: nickname || username || "خواننده",
    avatar: String(profile.avatar || fallback.avatar || "").trim(),
    role: String(profile.role || fallback.role || "reader").trim()
  };
}

async function loadPublicUsers(column: "id" | "username", values: string[]) {
  const cleanValues = Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
  if (cleanValues.length === 0) return [];
  const { supabase } = await import('../../postgres');
  const primary = await supabase.from('users').select('id, username, nickname, avatar, role').in(column, cleanValues);
  if (!primary.error && Array.isArray(primary.data)) return primary.data;
  const fallback = await supabase.from('users').select('id, username').in(column, cleanValues);
  return !fallback.error && Array.isArray(fallback.data) ? fallback.data : [];
}

function mapReviewToFeed(review: any, identity: any) {
  return {
    id: review.id,
    userId: identity.userId || review.user_id || null,
    username: identity.username || review.username,
    displayName: identity.displayName || review.username || "خواننده",
    avatar: identity.avatar || "",
    role: identity.role || "reader",
    rating: review.rating,
    ratingOverall: review.rating_overall || review.rating,
    ratingStyle: review.rating_style || review.rating,
    ratingStory: review.rating_story || review.rating,
    ratingGrammar: review.rating_grammar || review.rating,
    ratingCharacter: review.rating_character || review.rating,
    comment: review.content || "",
    createdAt: review.created_at || new Date().toISOString()
  };
}

async function hydrateRecommendedNovels(recommendations: any[], genre = "") {
  const ids = recommendations.map((item: any) => item.id).filter(Boolean);
  if (ids.length === 0) return [];
  const { supabase } = await import('../../postgres');
  const { data } = await supabase.from('novels').select('*').in('id', ids);
  const visibleNovels = data || [];
  const authorIds = visibleNovels.map((novel: any) => String(novel.author_id || "")).filter(Boolean);
  const [authorsById, reviewsResult, chaptersResult] = await Promise.all([
    loadPublicUsers("id", authorIds),
    supabase
      .from('reviews')
      .select('id, novel_id, user_id, username, rating, rating_overall, rating_style, rating_story, rating_grammar, rating_character, content, created_at')
      .in('novel_id', ids)
      .order('created_at', { ascending: false }),
    supabase
      .from('chapters')
      .select('id, novel_id, title, content, author_notes_top, author_notes_bottom, status, scheduled_at, published_at, chapter_number, word_count, views_count, order_index, created_at, updated_at')
      .in('novel_id', ids)
      .order('order_index', { ascending: true })
  ]);
  const authorById = new Map(authorsById.map((profile: any) => [String(profile.id), buildPublicIdentity(profile, profile)]));
  const reviewUsersById = new Map((await loadPublicUsers("id", (reviewsResult.data || []).map((review: any) => String(review.user_id || "")).filter(Boolean))).map((profile: any) => [String(profile.id), profile]));
  const reviewsByNovel = new Map<string, any[]>();
  (reviewsResult.data || []).forEach((review: any) => {
    const profile = reviewUsersById.get(String(review.user_id || "")) || {};
    const mapped = mapReviewToFeed(review, buildPublicIdentity(profile, review));
    const list = reviewsByNovel.get(review.novel_id) || [];
    if (mapped.comment) list.push(mapped);
    reviewsByNovel.set(review.novel_id, list);
  });
  const chaptersByNovel = new Map<string, any[]>();
  (chaptersResult.data || [])
    .filter((chapter: any) => isChapterVisibleToUser(chapter, false))
    .forEach((chapter: any) => {
      const list = chaptersByNovel.get(chapter.novel_id) || [];
      list.push({
        id: chapter.id,
        novelId: chapter.novel_id,
        title: chapter.title,
        content: chapter.content || "",
        chapterNumber: chapter.chapter_number || ((chapter.order_index || 0) + 1),
        createdAt: chapter.created_at,
        updatedAt: chapter.updated_at || chapter.published_at || chapter.created_at,
        wordCount: chapter.word_count || 0,
        authorNotesTop: chapter.author_notes_top || "",
        authorNotesBottom: chapter.author_notes_bottom || "",
        status: chapter.status || "Published",
        scheduledAt: chapter.scheduled_at || undefined,
        publishedAt: chapter.published_at || undefined,
        viewsCount: chapter.views_count || 0
      });
      chaptersByNovel.set(chapter.novel_id, list);
    });
  const byId = new Map((data || []).map((novel: any) => [novel.id, novel]));
  const recommendationById = new Map(recommendations.map((item: any) => [String(item.id), item]));
  return ids.map((id: string) => {
    const novel: any = byId.get(id);
    if (!novel || !novelMatchesGenre(novel, genre)) return null;
    if (novel.approval_status && novel.approval_status !== 'approved') return null;
    const recommendation: any = recommendationById.get(String(id)) || {};
    const recommendationSources = Array.isArray(recommendation.sources) ? recommendation.sources : [];
    const recommendationReason = recommendationSources.includes('continue_reading')
      ? 'ادامهٔ داستانی که خوانده‌اید'
      : recommendationSources.includes('personalized_author')
        ? 'بر اساس نویسنده‌های دنبال‌شدهٔ شما'
        : recommendationSources.includes('personalized_genre')
          ? 'هماهنگ با ژانرهای موردعلاقهٔ شما'
          : recommendationSources.includes('fresh')
            ? 'یک داستان تازه برای کشف'
            : recommendationSources.includes('trending')
              ? 'محبوب میان خوانندگان رپتوک'
              : 'پیشنهاد منتخب رپتوک';
    const authorIdentity = authorById.get(String(novel.author_id || ""))
      || buildPublicIdentity({}, { username: novel.author, user_id: novel.author_id });
    return {
      id: novel.id,
      title: novel.title,
      author: novel.author || authorIdentity.username,
      author_id: novel.author_id,
      authorUsername: authorIdentity.username || novel.author,
      authorAvatar: authorIdentity.avatar || "",
      authorDisplayName: novel.author || authorIdentity.displayName,
      cover: novel.cover_url,
      coverUrl: novel.cover_url,
      description: novel.description,
      rating: Number(novel.reviews_count || 0) > 0 ? Number(novel.rating || 0) : 0,
      status: novel.status,
      approvalStatus: novel.approval_status || 'approved',
      genre: novel.genre,
      createdAt: novel.created_at,
      updatedAt: novel.updated_at || novel.created_at,
      reviewsCount: novel.reviews_count || 0,
      wordsCount: novel.words_count || 0,
      viewsCount: novel.views_count || 0,
      bookmarksCount: novel.bookmarks_count || 0,
      isCompleted: novel.is_completed === 1 || novel.is_completed === true,
      tags: sanitizeTaxonomyList(Array.isArray(novel.tags) ? novel.tags : []),
      mainCategories: sanitizeTaxonomyList(Array.isArray(novel.main_categories) ? novel.main_categories : []),
      subCategories: sanitizeTaxonomyList(Array.isArray(novel.sub_categories) ? novel.sub_categories : []),
      warnings: sanitizeTaxonomyList(Array.isArray(novel.warnings) ? novel.warnings : []),
      ageRating: novel.age_rating || "PG-13",
      recommendationSources,
      recommendationReason,
      chapters: chaptersByNovel.get(novel.id) || [],
      reviews: reviewsByNovel.get(novel.id) || []
    };
  }).filter(Boolean);
}

async function fallbackFeedNovels(limit = 30, genre = "") {
  const { supabase } = await import('../../postgres');
  const { data } = await supabase
    .from('novels')
    .select('*')
    .or('approval_status.eq.approved,approval_status.is.null')
    .order('created_at', { ascending: false })
    .limit(200);
  const filtered = (data || []).filter((novel: any) => novelMatchesGenre(novel, genre)).slice(0, limit);
  return hydrateRecommendedNovels(filtered.map((novel: any) => ({ id: novel.id })), genre);
}

const eventSchema = z.object({
  novelId: z.string().min(1).max(100),
  event: z.enum([
    "view",
    "click",
    "read",
    "favorite",
    "finish",
    "impression",
    "share",
    "comment",
    "library_add",
    "follow",
    "unfollow",
    "remove_from_library",
    "not_interested",
    "chapter_start",
    "read_time",
    "chapter_complete"
  ]),
  readTime: z.number().int().min(0).max(60 * 60).optional(),
  chapter: z.number().int().min(0).max(10000).optional()
});

router.get('/recommend', async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    const queryUserId = req.query.userId;
    const resolvedUserId = user ? user.id : (req.query.anonId || queryUserId);

    // ✅ SECURITY: Strict user ID validation. Previously accepted any string
    // starting with "anon-", which allowed attackers to pass strings
    // containing SQL/XSS payloads as long as the prefix was correct.
    if (!resolvedUserId || typeof resolvedUserId !== 'string' || !isValidUserId(resolvedUserId, !user)) {
      return res.status(403).json({ error: 'دسترسی غیرمجاز یا شناسه نامعتبر' });
    }

    const { device } = req.query;
    // ✅ SECURITY: Validate device parameter to prevent log injection.
    const validDevices = new Set(['mobile', 'desktop', 'tablet']);
    const safeDevice = typeof device === 'string' && validDevices.has(device) ? device : 'desktop';
    const genre = typeof req.query.genre === "string" ? String(req.query.genre).slice(0, 100) : "";
    const context: Context = {
      device: safeDevice as 'mobile' | 'desktop' | 'tablet'
    };

    const genreKey = normalizeGenreFilter(genre);
    const cacheKey = `recommend:${resolvedUserId}:${context.device}:${genreKey || "all"}`;

    // Use powerful Promise Caching + Stale-While-Revalidate
    const recommendations = await cache.getWithSWR(
      cacheKey,
      async () => {
        const time = Date.now();
        return await ranker.recommend(resolvedUserId, context, time);
      },
      300,        // 5 minutes fully fresh
      86400 * 3   // 3 days stale data allowed while revalidating
    );

    const hydrated = await hydrateRecommendedNovels(recommendations || [], genre);
    if (hydrated.length > 0) return res.json(hydrated);
    return res.json(await fallbackFeedNovels(30, genre));
  } catch (error) {
    console.error('Recommendation Error:', error);
    const fallbackGenre = typeof req.query.genre === "string" ? String(req.query.genre).slice(0, 100) : "";
    res.json(await fallbackFeedNovels(30, fallbackGenre));
  }
});

router.post('/event', async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    let userId: string;

    // ✅ SECURITY: Anonymous user IDs are validated with strict format.
    // Previously accepted any string starting with "anon-", allowing SQL
    // injection / XSS via the userId field passed to ranker.trackEvent.
    if (!user) {
      const candidateUserId = req.body?.userId;
      if (typeof candidateUserId !== 'string' || !ANON_ID_PATTERN.test(candidateUserId)) {
        return res.status(403).json({ error: 'نشست معتبر یا بلیت ناشناس لازم است' });
      }
      userId = candidateUserId;
    } else {
      // Override untrusted input with known session identity.
      userId = user.id;
    }

    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'داده رویداد نامعتبر است' });
    }

    const { novelId, event, readTime, chapter } = parsed.data;

    // ✅ SECURITY: Validate novelId format before passing to ranker.
    if (!isValidNovelId(novelId)) {
      return res.status(400).json({ error: 'شناسه رمان نامعتبر است' });
    }

    await ranker.trackEvent(userId, novelId, event, readTime || 0, chapter || 0);

    // High-frequency impressions/read-time events train future refreshes but
    // must not destroy the recommendation cache on almost every page view.
    if (["favorite", "follow", "unfollow", "library_add", "remove_from_library", "not_interested", "chapter_complete"].includes(event)) {
      await invalidateSuggestionPreferences(userId);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Event Tracking Error:', error);
    res.status(400).json({ error: 'ثبت رویداد ناموفق بود' });
  }
});

export default router;
