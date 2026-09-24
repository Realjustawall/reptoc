import express from "express";
import { db, supabase } from "../../postgres";
import { interactionLimiter } from "../limiters";
import { getActiveUser } from "../../utils/auth";
import { canManageNovel, isChapterVisibleToUser } from "../../utils/chapters";
import { canUserViewNovel } from "../../utils/chapters";
import { cache } from "../../utils/cache";
import { buildAnalyticsContext } from "../../utils/analyticsContext";
import { ensureAnalyticsTables } from "../../utils/analyticsSchema";
import { invalidateSuggestionPreferences, recordSuggestionStatsEvent } from "../../suggestion/maintenance";
import { recordNovelUniqueView } from "../../utils/viewCounting";
import crypto from "crypto";
import { createUserNotification } from "../../utils/notifications";
import { calculateAverageViews } from "../../../shared/statistics";
import { recordDailyActivityStreak } from "../../utils/userActivity";
import { normalizeReadingSessionMetrics } from "../../../shared/readingAnalytics";

const router = express.Router();

const ANALYTICS_ACTIONS = new Set(["view", "like", "bookmark", "read_progress", "search_click"]);

function cleanSource(value: unknown) {
  const raw = String(value || "direct").trim().slice(0, 80);
  return raw.replace(/[^a-zA-Z0-9:_./?&=-]+/g, "_") || "direct";
}

function percent(count: number, total: number) {
  return total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0;
}

function distribution(rows: any[], field: string, total?: number, limit = 10) {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const value = String(row[field] || "نامشخص").trim() || "نامشخص";
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  const denominator = total ?? rows.length;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count, percentage: percent(count, denominator) }));
}

