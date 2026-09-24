import express from "express";
import { supabase } from "../../postgres";
import { getActiveUser, requireVerifiedEmailForWriting } from "../../utils/auth";
import { canManageNovel, canUserViewNovel, isChapterVisibleToUser } from "../../utils/chapters";
import { invalidateNovelCaches } from "../../utils/catalogCache";
import { interactionLimiter } from "../limiters";
import { MEDIA_LIMITS } from "../../utils/mediaLifecycle";
import {
  MangaPageError,
  appendChapterPages,
  loadChapterPages,
  loadPageCounts,
  replaceChapterPages,
} from "../../utils/manga";
import { MANGA_MAX_PAGES_PER_CHAPTER, normalizeContentKind } from "../../../shared/manga";

/**
 * Manga page endpoints.
 *
 * Mounted under `/api/novels`, so a manga chapter's pages live next to that
 * chapter's comments and likes: `/api/novels/:novelId/chapters/:chapterId/pages`.
 * The page list is always sent and stored whole — that is what makes reorder,
 * insert, delete and replace one atomic write instead of a batch of fragile
 * per-page mutations.
 */
const router = express.Router();

interface MangaContext {
  novel: any;
  chapter: any;
  canManage: boolean;
}

async function loadContext(
  req: express.Request,
  res: express.Response,
  options: { requireManage: boolean },
): Promise<MangaContext | null> {
  const user = await getActiveUser(req, options.requireManage);
  (req as any).mangaUser = user;
  const novelId = String(req.params.novelId || "");
  const chapterId = String(req.params.chapterId || "");

  const { data: novel } = await supabase
    .from("novels")
    .select("id, author_id, author, approved_by, approval_status, title, content_kind, reading_direction")
    .eq("id", novelId)
    .single();
  if (!novel) {
    res.status(404).json({ error: "رمان یافت نشد." });
    return null;
  }
  if (!canUserViewNovel(novel, user)) {
    res.status(403).json({ error: "دسترسی غیرمجاز." });
    return null;
  }
  if (normalizeContentKind((novel as any).content_kind) !== "manga") {
    res.status(409).json({
      error: "این اثر مانگا نیست؛ صفحه‌های تصویری فقط برای مانگا قابل مدیریت است.",
      code: "NOT_A_MANGA",
    });
    return null;
  }

  const canManage = canManageNovel(user, novel);
  if (options.requireManage) {
    if (!user) {
      res.status(401).json({ error: "دسترسی غیرمجاز. دوباره وارد شوید." });
      return null;
    }
    if (!canManage) {
      res.status(403).json({ error: "فقط نویسنده یا تیم تحریریه می‌تواند صفحه‌ها را مدیریت کند." });
      return null;
    }
    if (user.publishing_blocked === true || user.publishing_blocked === 1) {
      res.status(403).json({ error: "انتشار برای این حساب توسط مدیر مسدود شده است." });
      return null;
    }
    const emailGateError = await requireVerifiedEmailForWriting(user);
    if (emailGateError) {
      res.status(403).json({ error: emailGateError });
      return null;
    }
  }

  if (!chapterId) return { novel, chapter: null, canManage };

  const { data: chapter } = await supabase
    .from("chapters")
    .select("*")
    .eq("id", chapterId)
    .eq("novel_id", novelId)
    .single();
  if (!chapter) {
    res.status(404).json({ error: "فصل یافت نشد." });
    return null;
  }
  if (!isChapterVisibleToUser(chapter, canManage)) {
    res.status(404).json({ error: "این فصل در دسترس نیست." });
    return null;
  }

  return { novel, chapter, canManage };
}

function ownerIdFor(context: MangaContext, req: express.Request): string {
  return String(context.novel.author_id || (req as any).mangaUser?.id || "");
}

