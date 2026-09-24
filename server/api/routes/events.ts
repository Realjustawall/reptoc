import express from "express";
import { db, supabase } from "../../postgres";
import { getActiveUser, isOwnerUser } from "../../utils/auth";
import { logAdminAction } from "../../utils/audit";
import { sanitizePlainText } from "../../utils/content";
import {
  AUGUST_VIEWS_EVENT,
  getAugustViewsEventPhase,
  normalizeAugustViewsAuthorName,
  type AugustViewsEventRanking,
} from "../../../shared/augustViewsEvent";
import {
  normalizeEventAuthorName,
  validateSiteEventInput,
} from "../../../shared/siteEvents";
import {
  deleteSiteEvent,
  findFeaturedSiteEvent,
  findSiteEvent,
  isMissingEventSchema,
  listSiteEvents,
  saveSiteEvent,
} from "../../utils/siteEvents";

const router = express.Router();
const EXCLUDED_NAMES = AUGUST_VIEWS_EVENT.excludedAuthorNames.map(normalizeAugustViewsAuthorName);

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function mapRanking(row: any): AugustViewsEventRanking {
  const novelId = String(row.novel_id || "");
  const storedCover = String(row.cover_url || "");
  return {
    rank: Number(row.rank || 0),
    novelId,
    title: String(row.title || "بدون عنوان"),
    coverUrl: storedCover.startsWith("data:image/")
      ? `/api/novels/${encodeURIComponent(novelId)}/cover`
      : storedCover,
    author: String(row.author || row.author_username || "نویسنده ناشناس"),
    authorUsername: String(row.author_username || row.author || ""),
    eventViews: Number(row.event_views || 0),
  };
}

export const AUGUST_VIEWS_LEADERBOARD_CTE = `
  WITH eligible AS (
    SELECT
      novel.id AS novel_id,
      novel.title,
      novel.cover_url,
      novel.author,
      account.username AS author_username
    FROM novels novel
    JOIN users account ON account.id = novel.author_id
    WHERE lower(COALESCE(novel.approval_status, '')) = 'approved'
      AND NOT (regexp_replace(lower(btrim(account.username)), '[^a-z0-9]+', '_', 'g') = ANY($2::text[]))
      AND NOT (regexp_replace(lower(btrim(novel.author)), '[^a-z0-9]+', '_', 'g') = ANY($2::text[]))
      AND NOT EXISTS (
        SELECT 1
        FROM username_history history
        WHERE history.user_id = novel.author_id
          AND regexp_replace(lower(btrim(history.username)), '[^a-z0-9]+', '_', 'g') = ANY($2::text[])
      )
      AND NOT EXISTS (
        SELECT 1
        FROM novel_event_excluded_authors excluded
        WHERE excluded.event_id = $1
          AND excluded.user_id = novel.author_id
      )
  ), counted AS (
    SELECT
      eligible.*,
      COUNT(event_view.viewer_key)::integer AS event_views
    FROM eligible
    JOIN novel_event_views event_view
      ON event_view.novel_id = eligible.novel_id
      AND event_view.event_id = $1
      AND event_view.created_at >= $3::timestamptz
      AND event_view.created_at < $4::timestamptz
    GROUP BY eligible.novel_id, eligible.title, eligible.cover_url, eligible.author, eligible.author_username
  ), ranked AS (
    SELECT
      counted.*,
      ROW_NUMBER() OVER (
        ORDER BY counted.event_views DESC, lower(counted.title) ASC, counted.novel_id ASC
      )::integer AS rank
    FROM counted
  )
`;