function dailySeries(rows: any[]) {
  const daily: Record<string, { views: number; engagements: number; readSeconds: number }> = {};
  rows.forEach((log: any) => {
    const day = new Date(log.created_at).toISOString().slice(0, 10);
    daily[day] ||= { views: 0, engagements: 0, readSeconds: 0 };
    if (log.action_type === "view") daily[day].views++;
    else daily[day].engagements++;
    daily[day].readSeconds += Number(log.read_seconds || 0);
  });
  return Object.entries(daily)
    .map(([date, value]) => ({ date, ...value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function actorId(row: any) {
  return row.viewer_id || row.user_id || (row.ip_hash ? `anon:${row.ip_hash}` : "");
}

function sourceAttribution(rows: any[]) {
  return distribution(rows, "source", rows.length, 12);
}

function buildFunnel(logs: any[], sessions: any[], suggestionEvents: any[] = []) {
  const impressions = new Set<string>();
  const clicks = new Set<string>();
  const readers = new Set<string>();
  const completions = new Set<string>();
  const bookmarks = new Set<string>();

  suggestionEvents.forEach((event: any) => {
    const key = event.user_id || event.ip_hash || "";
    if (!key) return;
    if (event.event_type === "impression") impressions.add(key);
    if (event.event_type === "click") clicks.add(key);
    if (["chapter_start", "read_time", "chapter_complete"].includes(event.event_type)) readers.add(key);
    if (event.event_type === "chapter_complete") completions.add(key);
    if (["library_add", "bookmark", "favorite"].includes(event.event_type)) bookmarks.add(key);
  });

  logs.forEach((log: any) => {
    const key = actorId(log);
    if (!key) return;
    if (log.action_type === "view") readers.add(key);
    if (log.action_type === "search_click") clicks.add(key);
    if (log.action_type === "bookmark") bookmarks.add(key);
    if (Number(log.scroll_percentage || 0) >= 90) completions.add(key);
  });

  sessions.forEach((session: any) => {
    const key = actorId(session);
    if (!key) return;
    readers.add(key);
    if (Number(session.scroll_percentage || 0) >= 90) completions.add(key);
  });

  const steps = [
    { key: "impressions", label: "نمایش‌ها", count: impressions.size },
    { key: "clicks", label: "کلیک‌ها", count: clicks.size },
    { key: "readers", label: "خوانندگان", count: readers.size },
    { key: "completions", label: "تکمیل‌شده‌ها", count: completions.size },
    { key: "bookmarks", label: "نشان‌گذاری‌ها", count: bookmarks.size }
  ];

  return steps.map((step, index) => {
    const previous = index > 0 ? steps[index - 1].count : step.count;
    return {
      ...step,
      conversionFromPrevious: index === 0 ? 100 : percent(step.count, previous),
      conversionFromImpression: percent(step.count, Math.max(steps[0].count, step.count))
    };
  });
}

function buildCohorts(sessions: any[]) {
  const cohorts: Record<string, Set<string>> = {};
  sessions.forEach((session: any) => {
    const key = actorId(session);
    if (!key || !session.created_at) return;
    const day = new Date(session.created_at).toISOString().slice(0, 10);
    cohorts[day] ||= new Set<string>();
    cohorts[day].add(key);
  });

  return Object.entries(cohorts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, readers]) => ({
      date,
      readers: readers.size,
      returningReaders: [...readers].filter((reader) =>
        sessions.some((session: any) => actorId(session) === reader && new Date(session.created_at).toISOString().slice(0, 10) > date)
      ).length
    }))
    .map((row) => ({ ...row, returnRate: percent(row.returningReaders, row.readers) }));
}

function analyticsActorKey(req: express.Request, user: any) {
  if (user?.id) return `user:${user.id}`;
  const raw = `${req.ip || req.socket.remoteAddress || "unknown"}:${req.headers["user-agent"] || "unknown"}`;
  return `anon:${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

// Get comments for author's novels
router.get("/comments", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });

    // Find user's novels
    const { data: novels } = await supabase.from('novels').select('id, title').eq('author_id', user.id);
    if (!novels || novels.length === 0) return res.json({ comments: [] });

    let novelIds = novels.map(n => n.id);
    // Optional single-novel focus so writers can read every comment of one
    // book in one place; still scoped to owned novels.
    const requestedNovelId = String(req.query.novelId || "");
    if (requestedNovelId) {
      if (!novelIds.includes(requestedNovelId)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
      novelIds = [requestedNovelId];
    }

    const [reviewsResult, chapterCommentsResult, repliesResult] = await Promise.all([
      supabase
        .from('reviews')
        .select('id, novel_id, user_id, username, rating, content, created_at, users(username, avatar)')
        .in('novel_id', novelIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('chapter_comments')
        .select('id, novel_id, chapter_id, paragraph_id, user_id, content, moderation_status, deleted_at, created_at, users(username, avatar), chapters(title, chapter_number)')
        .in('novel_id', novelIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('comment_replies')
        .select('*')
        .in('novel_id', novelIds)
        .order('created_at', { ascending: true })
    ]);

    const repliesByTarget = new Map<string, any[]>();
    (repliesResult.data || []).forEach((reply: any) => {
      const key = `${reply.target_type}:${reply.target_id}`;
      repliesByTarget.set(key, [...(repliesByTarget.get(key) || []), reply]);
    });

    const mappedReviews = (reviewsResult.data || []).map((r: any) => ({
      ...r,
      username: r.users?.username || r.username || "خواننده",
      avatar: r.users?.avatar || "",
      type: "review",
      targetType: "review",
      targetId: r.id,
      comment: r.content,
      novel_title: novels.find(n => n.id === r.novel_id)?.title || 'رمان ناشناخته',
      replies: repliesByTarget.get(`review:${r.id}`) || []
    }));

    const mappedChapterComments = (chapterCommentsResult.data || []).filter((comment: any) => comment.deleted_at === null).map((comment: any) => ({
      id: comment.id,
      novel_id: comment.novel_id,
      chapter_id: comment.chapter_id,
      paragraph_id: comment.paragraph_id || null,
      chapter_title: (comment.chapters as any)?.title || "",
      chapter_number: (comment.chapters as any)?.chapter_number ?? null,
      user_id: comment.user_id,
      username: comment.users?.username || "خواننده",
      avatar: comment.users?.avatar || "",
      content: comment.content,
      comment: comment.content,
      moderation_status: comment.moderation_status || "visible",
      created_at: comment.created_at,
      type: "chapter_comment",
      targetType: "chapter_comment",
      targetId: comment.id,
      novel_title: novels.find(n => n.id === comment.novel_id)?.title || 'رمان ناشناخته',
      replies: repliesByTarget.get(`chapter_comment:${comment.id}`) || []
    }));

    res.json({ comments: [...mappedReviews, ...mappedChapterComments].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) });
  } catch (err) {
    res.status(400).json({ error: "دریافت دیدگاه‌ها ناموفق بود" });
  }
});

router.delete("/comments/:type/:id", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    const { type, id } = req.params;
    const table = type === "review" ? "reviews" : type === "chapter_comment" ? "chapter_comments" : "";
    if (!table) return res.status(400).json({ error: "نوع دیدگاه نامعتبر است" });
    const { data: comment } = await supabase.from(table).select("id, novel_id").eq("id", id).single();
    if (!comment) return res.status(404).json({ error: "دیدگاه مورد یافت نشد" });
    const { data: novel } = await supabase.from("novels").select("id, author_id").eq("id", comment.novel_id).single();
    const normalizedRole = String(user.role || "").toLowerCase().trim();
    if (!novel || (novel.author_id !== user.id && !["owner", "admin", "editor"].includes(normalizedRole))) {
      return res.status(403).json({ error: "دسترسی غیرمجاز" });
    }
    await supabase.from("comment_replies").delete().eq("target_type", type).eq("target_id", id);
    await supabase.from(table).delete().eq("id", id);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "حذف دیدگاه ناموفق بود" });
  }
});

router.post("/comments/:type/:id/reply", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    const { type, id } = req.params;
    const table = type === "review" ? "reviews" : type === "chapter_comment" ? "chapter_comments" : "";
    if (!table) return res.status(400).json({ error: "نوع دیدگاه نامعتبر است" });
    const content = String(req.body.content || "").replace(/<[^>]*>/g, "").trim().slice(0, 5000);
    if (!content) return res.status(400).json({ error: "متن پاسخ الزامی است" });
    const { data: comment } = await supabase.from(table).select("id, novel_id, user_id, username").eq("id", id).single();
    if (!comment) return res.status(404).json({ error: "دیدگاه مورد یافت نشد" });
    const { data: novel } = await supabase.from("novels").select("id, title, author, author_id").eq("id", comment.novel_id).single();
    const normalizedRole = String(user.role || "").toLowerCase().trim();
    if (!novel || (novel.author_id !== user.id && !["owner", "admin", "editor"].includes(normalizedRole))) {
      return res.status(403).json({ error: "دسترسی غیرمجاز" });
    }
    const replyId = `cr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await supabase.from("comment_replies").insert({
      id: replyId,
      target_type: type,
      target_id: id,
      novel_id: novel.id,
      author_id: user.id,
      content
    });
    if (comment.user_id && comment.user_id !== user.id) {
      await createUserNotification(comment.user_id, "comment_reply", "نویسنده به دیدگاه شما پاسخ داد", `${novel.title}: ${content.slice(0, 160)}`, `/novels/${novel.id}`, "notify_replies");
    }
    res.json({ success: true, reply: { id: replyId, content } });
  } catch {
    res.status(400).json({ error: "ارسال پاسخ به دیدگاه ناموفق بود" });
  }
});