function sendMangaError(res: express.Response, error: any, fallback: string) {
  if (error instanceof MangaPageError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error("[manga] request failed", { message: error?.message || error, code: error?.code });
  return res.status(400).json({ error: fallback });
}

/** Read the ordered pages of one manga chapter. */
router.get("/:novelId/chapters/:chapterId/pages", async (req, res) => {
  try {
    const context = await loadContext(req, res, { requireManage: false });
    if (!context) return;
    const pages = await loadChapterPages(String(req.params.chapterId));
    res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
    res.json({
      pages,
      pageCount: pages.length,
      readingDirection: String(context.novel.reading_direction || "rtl") === "ltr" ? "ltr" : "rtl",
      limits: { maxPages: MEDIA_LIMITS.mangaPagesPerChapter || MANGA_MAX_PAGES_PER_CHAPTER },
    });
  } catch (error: any) {
    sendMangaError(res, error, "بارگذاری صفحه‌های این فصل انجام نشد.");
  }
});

/**
 * Replace the whole page list.
 *
 * This is the endpoint the editor uses for reordering, deleting, replacing an
 * image and editing captions: it sends the list it wants to exist.
 */
router.put("/:novelId/chapters/:chapterId/pages", interactionLimiter, async (req, res) => {
  try {
    const context = await loadContext(req, res, { requireManage: true });
    if (!context) return;
    if (!Array.isArray(req.body?.pages)) {
      return res.status(400).json({ error: "فهرست صفحه‌ها ارسال نشده است.", code: "MANGA_PAGES_MISSING" });
    }

    const result = await replaceChapterPages(
      String(req.params.novelId),
      String(req.params.chapterId),
      req.body.pages,
      { ownerId: ownerIdFor(context, req) },
    );
    await invalidateNovelCaches(String(req.params.novelId));
    res.json({ success: true, ...result });
  } catch (error: any) {
    sendMangaError(res, error, "ذخیره صفحه‌های این فصل انجام نشد.");
  }
});

/** Append newly uploaded pages to the end of a chapter. */
router.post("/:novelId/chapters/:chapterId/pages", interactionLimiter, async (req, res) => {
  try {
    const context = await loadContext(req, res, { requireManage: true });
    if (!context) return;
    const incoming = Array.isArray(req.body?.pages)
      ? req.body.pages
      : req.body?.imageUrl
        ? [req.body]
        : null;
    if (!incoming || incoming.length === 0) {
      return res.status(400).json({ error: "صفحه‌ای برای افزودن ارسال نشده است.", code: "MANGA_PAGES_MISSING" });
    }

    const result = await appendChapterPages(
      String(req.params.novelId),
      String(req.params.chapterId),
      incoming,
      { ownerId: ownerIdFor(context, req) },
    );
    await invalidateNovelCaches(String(req.params.novelId));
    res.status(201).json({ success: true, ...result });
  } catch (error: any) {
    sendMangaError(res, error, "افزودن صفحه‌ها انجام نشد.");
  }
});

/** Remove a single page and close the gap in the numbering. */
router.delete("/:novelId/chapters/:chapterId/pages/:pageId", interactionLimiter, async (req, res) => {
  try {
    const context = await loadContext(req, res, { requireManage: true });
    if (!context) return;
    const pageId = String(req.params.pageId || "");
    const current = await loadChapterPages(String(req.params.chapterId));
    if (!current.some((page) => page.id === pageId)) {
      return res.status(404).json({ error: "صفحه یافت نشد." });
    }

    const result = await replaceChapterPages(
      String(req.params.novelId),
      String(req.params.chapterId),
      current
        .filter((page) => page.id !== pageId)
        .map((page) => ({
          id: page.id,
          imageUrl: page.imageUrl,
          width: page.width,
          height: page.height,
          altText: page.altText,
          isSpread: page.isSpread,
        })),
      { ownerId: ownerIdFor(context, req) },
    );
    await invalidateNovelCaches(String(req.params.novelId));
    res.json({ success: true, ...result });
  } catch (error: any) {
    sendMangaError(res, error, "حذف این صفحه انجام نشد.");
  }
});

/** Page totals per chapter, for the editor's chapter list. */
router.get("/:novelId/page-counts", async (req, res) => {
  try {
    const context = await loadContext(req, res, { requireManage: false });
    if (!context) return;
    const counts = await loadPageCounts(String(req.params.novelId));
    res.json({ counts: Object.fromEntries(counts) });
  } catch (error: any) {
    sendMangaError(res, error, "بارگذاری شمار صفحه‌ها انجام نشد.");
  }
});

export default router;