router.get("/august-views-2026", async (req, res) => {
  const serverTime = new Date();
  const phase = getAugustViewsEventPhase(serverTime);
  const leaderboardEnabled = phase !== "upcoming";
  const page = positiveInteger(req.query.page, 1, 500);
  const pageSize = positiveInteger(req.query.pageSize, 20, 50);
  const summaryOnly = req.query.summary === "1" || req.query.summary === "true";
  const baseResponse = {
    event: {
      ...AUGUST_VIEWS_EVENT,
      phase,
      leaderboardEnabled,
      serverTime: serverTime.toISOString(),
    },
    stats: { eligibleNovels: 0, rankedNovels: 0, eligibleViews: 0 },
    topThree: [] as AugustViewsEventRanking[],
    rankings: [] as AugustViewsEventRanking[],
    pagination: { page, pageSize, totalItems: 0, totalPages: 0 },
  };

  res.setHeader(
    "Cache-Control",
    phase === "upcoming" ? "no-store" : "public, max-age=15, stale-while-revalidate=30",
  );
  if (!leaderboardEnabled) return res.json(baseResponse);

  const parameters = [
    AUGUST_VIEWS_EVENT.id,
    EXCLUDED_NAMES,
    AUGUST_VIEWS_EVENT.startsAt,
    AUGUST_VIEWS_EVENT.endsAt,
  ];

  try {
    const [statsResult, topResult, rankingsResult] = await Promise.all([
      db.query(`${AUGUST_VIEWS_LEADERBOARD_CTE}
        SELECT
          (SELECT COUNT(*)::integer FROM eligible) AS eligible_novels,
          (SELECT COUNT(*)::integer FROM ranked) AS ranked_novels,
          (SELECT COALESCE(SUM(event_views), 0)::integer FROM ranked) AS eligible_views
      `, parameters),
      db.query(`${AUGUST_VIEWS_LEADERBOARD_CTE}
        SELECT * FROM ranked WHERE rank <= 3 ORDER BY rank ASC
      `, parameters),
      summaryOnly
        ? Promise.resolve({ rows: [] })
        : db.query(`${AUGUST_VIEWS_LEADERBOARD_CTE}
            SELECT * FROM ranked
            WHERE rank > 3
            ORDER BY rank ASC
            OFFSET $5 LIMIT $6
          `, [...parameters, (page - 1) * pageSize, pageSize]),
    ]);

    const statsRow = statsResult.rows[0] || {};
    const rankedNovels = Number(statsRow.ranked_novels || 0);
    const totalItems = Math.max(0, rankedNovels - 3);
    return res.json({
      ...baseResponse,
      stats: {
        eligibleNovels: Number(statsRow.eligible_novels || 0),
        rankedNovels,
        eligibleViews: Number(statsRow.eligible_views || 0),
      },
      topThree: topResult.rows.map(mapRanking),
      rankings: rankingsResult.rows.map(mapRanking),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: totalItems > 0 ? Math.ceil(totalItems / pageSize) : 0,
      },
    });
  } catch (error: any) {
    console.error("August views event leaderboard error:", error);
    if (error?.code === "42P01" || error?.code === "42703") {
      return res.status(503).json({
        ...baseResponse,
        error: "جدول امتیازهای رویداد در حال آماده‌سازی است. لطفاً اندکی بعد دوباره تلاش کنید.",
      });
    }
    return res.status(500).json({ error: "بارگذاری جدول امتیازهای رویداد ناموفق بود." });
  }
});

// ---- Admin (owner only) -------------------------------------------------

async function loadEventOwner(req: express.Request) {
  const user = await getActiveUser(req, true);
  if (!user || !isOwnerUser(user)) return null;
  return user;
}

router.get("/august-views-2026/admin-overview", async (req, res) => {
  const owner = await loadEventOwner(req);
  if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });

  const serverTime = new Date();
  const phase = getAugustViewsEventPhase(serverTime);
  const parameters = [
    AUGUST_VIEWS_EVENT.id,
    EXCLUDED_NAMES,
    AUGUST_VIEWS_EVENT.startsAt,
    AUGUST_VIEWS_EVENT.endsAt,
  ];

  try {
    const [statsResult, topResult, recentActivityResult, excludedResult] = await Promise.all([
      db.query(`${AUGUST_VIEWS_LEADERBOARD_CTE}
        SELECT
          (SELECT COUNT(*)::integer FROM eligible) AS eligible_novels,
          (SELECT COUNT(*)::integer FROM ranked) AS ranked_novels,
          (SELECT COALESCE(SUM(event_views), 0)::integer FROM ranked) AS eligible_views
      `, parameters),
      db.query(`${AUGUST_VIEWS_LEADERBOARD_CTE}
        SELECT * FROM ranked WHERE rank <= 10 ORDER BY rank ASC
      `, parameters),
      // The outer aggregate needs its own GROUP BY: without it PostgreSQL
      // rejects the statement (42803) and the whole overview returned 500.
      db.query(`
        SELECT day, SUM(views)::integer AS views FROM (
          SELECT date_trunc('day', created_at) AS day, COUNT(*)::int AS views
            FROM novel_event_views
           WHERE event_id = $1 AND created_at >= $2::timestamptz
           GROUP BY 1
        ) days
        GROUP BY day
        ORDER BY day ASC
        LIMIT 62;
      `, [AUGUST_VIEWS_EVENT.id, AUGUST_VIEWS_EVENT.startsAt]),
      supabase
        .from("novel_event_excluded_authors")
        .select("user_id, matched_name, created_at")
        .eq("event_id", AUGUST_VIEWS_EVENT.id)
        .order("created_at", { ascending: false }),
    ]);

    const statsRow = statsResult.rows[0] || {};
    res.json({
      event: {
        ...AUGUST_VIEWS_EVENT,
        phase,
        serverTime: serverTime.toISOString(),
      },
      stats: {
        eligibleNovels: Number(statsRow.eligible_novels || 0),
        rankedNovels: Number(statsRow.ranked_novels || 0),
        eligibleViews: Number(statsRow.eligible_views || 0),
        totalRecordedViews: (recentActivityResult.rows || []).reduce((sum, row) => sum + Number(row.views || 0), 0),
        excludedAuthors: (excludedResult.data || []).length,
      },
      dailyActivity: (recentActivityResult.rows || []).map((row) => ({
        day: row.day,
        views: Number(row.views || 0),
      })),
      topTen: topResult.rows.map(mapRanking),
      excludedAuthors: (excludedResult.data || []).map((row) => ({
        userId: row.user_id,
        matchedName: row.matched_name || "",
        createdAt: row.created_at,
      })),
    });
  } catch (error: any) {
    console.error("Event admin overview error:", {
      code: error?.code,
      message: error?.message || String(error),
      detail: error?.detail,
    });
    if (error?.code === "42P01" || error?.code === "42703") {
      return res.status(503).json({ error: "جداول رویداد هنوز آماده نیستند. مایگریشن‌ها را اجرا کنید." });
    }
    res.status(500).json({ error: "بارگذاری نمای مدیریتی رویداد ناموفق بود." });
  }
});