// Follow user or novel
// Example: POST /api/follows
// body: { target_type: 'user' | 'novel', target_id: string }
router.post("/", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });

    const { target_type, target_id } = req.body;
    if (!target_type || !target_id) return res.status(400).json({ error: "داده ارسالی نامعتبر است" });

    const { data: existing } = await supabase.from('follows')
       .select('id')
       .eq('follower_id', user.id)
       .eq('target_type', target_type)
       .eq('target_id', target_id)
       .single();

    if (existing) {
       // Unfollow
       await supabase.from('follows').delete().eq('id', existing.id);
       await invalidateSuggestionPreferences(user.id).catch(() => {});
       res.json({ following: false });
    } else {
       // Follow
       await supabase.from('follows').insert({
         id: "fol-" + Date.now() + Math.random().toString(36).substring(2, 6),
         follower_id: user.id,
         target_type,
         target_id
       });
       await invalidateSuggestionPreferences(user.id).catch(() => {});
       res.json({ following: true });
    }

  } catch (err) {
    res.status(400).json({ error: "دنبال کردن ناموفق بود" });
  }
});

// Check if following
router.get("/check", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!user) return res.json({ following: false });

    const { target_type, target_id } = req.query;

    const { data: existing } = await supabase.from('follows')
       .select('id')
       .eq('follower_id', user.id)
       .eq('target_type', target_type as string)
       .eq('target_id', target_id as string)
       .single();

    res.json({ following: !!existing });
  } catch (err) {
    res.json({ following: false });
  }
});

// Get user followers count
router.get("/count", async (req, res) => {
  try {
    const { target_type, target_id } = req.query;
    const { count } = await supabase.from('follows')
       .select('id', { count: 'exact', head: true })
       .eq('target_type', target_type as string)
       .eq('target_id', target_id as string);

    res.json({ count: count || 0 });
  } catch (err) {
    res.json({ count: 0 });
  }
});