router.post("/august-views-2026/admin/exclusions", async (req, res) => {
  const owner = await loadEventOwner(req);
  if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });

  try {
    const username = sanitizePlainText(req.body?.username, 60).trim();
    if (!username) return res.status(400).json({ error: "نام کاربری نویسنده را وارد کنید." });

    // Escape LIKE wildcards so an input like "the_best%" can only match that
    // literal username, never a wildcard family of accounts.
    const escapedUsername = username.replace(/[\\%_]/g, "\\$&");
    const { data: user } = await supabase
      .from("users")
      .select("id, username")
      .ilike("username", escapedUsername)
      .order("created_at", { ascending: true })
      .limit(1);
    const matchedUser = user?.[0];
    if (!matchedUser) return res.status(404).json({ error: "کاربری با این نام کاربری پیدا نشد." });

    const { error } = await supabase
      .from("novel_event_excluded_authors")
      .upsert(
        {
          event_id: AUGUST_VIEWS_EVENT.id,
          user_id: matchedUser.id,
          matched_name: normalizeAugustViewsAuthorName(matchedUser.username)
        },
        { onConflict: "event_id,user_id" }
      );
    if (error) throw error;

    try { await logAdminAction(owner.id, matchedUser.id, "event_author_excluded", { eventId: AUGUST_VIEWS_EVENT.id }); } catch {}
    res.json({ success: true, excluded: { userId: matchedUser.id, username: matchedUser.username } });
  } catch {
    res.status(400).json({ error: "افزودن نویسنده به فهرست مستثناها ناموفق بود." });
  }
});

router.delete("/august-views-2026/admin/exclusions/:userId", async (req, res) => {
  const owner = await loadEventOwner(req);
  if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });

  try {
    const { data: deleted } = await supabase
      .from("novel_event_excluded_authors")
      .delete()
      .eq("event_id", AUGUST_VIEWS_EVENT.id)
      .eq("user_id", req.params.userId)
      .select("user_id");
    if (!deleted?.length) return res.status(404).json({ error: "این نویسنده در فهرست مستثناها نیست." });

    try { await logAdminAction(owner.id, req.params.userId, "event_author_unexcluded", { eventId: AUGUST_VIEWS_EVENT.id }); } catch {}
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "حذف از فهرست مستثناها ناموفق بود." });
  }
});

router.delete("/august-views-2026/admin/views/:novelId", async (req, res) => {
  const owner = await loadEventOwner(req);
  if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });

  try {
    const result = await db.query(
      `DELETE FROM novel_event_views WHERE event_id = $1 AND novel_id = $2`,
      [AUGUST_VIEWS_EVENT.id, req.params.novelId]
    );
    try { await logAdminAction(owner.id, null, "event_novel_views_cleared", { eventId: AUGUST_VIEWS_EVENT.id, novelId: req.params.novelId, removedRows: result.rowCount || 0 }); } catch {}
    res.json({ success: true, removedViews: result.rowCount || 0 });
  } catch {
    res.status(400).json({ error: "پاک‌سازی بازدیدهای مشکوک رمان ناموفق بود." });
  }
});

// ---- Administrator-managed events --------------------------------------
//
// Events are database rows, so an owner can create, edit, feature, archive and
// delete them (and their banners) without a deployment. The legacy
// `august-views-2026` routes below remain so existing links keep working.

/** The banner the home page shows, if an owner has featured one. */
router.get("/featured-banner", async (_req, res) => {
  try {
    const event = await findFeaturedSiteEvent();
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    if (!event) return res.json({ event: null });
    res.json({
      event: {
        slug: event.slug,
        title: event.title,
        description: event.description,
        kind: event.kind,
        phase: event.phase,
        dateLabel: event.dateLabel,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        banner: event.banner,
      },
    });
  } catch (error: any) {
    if (isMissingEventSchema(error)) return res.json({ event: null });
    console.error("[events] featured banner failed", { message: error?.message });
    res.json({ event: null });
  }
});

/** Published events, for the public events list. */
router.get("/", async (_req, res) => {
  try {
    const events = await listSiteEvents({ publishedOnly: true });
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    res.json({ events });
  } catch (error: any) {
    if (isMissingEventSchema(error)) return res.json({ events: [] });
    console.error("[events] list failed", { message: error?.message });
    res.status(500).json({ error: "بارگذاری فهرست رویدادها ناموفق بود." });
  }
});

/** Every event including drafts and archives — owner only. */
router.get("/admin/all", async (req, res) => {
  const owner = await loadEventOwner(req);
  if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });
  try {
    res.json({ events: await listSiteEvents() });
  } catch (error: any) {
    if (isMissingEventSchema(error)) {
      return res.status(503).json({ error: "جداول رویداد آماده نیست. مایگریشن‌ها را اجرا کنید." });
    }
    console.error("[events] admin list failed", { message: error?.message });
    res.status(500).json({ error: "بارگذاری رویدادها ناموفق بود." });
  }
});

/**
 * Create or update an event.
 *
 * Validation lives in `shared/siteEvents` so this endpoint and the admin form
 * enforce exactly the same rules; the response carries the offending field so
 * the form can point at it.
 */
async function upsertEvent(req: express.Request, res: express.Response, existingId?: string) {
  const owner = await loadEventOwner(req);
  if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });

  const { event, error } = validateSiteEventInput(req.body || {}, { existingId });
  if (error) return res.status(400).json({ error: error.message, field: error.field });

  try {
    // The slug is the public identifier, so a collision with a different event
    // must be reported rather than silently overwriting that event.
    const clash = await findSiteEvent(event.slug);
    if (clash && clash.id !== event.id) {
      return res.status(409).json({
        error: "رویداد دیگری با همین نشانی وجود دارد؛ نشانی دیگری انتخاب کنید.",
        field: "slug",
      });
    }

    const saved = await saveSiteEvent(event, owner.id);
    try {
      await logAdminAction(owner.id, null, existingId ? "event_updated" : "event_created", {
        eventId: saved.id,
        status: saved.status,
        featured: saved.isFeatured,
      });
    } catch {}
    res.status(existingId ? 200 : 201).json({ success: true, event: saved });
  } catch (requestError: any) {
    if (isMissingEventSchema(requestError)) {
      return res.status(503).json({ error: "جداول رویداد آماده نیست. مایگریشن‌ها را اجرا کنید." });
    }
    console.error("[events] save failed", { message: requestError?.message, code: requestError?.code });
    res.status(400).json({ error: "ذخیره رویداد ناموفق بود." });
  }
}

router.post("/admin", express.json({ limit: "256kb" }), (req, res) => { void upsertEvent(req, res); });
router.put("/admin/:eventId", express.json({ limit: "256kb" }), (req, res) => {
  void upsertEvent(req, res, String(req.params.eventId || ""));
});