// Log analytics event
router.post("/log", async (req, res) => {
  try {
    await ensureAnalyticsTables();
    const { novel_id, action_type } = req.body;
    
    if (!novel_id || !action_type) return res.status(400).json({ error: "داده ارسالی ناقص است" });
    const safeNovelId = String(novel_id || "").slice(0, 160);
    const safeChapterId = String(req.body.chapter_id || req.body.chapterId || "").slice(0, 160);
    const actionType = String(action_type);
    if (!ANALYTICS_ACTIONS.has(actionType)) return res.status(400).json({ error: "کنش تحلیلی پشتیبانی نمی‌شود." });
    // CSRF is enforced for authenticated callers on every action (including
    // "view" beacons) so cross-site pages cannot forge view inflation against
    // a visitor's cookies. Anonymous beacons remain allowed.
    const user = await getActiveUser(req, true);
    if (actionType !== "view" && !user) {
      return res.status(401).json({ error: "دسترسی غیرمجاز" });
    }

    const actorKey = analyticsActorKey(req, user);
    const rate = await cache.rateLimit(`analytics:rate:${actorKey}`, user ? 240 : 60, 60 * 60);
    if (!rate.allowed) return res.status(429).json({ error: "تعداد رویدادهای تحلیلی بیش از حد مجاز است." });

    const { data: novel } = await supabase
      .from("novels")
      .select("id, author_id, approved_by, approval_status")
      .eq("id", safeNovelId)
      .single();
    if (!novel || !canUserViewNovel(novel, user)) {
      return res.status(404).json({ error: "رمان مورد یافت نشد." });
    }

    if (safeChapterId) {
      const { data: chapter } = await supabase
        .from("chapters")
        .select("id, novel_id, status, scheduled_at")
        .eq("id", safeChapterId)
        .eq("novel_id", safeNovelId)
        .single();
      if (!chapter || !isChapterVisibleToUser(chapter, canManageNovel(user, novel))) {
        return res.status(404).json({ error: "فصل مورد یافت نشد." });
      }
    }

    const analyticsContext = await buildAnalyticsContext(req);
    let countedView = false;
    let loggedActionType = actionType;
    if (actionType === "view") {
      countedView = await recordNovelUniqueView(safeNovelId, user, analyticsContext);
      if (!countedView) return res.json({ success: true, countedView: false });
    }

    await supabase.from('analytics_logs').insert({
      id: "log-" + Date.now() + Math.random().toString(36).substring(2, 6),
      novel_id: safeNovelId,
      chapter_id: safeChapterId || null,
      viewer_id: user?.id || null,
      action_type: loggedActionType,
      read_seconds: Math.max(0, Math.min(Number(req.body.readSeconds || req.body.read_seconds || 0), 24 * 60 * 60)),
      scroll_percentage: Math.max(0, Math.min(Number(req.body.scrollPercentage || req.body.scroll_percentage || 0), 100)),
      source: cleanSource(req.body.source || req.headers.referer || "direct"),
      ...analyticsContext
    });
    await recordSuggestionStatsEvent(safeNovelId, loggedActionType === "view" ? "view" : loggedActionType).catch(() => {});

    res.json({ success: true, countedView });
  } catch (err) {
    console.error("Error logging analytics:", err);
    res.status(400).json({ error: "ثبت رویداد ناموفق بود" });
  }
});

router.post("/read-session", async (req, res) => {
  try {
    await ensureAnalyticsTables();
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    const { novelId, novel_id, chapterId, chapter_id, chapterNumber, readSeconds, scrollPercentage, source } = req.body;
    const resolvedNovelId = String(novelId || novel_id || "");
    const resolvedChapterId = String(chapterId || chapter_id || "");
    if (!resolvedNovelId) return res.status(400).json({ error: "شناسه رمان الزامی است" });

    const { data: novel } = await supabase
      .from("novels")
      .select("id, author_id, approved_by, approval_status")
      .eq("id", resolvedNovelId)
      .single();
    if (!novel || !canUserViewNovel(novel, user)) {
      return res.status(404).json({ error: "رمان مورد یافت نشد." });
    }

    if (resolvedChapterId) {
      const { data: chapter } = await supabase
        .from("chapters")
        .select("id, novel_id, status, scheduled_at")
        .eq("id", resolvedChapterId)
        .eq("novel_id", resolvedNovelId)
        .single();
      if (!chapter || !isChapterVisibleToUser(chapter, canManageNovel(user, novel))) {
        return res.status(404).json({ error: "فصل مورد یافت نشد." });
      }
    }

    const analyticsContext = await buildAnalyticsContext(req);
    const actorKey = analyticsActorKey(req, user);
    const rate = await cache.rateLimit(`analytics:session:rate:${actorKey}`, user ? 1200 : 300, 60 * 60);
    if (!rate.allowed) return res.status(429).json({ error: "تعداد نشست‌های خواندن بیش از حد مجاز است." });

    // The client flushes foreground reader activity in short batches. Reject
    // wall-clock-sized payloads so one stale/background session cannot add
    // hours to a profile in a single request.
    // Production installations may retain an INTEGER scroll_percentage
    // column. Normalize decimal reader progress before either analytics write.
    const { readSeconds: safeReadSeconds, scrollPercentage: safeScroll } = normalizeReadingSessionMetrics(
      readSeconds,
      scrollPercentage,
    );
    const safeSource = cleanSource(source || req.headers.referer || "reader");

    const readingSessionWrite = await supabase.from("reading_sessions").insert({
      id: `rs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      user_id: user?.id || null,
      novel_id: resolvedNovelId,
      chapter_id: resolvedChapterId || null,
      read_seconds: safeReadSeconds,
      scroll_percentage: safeScroll,
      source: safeSource,
      foreground_active: true,
      ...analyticsContext
    });
    if (readingSessionWrite.error) throw readingSessionWrite.error;

    const analyticsLogWrite = await supabase.from("analytics_logs").insert({
      id: `log-session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      novel_id: resolvedNovelId,
      chapter_id: resolvedChapterId || null,
      viewer_id: user?.id || null,
      // A reading-session sample is engagement data, not the canonical novel
      // view event. Recording early sessions as `view` made the lifetime
      // uniqueness check believe the user had already been counted even when
      // views_count had never been incremented.
      action_type: "read_progress",
      // reading_sessions is the single source of truth for duration. Keeping a
      // second copy here caused author analytics to double every reading batch.
      read_seconds: 0,
      scroll_percentage: safeScroll,
      source: safeSource,
      ...analyticsContext
    });
    if (analyticsLogWrite.error) throw analyticsLogWrite.error;

    if (safeReadSeconds > 0) {
      await recordDailyActivityStreak(user.id).catch((error) => {
        console.warn("Reading streak update failed:", error instanceof Error ? error.message : error);
      });
    }
    await recordSuggestionStatsEvent(resolvedNovelId, safeScroll >= 90 ? "chapter_complete" : "chapter_start", Number(chapterNumber || 0)).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    console.error("Error logging reading session:", err);
    res.status(400).json({ error: "ثبت نشست خواندن ناموفق بود" });
  }
});

// Get author aggregate stats
router.get("/author-stats", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });

    const { data: novels } = await supabase.from('novels').select('id, title, views_count, bookmarks_count').eq('author_id', user.id);
    if (!novels || novels.length === 0) return res.json({ performance: [] });

    const novelIds = novels.map(n => n.id);

    // Get logs for last 7 days
    const { data: logs } = await supabase
      .from('analytics_logs')
        .select('created_at, action_type, viewer_id, read_seconds, scroll_percentage, chapter_id, country_name, country_code, is_vpn, device_type, device_os, device_browser, ip_hash, source')
      .in('novel_id', novelIds)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    const [
      likesResult,
      bookmarksResult,
      reviewsResult,
      chaptersResult,
      sessionsResult
    ] = await Promise.all([
      supabase.from('novel_likes').select('id', { count: 'exact', head: true }).in('novel_id', novelIds),
      supabase.from('bookmarks').select('id', { count: 'exact', head: true }).in('novel_id', novelIds),
      supabase.from('reviews').select('id', { count: 'exact', head: true }).in('novel_id', novelIds),
      supabase.from('chapters').select('id, novel_id, title, chapter_number, views_count').in('novel_id', novelIds).order('chapter_number', { ascending: true }),
      supabase.from('reading_sessions').select('created_at, read_seconds, scroll_percentage, user_id, chapter_id, country_name, country_code, is_vpn, device_type, device_os, device_browser, ip_hash, source, foreground_active').in('novel_id', novelIds).eq('foreground_active', true)
    ]);

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const performanceMap: Record<string, { views: number; engagements: number }> = {
      'Monday': { views: 0, engagements: 0 },
      'Tuesday': { views: 0, engagements: 0 },
      'Wednesday': { views: 0, engagements: 0 },
      'Thursday': { views: 0, engagements: 0 },
      'Friday': { views: 0, engagements: 0 },
      'Saturday': { views: 0, engagements: 0 },
      'Sunday': { views: 0, engagements: 0 }
    };

    const uniqueReaders = new Set<string>();
    let totalReadSeconds = 0;
    let totalScroll = 0;
    let scrollSamples = 0;

    (logs || []).forEach((log: any) => {
      const d = new Date(log.created_at);
      const dayName = days[d.getDay()];
      if (log.action_type === 'view') {
         performanceMap[dayName].views++;
      } else {
         // anything else is an engagement
         performanceMap[dayName].engagements++;
      }
      if (log.viewer_id) uniqueReaders.add(log.viewer_id);
      if (log.scroll_percentage !== null && log.scroll_percentage !== undefined) {
        totalScroll += Number(log.scroll_percentage || 0);
        scrollSamples++;
      }
    });

    (sessionsResult.data || []).forEach((session: any) => {
      if (session.user_id) uniqueReaders.add(session.user_id);
      totalReadSeconds += Number(session.read_seconds || 0);
      if (session.scroll_percentage !== null && session.scroll_percentage !== undefined) {
        totalScroll += Number(session.scroll_percentage || 0);
        scrollSamples++;
      }
    });

    const orderedDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayNamesFa: Record<string, string> = {
      'Monday': 'دوشنبه',
      'Tuesday': 'سه‌شنبه',
      'Wednesday': 'چهارشنبه',
      'Thursday': 'پنجشنبه',
      'Friday': 'جمعه',
      'Saturday': 'شنبه',
      'Sunday': 'یکشنبه'
    };
    const performance = orderedDays.map(day => ({
        name: dayNamesFa[day] || day,
        views: performanceMap[day].views,
        engagements: performanceMap[day].engagements
    }));

    const chapterDropoff = (chaptersResult.data || []).map((chapter: any, index: number, all: any[]) => {
      const firstViews = all[0]?.views_count || 0;
      const currentViews = chapter.views_count || 0;
      return {
        chapterId: chapter.id,
        title: chapter.title,
        chapterNumber: chapter.chapter_number,
        views: currentViews,
        retentionPercent: firstViews > 0 ? Math.round((currentViews / firstViews) * 100) : 0
      };
    });

    res.json({
      performance,
      totals: {
        views: novels.reduce((sum: number, novel: any) => sum + (novel.views_count || 0), 0),
        likes: likesResult.count || 0,
        bookmarks: bookmarksResult.count || 0,
        comments: reviewsResult.count || 0,
        uniqueReaders: uniqueReaders.size,
        readSeconds: totalReadSeconds,
        averageScroll: scrollSamples ? Math.round(totalScroll / scrollSamples) : 0
      },
      chapterDropoff,
      audience: {
        countries: distribution([...(logs || []), ...(sessionsResult.data || [])], "country_name", undefined, 10),
        devices: distribution([...(logs || []), ...(sessionsResult.data || [])], "device_type", undefined, 8),
        operatingSystems: distribution([...(logs || []), ...(sessionsResult.data || [])], "device_os", undefined, 8),
        browsers: distribution([...(logs || []), ...(sessionsResult.data || [])], "device_browser", undefined, 8),
        vpnOrProxy: percent([...(logs || []), ...(sessionsResult.data || [])].filter((row: any) => row.is_vpn).length, (logs || []).length + (sessionsResult.data || []).length)
      },
      sourceAttribution: sourceAttribution([...(logs || []), ...(sessionsResult.data || [])])
    });
  } catch (err) {
    res.status(400).json({ error: "دریافت آمار ناموفق بود" });
  }
});