/** Retire an event without losing its recorded views. */
router.patch("/admin/:eventId/status", express.json({ limit: "16kb" }), async (req, res) => {
  const owner = await loadEventOwner(req);
  if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });

  const existing = await findSiteEvent(String(req.params.eventId || ""));
  if (!existing) return res.status(404).json({ error: "رویداد یافت نشد." });

  try {
    const saved = await saveSiteEvent(
      {
        ...existing,
        status: String(req.body?.status || existing.status),
        // Archiving must also release the home-page banner slot, otherwise a
        // retired event keeps promoting itself.
        isFeatured: String(req.body?.status || existing.status) === "published"
          ? (req.body?.isFeatured ?? existing.isFeatured) === true
          : false,
      },
      owner.id,
    );
    try { await logAdminAction(owner.id, null, "event_status_changed", { eventId: saved.id, status: saved.status }); } catch {}
    res.json({ success: true, event: saved });
  } catch (error: any) {
    console.error("[events] status change failed", { message: error?.message });
    res.status(400).json({ error: "تغییر وضعیت رویداد ناموفق بود." });
  }
});

router.delete("/admin/:eventId", async (req, res) => {
  const owner = await loadEventOwner(req);
  if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });

  const eventId = String(req.params.eventId || "");
  const existing = await findSiteEvent(eventId);
  if (!existing) return res.status(404).json({ error: "رویداد یافت نشد." });

  try {
    const result = await deleteSiteEvent(existing.id);
    try {
      await logAdminAction(owner.id, null, "event_deleted", {
        eventId: existing.id,
        removedViews: result.removedViews,
      });
    } catch {}
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error("[events] delete failed", { message: error?.message });
    res.status(400).json({ error: "حذف رویداد ناموفق بود." });
  }
});

/** Leaderboard for any event, resolved by slug. */
router.get("/:slug/leaderboard", async (req, res) => {
  const page = positiveInteger(req.query.page, 1, 500);
  const pageSize = positiveInteger(req.query.pageSize, 20, 50);

  try {
    const event = await findSiteEvent(String(req.params.slug || ""));
    if (!event) return res.status(404).json({ error: "رویداد یافت نشد." });

    const viewer = await getActiveUser(req, false);
    // Drafts and archives stay owner-only, so an unfinished event cannot be
    // discovered by guessing its slug.
    if (event.status !== "published" && !(viewer && isOwnerUser(viewer))) {
      return res.status(404).json({ error: "رویداد یافت نشد." });
    }

    const base = {
      event,
      stats: { eligibleNovels: 0, rankedNovels: 0, eligibleViews: 0 },
      topThree: [] as AugustViewsEventRanking[],
      rankings: [] as AugustViewsEventRanking[],
      pagination: { page, pageSize, totalItems: 0, totalPages: 0 },
    };
    if (event.kind !== "views_leaderboard" || !event.leaderboardEnabled) return res.json(base);

    const parameters = [
      event.id,
      event.excludedAuthorNames.map(normalizeEventAuthorName),
      event.startsAt,
      event.endsAt,
    ];
    const [statsResult, topResult, rankingsResult] = await Promise.all([
      db.query(`${AUGUST_VIEWS_LEADERBOARD_CTE}
        SELECT
          (SELECT COUNT(*)::integer FROM eligible) AS eligible_novels,
          (SELECT COUNT(*)::integer FROM ranked) AS ranked_novels,
          (SELECT COALESCE(SUM(event_views), 0)::integer FROM ranked) AS eligible_views
      `, parameters),
      db.query(`${AUGUST_VIEWS_LEADERBOARD_CTE} SELECT * FROM ranked WHERE rank <= 3 ORDER BY rank ASC`, parameters),
      db.query(`${AUGUST_VIEWS_LEADERBOARD_CTE}
        SELECT * FROM ranked WHERE rank > 3 ORDER BY rank ASC OFFSET $5 LIMIT $6
      `, [...parameters, (page - 1) * pageSize, pageSize]),
    ]);

    const statsRow = statsResult.rows[0] || {};
    const rankedNovels = Number(statsRow.ranked_novels || 0);
    const totalItems = Math.max(0, rankedNovels - 3);
    res.json({
      ...base,
      stats: {
        eligibleNovels: Number(statsRow.eligible_novels || 0),
        rankedNovels,
        eligibleViews: Number(statsRow.eligible_views || 0),
      },
      topThree: topResult.rows.map(mapRanking),
      rankings: rankingsResult.rows.map(mapRanking),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: totalItems > 0 ? Math.ceil(totalItems / pageSize) : 0,
      },
    });
  } catch (error: any) {
    if (isMissingEventSchema(error)) return res.status(503).json({ error: "جداول رویداد آماده نیست." });
    console.error("[events] leaderboard failed", { message: error?.message });
    res.status(500).json({ error: "بارگذاری جدول امتیازها ناموفق بود." });
  }
});

export default router;