router.get("/novels/:id", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    const { id } = req.params;
    const { data: novel, error } = await supabase
      .from("novels")
      .select("id, title, author_id, approved_by, author, cover_url, description, rating, reviews_count, views_count, bookmarks_count, status, approval_status, editor_note, genre, main_categories, sub_categories, warnings, tags, characters, age_rating, is_ai_generated, is_ai_assisted, is_completed")
      .eq("id", id)
      .single();
    if (error || !novel) return res.status(404).json({ error: "رمان مورد یافت نشد" });
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    if (!canManageNovel(user, novel)) {
      return res.status(403).json({ error: "دسترسی غیرمجاز" });
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const eightWeeksAgo = new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000).toISOString();
    const [
      logsResult,
      chapterSummaryResult,
      likesResult,
      bookmarksResult,
      reviewsResult,
      sessionsResult,
      suggestionEventsResult,
      novelCommentsResult
    ] = await Promise.all([
      supabase.from("analytics_logs").select("created_at, action_type, viewer_id, read_seconds, scroll_percentage, chapter_id, country_name, country_code, region_name, city_name, is_vpn, device_type, device_os, device_browser, ip_hash, source").eq("novel_id", id).gte("created_at", since),
      supabase.from("chapters").select("id, title, chapter_number, views_count, status, moderation_status, scheduled_at").eq("novel_id", id).order("chapter_number", { ascending: true }),
      supabase.from("novel_likes").select("id", { count: "exact", head: true }).eq("novel_id", id),
      supabase.from("bookmarks").select("id", { count: "exact", head: true }).eq("novel_id", id),
      supabase.from("reviews").select("id, rating, rating_overall, rating_style, rating_story, rating_grammar, rating_character, content, created_at").eq("novel_id", id),
      supabase.from("reading_sessions").select("created_at, read_seconds, scroll_percentage, user_id, chapter_id, country_name, country_code, region_name, city_name, is_vpn, device_type, device_os, device_browser, ip_hash, source, foreground_active").eq("novel_id", id).eq("foreground_active", true),
      supabase.from("suggestion_user_events").select("user_id, event_type, created_at").eq("novel_id", id).gte("created_at", since),
      supabase.from("chapter_comments").select("id, chapter_id, paragraph_id, content, created_at, deleted_at, moderation_status").eq("novel_id", id)
    ]);

    const uniqueReaders = new Set<string>();
    let readSeconds = 0;
    let scrollTotal = 0;
    let scrollSamples = 0;

    (logsResult.data || []).forEach((log: any) => {
      if (log.viewer_id) uniqueReaders.add(log.viewer_id);
      else if (log.ip_hash) uniqueReaders.add(`anon:${log.ip_hash}`);
      if (log.scroll_percentage !== null && log.scroll_percentage !== undefined) {
        scrollTotal += Number(log.scroll_percentage || 0);
        scrollSamples++;
      }
    });

    (sessionsResult.data || []).forEach((session: any) => {
      if (session.user_id) uniqueReaders.add(session.user_id);
      else if (session.ip_hash) uniqueReaders.add(`anon:${session.ip_hash}`);
      readSeconds += Number(session.read_seconds || 0);
      if (session.scroll_percentage !== null && session.scroll_percentage !== undefined) {
        scrollTotal += Number(session.scroll_percentage || 0);
        scrollSamples++;
      }
    });

    const chapters = chapterSummaryResult.data || [];
    const publishedChapterCount = chapters.filter((chapter: any) => isChapterVisibleToUser(chapter, false)).length;
    const firstViews = Number(chapters[0]?.views_count || 0);
    const chapterRetention = chapters.map((chapter: any) => ({
      chapterId: chapter.id,
      title: chapter.title,
      chapterNumber: chapter.chapter_number,
      views: Number(chapter.views_count || 0),
      retentionPercent: firstViews > 0 ? Math.round((Number(chapter.views_count || 0) / firstViews) * 100) : 0
    }));

    const logs = logsResult.data || [];
    const sessions = sessionsResult.data || [];
    const audienceRows = [...logs, ...sessions];
    const totalAudienceSignals = audienceRows.length;
    const viewRows = logs.filter((log: any) => log.action_type === "view");
    const completionSignals = sessions.filter((session: any) => Number(session.scroll_percentage || 0) >= 90).length;
    const returningReaderSessions = sessions.filter((session: any) => session.user_id).length;
    const avgReadMinutes = uniqueReaders.size ? Number((readSeconds / 60 / uniqueReaders.size).toFixed(1)) : 0;

    // ---- Overall novel analysis (author-facing) -------------------------
    const reviewRows = reviewsResult.data || [];
    const axisAverage = (values: number[]) => values.length ? Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(2)) : 0;
    const ratingAxes = {
      count: reviewRows.length,
      overall: axisAverage(reviewRows.map((r: any) => Number(r.rating_overall ?? r.rating ?? 0))),
      style: axisAverage(reviewRows.map((r: any) => Number(r.rating_style ?? 0))),
      story: axisAverage(reviewRows.map((r: any) => Number(r.rating_story ?? 0))),
      grammar: axisAverage(reviewRows.map((r: any) => Number(r.rating_grammar ?? 0))),
      character: axisAverage(reviewRows.map((r: any) => Number(r.rating_character ?? 0)))
    };

    const novelComments = (novelCommentsResult.data || []).filter((c: any) => c.deleted_at === null && c.moderation_status !== "hidden");
    const commentsByChapterMap = new Map<string, number>();
    let paragraphCommentCount = 0;
    novelComments.forEach((comment: any) => {
      if (comment.chapter_id) commentsByChapterMap.set(comment.chapter_id, (commentsByChapterMap.get(comment.chapter_id) || 0) + 1);
      if (comment.paragraph_id) paragraphCommentCount += 1;
    });
    const chapterMeta = new Map<string, any>(chapters.map((chapter: any) => [String(chapter.id), chapter] as const));
    const topCommentedChapters = [...commentsByChapterMap.entries()]
      .map(([chapterId, count]) => ({
        chapterId,
        title: chapterMeta.get(chapterId)?.title || "فصل",
        chapterNumber: chapterMeta.get(chapterId)?.chapter_number ?? null,
        count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Comments per week for the last 8 weeks (oldest first).
    const weeklyComments: { weekStart: string; count: number }[] = [];
    for (let weekIdx = 7; weekIdx >= 0; weekIdx -= 1) {
      const start = new Date(Date.now() - (weekIdx + 1) * 7 * 24 * 60 * 60 * 1000);
      const end = new Date(Date.now() - weekIdx * 7 * 24 * 60 * 60 * 1000);
      weeklyComments.push({
        weekStart: start.toISOString(),
        count: novelComments.filter((c: any) => {
          const at = new Date(c.created_at).getTime();
          return at >= start.getTime() && at < end.getTime();
        }).length
      });
    }
    const totalEngagements = Number(likesResult.count || 0) + Number(bookmarksResult.count || 0) + novelComments.length + reviewRows.length;
    const engagementRate = Number(novel.views_count || 0) > 0
      ? Number(((totalEngagements / Number(novel.views_count)) * 100).toFixed(1))
      : 0;

    res.json({
      novel: {
        id: novel.id,
        title: novel.title,
        rating: Number(novel.rating || 0),
        views: Number(novel.views_count || 0),
        publishedChapterCount,
        averageViews: calculateAverageViews(novel.views_count, publishedChapterCount),
        bookmarks: Number(novel.bookmarks_count || 0),
        reviews: Number(novel.reviews_count || reviewRows.length)
      },
      totals: {
        likes: likesResult.count || 0,
        bookmarks: bookmarksResult.count || 0,
        reviews: reviewRows.length,
        uniqueReaders: uniqueReaders.size,
        readSeconds,
        averageScroll: scrollSamples ? Math.round(scrollTotal / scrollSamples) : 0,
        averageReadMinutes: avgReadMinutes,
        completionRate: percent(completionSignals, sessions.length),
        returningReaderRate: percent(returningReaderSessions, sessions.length),
        vpnOrProxyRate: percent(audienceRows.filter((row: any) => row.is_vpn).length, totalAudienceSignals)
      },
      daily: dailySeries(logs),
      chapterRetention,
      funnel: buildFunnel(logs, sessions, suggestionEventsResult.data || []),
      cohorts: buildCohorts(sessions),
      sourceAttribution: sourceAttribution(audienceRows),
      audience: {
        countries: distribution(audienceRows, "country_name", totalAudienceSignals, 12),
        countryCodes: distribution(audienceRows, "country_code", totalAudienceSignals, 12),
        devices: distribution(audienceRows, "device_type", totalAudienceSignals, 8),
        operatingSystems: distribution(audienceRows, "device_os", totalAudienceSignals, 8),
        browsers: distribution(audienceRows, "device_browser", totalAudienceSignals, 8),
        regions: distribution(audienceRows.filter((row: any) => row.country_name !== "Untraceable"), "region_name", undefined, 10),
        cities: distribution(audienceRows.filter((row: any) => row.country_name !== "Untraceable"), "city_name", undefined, 10),
        vpnOrProxy: {
          count: audienceRows.filter((row: any) => row.is_vpn).length,
          percentage: percent(audienceRows.filter((row: any) => row.is_vpn).length, totalAudienceSignals),
          label: "وقتی نشانه‌های VPN، پروکسی یا شبکه میزبانی شناسایی شود، ترافیک به‌صورت «غیرقابل ردیابی» نمایش داده می‌شود."
        }
      },
      insights: {
        topCountry: distribution(audienceRows, "country_name", totalAudienceSignals, 1)[0]?.name || "بدون داده",
        topDevice: distribution(audienceRows, "device_type", totalAudienceSignals, 1)[0]?.name || "بدون داده",
        topBrowser: distribution(audienceRows, "device_browser", totalAudienceSignals, 1)[0]?.name || "بدون داده",
        viewsLast30Days: viewRows.length
      },
      ratingAxes,
      commentInsights: {
        totalComments: novelComments.length,
        paragraphComments: paragraphCommentCount,
        reviewsCount: reviewRows.length,
        engagementRate,
        topCommentedChapters,
        weeklyComments
      }
    });
  } catch (err) {
    console.error("Failed to fetch novel analytics:", err);
    res.status(400).json({ error: "دریافت تحلیل رمان ناموفق بود" });
  }
});

// Real-time system statistics aggregated from the live database
router.get("/system-stats", async (req, res) => {
  try {
    const { data: novelsData, error: novelsError } = await supabase
      .from('novels')
      .select('views_count');
      
    if (novelsError) throw novelsError;
    
    const { count: chaptersCount, error: chaptersError } = await supabase
      .from('chapters')
      .select('id', { count: 'exact', head: true });
      
    if (chaptersError) throw chaptersError;

    const totalViews = (novelsData || []).reduce((sum, n) => sum + (n.views_count || 0), 0);
    const totalChapters = chaptersCount || 0;

    res.json({ totalViews, totalChapters });
  } catch (err) {
    console.error("Failed to fetch system stats:", err);
    res.status(400).json({ error: "دریافت آمار سیستم ناموفق بود" });
  }
});

// Real-time leaderboard computed from the live database
router.get("/leaderboard", async (req, res) => {
  try {
    const { mode } = req.query; // 'rating' or 'views'
    let query = supabase.from('novels').select('*').eq('approval_status', 'approved');
    
    if (mode === 'views') {
      query = query.order('views_count', { ascending: false });
    } else {
      // Unrated novels must not appear in the rating leaderboard.
      query = query
        .gt('reviews_count', 0)
        .gt('rating', 0)
        .order('rating', { ascending: false });
    }
    
    const { data: novels, error } = await query.limit(5);
    if (error) throw error;

    const novelIds = (novels || []).map((novel: any) => novel.id);
    const chapterCounts = novelIds.length ? (await db.query(
      `SELECT novel_id,COUNT(*)::int AS count FROM chapters
        WHERE novel_id=ANY($1::text[]) AND lower(COALESCE(status,''))='published'
          AND COALESCE(moderation_status,'visible')='visible'
          AND (scheduled_at IS NULL OR scheduled_at<=timezone('utc'::text,now()))
        GROUP BY novel_id`,
      [novelIds],
    )).rows : [];
    const chapterCountMap = new Map(chapterCounts.map((row: any) => [String(row.novel_id), Number(row.count)]));
    const mapped = (novels || []).map((n: any) => ({
      id: n.id,
      title: n.title,
      author: n.author,
      coverUrl: n.cover_url,
      description: n.description,
      rating: Number(n.reviews_count || 0) > 0 ? Number(n.rating || 0) : 0,
      viewsCount: n.views_count || 0,
      publishedChapterCount: chapterCountMap.get(String(n.id)) || 0,
      averageViews: (chapterCountMap.get(String(n.id)) || 0) > 0
        ? Number((Number(n.views_count || 0) / Number(chapterCountMap.get(String(n.id)))).toFixed(2))
        : 0,
      genre: n.genre,
      status: n.status
    }));

    res.json(mapped);
  } catch (err) {
    console.error("Failed to fetch leaderboard:", err);
    res.status(400).json({ error: "دریافت جدول برترین‌ها ناموفق بود" });
  }
});

export default router;
