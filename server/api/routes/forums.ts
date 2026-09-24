import express from "express";
import { v4 as uuidv4 } from "uuid";
import { supabase } from "../../postgres";
import { getActiveUser, hasPermission, isOwnerUser, PERMISSIONS, requireVerifiedEmailForWriting } from "../../utils/auth";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { validateForumCategory } from "../../utils/taxonomy";
import { cache } from "../../utils/cache";
import { filterExistingColumns, filterPayloadToExistingColumns, runOptionalSchemaQueries } from "../../utils/dbSchema";
import crypto from "crypto";
import { getEffectiveEntitlements } from "../../utils/premiumEntitlements";
import { resolveUsername } from "../../utils/usernames";
import { createUserNotification } from "../../utils/notifications";

const interactionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, 
  max: 20, 
  message: { error: "درخواست‌های شما بیش از حد سریع است. لطفاً کمی آهسته‌تر باشید." }
});

const DEFAULT_FORUM_CATEGORIES = ["همه انجمن‌ها", "اعلانات", "مهارت نویسندگی", "گفت‌وگو درباره کلیشه‌ها", "پیشنهاد رمان", "گفت‌وگوی عمومی"];

function cleanText(input: string) {
  return sanitizeHtml(input || "", {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
    allowedSchemes: [],
    allowedSchemesByTag: {},
    allowedSchemesAppliedToAttributes: ['href', 'src', 'action'],
    allowProtocolRelative: false,
    transformTags: {
      '*': (tagName, attribs) => ({
        tagName: 'span',
        attribs: {}
      })
    }
  }).trim();
}

let forumSchemaReady: Promise<void> | null = null;
async function ensureForumSchema() {
  if (!forumSchemaReady) {
    forumSchemaReady = runOptionalSchemaQueries([
      `ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS content TEXT`,
      `ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS content TEXT`,
      `ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS category TEXT`,
      `ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS author TEXT`,
      `ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS author TEXT`,
      `ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS is_thread_body BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS is_original BOOLEAN DEFAULT FALSE`
      , `ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'approved'`
      , `ALTER TABLE forum_threads ALTER COLUMN approval_status SET DEFAULT 'pending_approval'`
      , `ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS approved_by TEXT REFERENCES users(id) ON DELETE SET NULL`
      , `ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`
    ]).catch((error) => {
      forumSchemaReady = null;
      throw error;
    });
  }
  return forumSchemaReady;
}

function resolveThreadContent(row: any) {
  return String(
    row?.content ??
    row?.body ??
    row?.description ??
    row?.message ??
    row?.text ??
    row?.post_content ??
    row?.initial_post ??
    ""
  ).trim();
}

function hasBodyColumn(payload: Record<string, any>) {
  return ["content", "body", "description", "message", "text", "post_content", "initial_post"].some((column) =>
    Object.prototype.hasOwnProperty.call(payload, column)
  );
}

function isThreadBodyPost(post: any, threadId: string) {
  const id = String(post?.id || "");
  const isThreadBody = post?.is_thread_body === true || post?.is_thread_body === 1 || String(post?.is_thread_body || "").toLowerCase() === "true";
  const isOriginal = post?.is_original === true || post?.is_original === 1 || String(post?.is_original || "").toLowerCase() === "true";
  return isThreadBody || isOriginal || id.startsWith(`fp-op-${threadId}`);
}

function normalizeForumCategoryValue(value: any) {
  return String(value?.name ?? value?.label ?? value?.title ?? value ?? "").trim();
}

function normalizeForumCategories(value: any) {
  const supplied = Array.isArray(value) ? value.map(normalizeForumCategoryValue).filter(Boolean) : [];
  const combined = ["همه انجمن‌ها", ...supplied.filter((category) => !["all categories", "همه انجمن‌ها"].includes(category.toLowerCase()))];
  const source = combined.length > 1 ? combined : DEFAULT_FORUM_CATEGORIES;
  const seen = new Set<string>();
  return source.filter((category) => {
    const key = category.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeForumThread(t: any, replyCount?: number) {
  const category = String(t?.category || t?.forum_id || "گفت‌وگوی عمومی").trim() || "گفت‌وگوی عمومی";
  const views = Number(t?.views || 0);
  return {
    id: t?.id,
    user_id: t?.user_id || t?.author_id || null,
    author_id: t?.author_id || t?.user_id || null,
    title: String(t?.title || "موضوع بدون عنوان"),
    content: resolveThreadContent(t),
    author: t?.users?.username || t?.author || t?.author_username || "ناشناخته",
    authorRole: t?.users?.role || t?.authorRole || t?.author_role || "Reader",
    replies: Math.max(0, Number(replyCount ?? (Array.isArray(t?.forum_posts) ? t.forum_posts.length : t?.replies || 0)) || 0),
    votes: Number(t?.votes || 0),
    views,
    category,
    timeAgo: t?.created_at || t?.timeAgo || new Date().toISOString(),
    isPinned: t?.is_pinned === 1 || t?.is_pinned === true || String(t?.is_pinned || "").toLowerCase() === "true",
    approvalStatus: t?.approval_status || "pending_approval",
    isHot: views > 100
  };
}

function forumActorKey(req: express.Request, user: any) {
  if (user?.id) return `user:${user.id}`;
  const raw = `${req.ip || req.socket.remoteAddress || "unknown"}:${req.headers["user-agent"] || "unknown"}`;
  return `anon:${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

function canModerateForums(user: any) {
  if (!user) return false;
  const role = String(user.role || "").toLowerCase().trim();
  return role === "owner" || role === "editor" || hasPermission(user, PERMISSIONS.FORUM_MODERATE);
}

async function getForumCooldownMinutes(): Promise<number> {
  const { data } = await supabase.from('settings').select('setting_value').eq('setting_key', 'systemSettings').single();
  if (!data?.setting_value) return 0;
  try {
    const settings = typeof data.setting_value === 'string' ? JSON.parse(data.setting_value) : data.setting_value;
    return Math.max(0, Number(settings.forumCooldown || 0));
  } catch {
    return 0;
  }
}

const createThreadSchema = z.object({
  category: z.string().min(1).max(100).optional(),
  title: z.string().min(3).max(120),
  content: z.string().min(1).max(10000)
});

const createPostSchema = z.object({
  content: z.string().min(1).max(10000)
});

const router = express.Router();

// ✅ NEW: Get forum categories (for frontend to sync)
router.get("/categories", async (req, res) => {
  try {
    // Try to get from forum_categories table first
    const { data: categories } = await supabase
      .from('forum_categories')
      .select('id, name, description, is_active')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (categories && categories.length > 0) {
      return res.json({ categories: normalizeForumCategories(categories) });
    }

    // Fallback: get from system settings
    const { data: settings } = await supabase
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'systemSettings')
      .single();

    if (settings?.setting_value) {
      const systemSettings = typeof settings.setting_value === 'string' 
        ? JSON.parse(settings.setting_value) 
        : settings.setting_value;
      
      return res.json({ categories: normalizeForumCategories(systemSettings.forumCategories) });
    }

    res.json({ categories: DEFAULT_FORUM_CATEGORIES });
  } catch (err) {
    res.json({ categories: DEFAULT_FORUM_CATEGORIES });
  }
});

// 0. Public endpoint to check if user verified 
router.get("/user/:username/verified", async (req, res) => {
  try {
    const username = cleanText(req.params.username || "").slice(0, 80);
    const targetUser = await resolveUsername(username);
    const bio = targetUser?.profile_bio || "";

    if (targetUser) {
      const premium = await getEffectiveEntitlements(targetUser.id).catch(() => ({ reader: false, writer: false }));
      return res.json({ 
        id: targetUser.id,
        username: targetUser.username,
        redirected: !!targetUser.redirected,
        profileUrl: `/authors/${encodeURIComponent(targetUser.username)}`,
        displayName: targetUser.nickname || targetUser.username,
        nickname: targetUser.nickname || null,
        avatar: targetUser.avatar || "",
        role: targetUser.role || "writer",
        verified_author: targetUser.verified_author || false, 
        verified_role: targetUser.verified_role || false,
        has_reader_premium: !!premium.reader,
        has_writer_premium: !!premium.writer,
        bio 
      });
    }
    res.json({ verified_author: false, verified_role: false, bio: "" });
  } catch(e) {
    res.json({ verified_author: false, verified_role: false, bio: "" });
  }
});

// 1. Get all forums
router.get("/", async (req, res) => {
  try {
    const { data: forumsList } = await supabase.from('forums').select('id, name, description, created_at').order('created_at', { ascending: true });
    res.json(forumsList || []);
  } catch (err) {
    res.status(400).json({ error: "بارگذاری انجمن‌ها ناموفق بود." });
  }
});

// 2. Get threads in a forum
router.get("/board/:forumId/threads", async (req, res) => {
  try {
    await ensureForumSchema();
    const viewer = await getActiveUser(req, false);
    const { forumId } = req.params;
    const { data: threads } = await supabase
      .from('forum_threads')
      .select('*, users!inner(username, role)')
      .eq('forum_id', forumId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
      
    // Transform to the same public schema used by the global endpoint.
    const formatted = (threads || [])
      .filter((thread: any) => String(thread.approval_status || "pending_approval").toLowerCase() === "approved" || (!!viewer && (thread.user_id === viewer.id || canModerateForums(viewer))))
      .map((t: any) => normalizeForumThread(t));

    res.json(formatted);
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: "بارگذاری موضوع‌ها ناموفق بود" });
  }
});

// GET all threads globally
router.get("/threads", async (req, res) => {
  try {
    await ensureForumSchema();
    const viewer = await getActiveUser(req, false);
    const { data: threads } = await supabase
      .from('forum_threads')
      .select('*, users!inner(username, role), forum_posts(id)')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
    
    const visibleThreads = (threads || []).filter((thread: any) =>
      String(thread.approval_status || "pending_approval").toLowerCase() === "approved" ||
      (!!viewer && (thread.user_id === viewer.id || canModerateForums(viewer)))
    );
    const finalItems = visibleThreads.map((t: any) => normalizeForumThread(t));

    const threadIds = finalItems.map((item) => item.id).filter(Boolean);
    if (threadIds.length) {
      try {
        const postColumns = await filterExistingColumns('forum_posts', [
          'id',
          'thread_id',
          'content',
          'body',
          'description',
          'message',
          'text',
          'post_content',
          'initial_post',
          'is_thread_body',
          'is_original'
        ]);
        if (postColumns.includes('id') && postColumns.includes('thread_id')) {
          const { data: relatedPosts } = await supabase
            .from('forum_posts')
            .select(postColumns.join(', '))
            .in('thread_id', threadIds);
          const bodyContentByThread = new Map<string, string>();
          const replyCountsByThread = new Map<string, number>();
          (relatedPosts || []).forEach((post: any) => {
            const postThreadId = String(post.thread_id || "");
            if (!postThreadId) return;
            if (isThreadBodyPost(post, postThreadId)) {
              const content = resolveThreadContent(post);
              if (content && !bodyContentByThread.has(postThreadId)) {
                bodyContentByThread.set(postThreadId, content);
              }
              return;
            }
            replyCountsByThread.set(postThreadId, (replyCountsByThread.get(postThreadId) || 0) + 1);
          });

          finalItems.forEach((item) => {
            if (!item.content && bodyContentByThread.has(item.id)) {
              item.content = bodyContentByThread.get(item.id) || "";
            }
            if (replyCountsByThread.has(item.id)) {
              item.replies = replyCountsByThread.get(item.id) || 0;
            }
          });
        }
      } catch (postLookupError) {
        console.warn("[forums] Failed to hydrate thread body fallbacks", postLookupError);
      }
    }

    res.json(finalItems);
  } catch (err) {
    res.status(400).json({ error: "بارگذاری موضوع‌ها ناموفق بود" });
  }
});

// POST to create a thread
router.post("/threads", interactionLimiter, async (req, res) => {
  try {
    await ensureForumSchema();
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    const emailGateError = await requireVerifiedEmailForWriting(user);
    if (emailGateError) return res.status(403).json({ error: emailGateError });

    const parsed = createThreadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "ورودی نامعتبر است" });
    }

    const { category, title: rawTitle, content: rawContent } = parsed.data;
    const title = cleanText(rawTitle);
    const content = cleanText(rawContent);
    if (!title || !content) {
      return res.status(400).json({ error: "عنوان و متن موضوع الزامی است." });
    }
    const forum_id = await validateForumCategory(category || "گفت‌وگوی عمومی");
    if (forum_id.toLowerCase() === "announcements" && !hasPermission(user, PERMISSIONS.FORUM_ANNOUNCE)) {
      return res.status(403).json({ error: "برای ایجاد موضوع اعلان، مجوز لازم است." });
    }
    const id = `ft-${uuidv4()}`;
    const createdAt = new Date().toISOString();
    const cooldownMin = await getForumCooldownMinutes();

    if (cooldownMin > 0) {
      const { data: latestThread } = await supabase
        .from('forum_threads')
        .select('created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (latestThread?.created_at) {
        const elapsed = (Date.now() - new Date(latestThread.created_at).getTime()) / 60000;
        if (elapsed < cooldownMin) {
          return res.status(429).json({ error: `لطفاً ${Math.ceil(cooldownMin - elapsed)} دقیقه دیگر تا ایجاد موضوع بعدی صبر کنید.` });
        }
      }
    }
    
    const threadPayload = await filterPayloadToExistingColumns('forum_threads', {
      id,
      forum_id,
      category: forum_id,
      user_id: user.id,
      author_id: user.id,
      author: user.username,
      title,
      content,
      body: content,
      description: content,
      message: content,
      text: content,
      post_content: content,
      initial_post: content,
      views: 0,
      votes: 0,
      approval_status: "pending_approval",
      created_at: createdAt,
      updated_at: createdAt
    });
    const { error: insertError } = await supabase.from('forum_threads').insert(threadPayload);
    
    if (insertError) throw insertError;

    if (!hasBodyColumn(threadPayload)) {
      const originalPostPayload = await filterPayloadToExistingColumns('forum_posts', {
        id: `fp-op-${id}`,
        thread_id: id,
        user_id: user.id,
        author_id: user.id,
        author: user.username,
        content,
        body: content,
        description: content,
        message: content,
        text: content,
        parent_id: null,
        reply_depth: 0,
        is_thread_body: true,
        is_original: true,
        created_at: createdAt,
        updated_at: createdAt
      });
      if (hasBodyColumn(originalPostPayload)) {
        const { error: bodyPostError } = await supabase.from('forum_posts').insert(originalPostPayload);
        if (bodyPostError) throw bodyPostError;
      }
    }

    await internalAwardXP(user.id, 5, "post_thread");
    res.json({
      success: true,
      id,
      thread: {
        id,
        user_id: user.id,
        author_id: user.id,
        title,
        content,
        author: user.username,
        authorRole: user.role || "Author",
        replies: 0,
        votes: 0,
        views: 0,
        category: forum_id,
        approvalStatus: "pending_approval",
        timeAgo: createdAt,
        created_at: createdAt
      }
    });
  } catch (err: any) {
    if (err?.code === "NOVEL_TAXONOMY_INVALID" && err?.field === "category") {
      return res.status(422).json({
        error: err.message,
        code: err.code,
        field: err.field,
        invalidValue: err.invalidValue,
      });
    }
    // Only forward intentionally-authored Persian messages; raw driver errors
    // must never fingerprint the schema to clients.
    const msg = String(err?.message || "");
    const safeMessage = msg && /[\u0600-\u06FF]/.test(msg) && msg.length < 300 ? msg : "ایجاد موضوع ناموفق بود.";
    res.status(400).json({ error: safeMessage });
  }
});

async function moderateThread(req: express.Request, res: express.Response, status: "approved" | "rejected") {
  const statusLabelFa = status === "approved" ? "تأییدشده" : "ردشده";
  try {
    await ensureForumSchema();
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "ورود لازم است." });
    if (!canModerateForums(user)) return res.status(403).json({ error: "مجوز مدیریت انجمن لازم است." });

    // Moderation queues can stay open while another moderator deletes a thread.
    // Check the current database state before attempting to update a stale item.
    const { data: existingThread, error: lookupError } = await supabase
      .from("forum_threads")
      .select("id")
      .eq("id", req.params.threadId)
      .single();
    if (lookupError && lookupError.code !== "PGRST116") {
      console.error("[forums] Failed to check thread before moderation", lookupError);
      return res.status(500).json({ error: "بررسی وجود موضوع ممکن نشد." });
    }
    if (!existingThread) {
      await cache.del("forum_threads");
      return res.status(404).json({ error: "موضوع دیگر وجود ندارد.", missing: true });
    }

    const now = new Date().toISOString();
    const updates = status === "approved"
      ? { approval_status: status, approved_by: user.id, approved_at: now }
      : { approval_status: status, approved_by: null, approved_at: null };
    const safeUpdates = await filterPayloadToExistingColumns("forum_threads", updates);
    if (!Object.prototype.hasOwnProperty.call(safeUpdates, "approval_status")) {
      return res.status(503).json({ error: "تأیید موضوع تا زمان به‌روزرسانی ساختار انجمن در دسترس نیست." });
    }
    const { data, error } = await supabase.from("forum_threads").update(safeUpdates).eq("id", existingThread.id).select("*").single();
    if (error && error.code !== "PGRST116") {
      console.error("[forums] Failed to moderate thread", error);
      return res.status(500).json({ error: error.message || `تغییر وضعیت موضوع به «${statusLabelFa}» ممکن نشد.` });
    }
    // It may have been deleted between the existence check and the update.
    if (!data) {
      await cache.del("forum_threads");
      return res.status(404).json({ error: "موضوع دیگر وجود ندارد.", missing: true });
    }
    await cache.del("forum_threads");
    return res.json({ success: true, thread: normalizeForumThread(data) });
  } catch (error: any) {
    console.error("[forums] Unexpected thread moderation failure", error);
    return res.status(500).json({ error: `تغییر وضعیت موضوع به «${statusLabelFa}» ممکن نشد.` });
  }
}

router.patch("/threads/:threadId/approve", interactionLimiter, (req, res) => moderateThread(req, res, "approved"));

router.patch("/threads/:threadId/reject", interactionLimiter, (req, res) => moderateThread(req, res, "rejected"));

// GET thread with its posts
router.get("/threads/:threadId", async (req, res) => {
  try {
    await ensureForumSchema();
    const { threadId } = req.params;
    const user = await getActiveUser(req, false);
    const { data: threadData } = await supabase
      .from('forum_threads')
      .select('*, users!inner(username, role, avatar)')
      .eq('id', threadId)
      .single();
    
    if (!threadData) return res.status(404).json({ error: "موضوع مورد یافت نشد" });
    const threadIsApproved = String(threadData.approval_status || "pending_approval").toLowerCase() === "approved";
    if (!threadIsApproved && (!user || (threadData.user_id !== user.id && !canModerateForums(user)))) {
      return res.status(404).json({ error: "موضوع مورد یافت نشد" });
    }

    const publicThread = normalizeForumThread(threadData);
    const thread = {
      ...threadData,
      ...publicThread,
      content: publicThread.content,
      author_username: publicThread.author,
      author_role: publicThread.authorRole,
      avatar: threadData.users?.avatar
    };

    const actorKey = forumActorKey(req, user);
    const rate = await cache.rateLimit(`forum:view:rate:${actorKey}`, 300, 60 * 60);
    const shouldCountView = rate.allowed && await cache.markOnce(`forum:view:${actorKey}:${threadId}`, 30 * 60);

    if (shouldCountView) {
      try {
        const { error: rpcError } = await supabase.rpc('increment_views', { row_id: threadId });
        if (rpcError) throw rpcError;
      } catch {
        // Fallback if RPC doesn't exist
        await supabase.from('forum_threads').update({ views: (thread.views || 0) + 1 }).eq('id', threadId);
      }
    }

    const { data: postsData } = await supabase
      .from('forum_posts')
      .select('*, users!inner(username, role, avatar)')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });

    const allPosts = (postsData || []).map((p: any) => ({
      ...p,
      content: resolveThreadContent(p),
      author_username: p.users?.username,
      author_role: p.users?.role,
      avatar: p.users?.avatar,
      replies: [] // Will be populated with nested replies
    }));
    const bodyPost = allPosts.find((post: any) => isThreadBodyPost(post, threadId));
    const threadWithContent = {
      ...thread,
      content: thread.content || (bodyPost ? resolveThreadContent(bodyPost) : "")
    };
    const visiblePosts = allPosts.filter((post: any) => !isThreadBodyPost(post, threadId));

    // Build nested structure: top-level posts contain their replies
    const postsById = new Map(visiblePosts.map(p => [p.id, p]));
    const topLevelPosts = visiblePosts.filter(p => !p.parent_id);
    
    visiblePosts.forEach(post => {
      if (post.parent_id && postsById.has(post.parent_id)) {
        const parentPost = postsById.get(post.parent_id) as any;
        if (!Array.isArray(parentPost.replies)) {
          parentPost.replies = [];
        }
        parentPost.replies.push(post);
      }
    });

    res.json({ thread: threadWithContent, posts: topLevelPosts });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "دریافت موضوع ناموفق بود" });
  }
});

router.delete("/threads/:threadId", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    const { threadId } = req.params;
    const { data: thread } = await supabase
      .from("forum_threads")
      .select("user_id, author_id")
      .eq("id", threadId)
      .single();
    if (!thread) return res.status(404).json({ error: "موضوع مورد یافت نشد" });

    const normalizedRole = String(user.role || "").toLowerCase().trim();
    const ownsThread = thread.user_id === user.id || thread.author_id === user.id;
    if (!ownsThread && !["owner", "publisher", "editor"].includes(normalizedRole)) {
      return res.status(403).json({ error: "دسترسی غیرمجاز" });
    }

    await supabase.from("forum_posts").delete().eq("thread_id", threadId);
    const { error: deleteError } = await supabase.from("forum_threads").delete().eq("id", threadId);
    if (deleteError) throw deleteError;
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "حذف موضوع ناموفق بود" });
  }
});

// POST a vote to a thread
router.post("/threads/:threadId/vote", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });

    const { threadId } = req.params;
    const { data: threadBeforeVote } = await supabase.from('forum_threads').select('id, votes').eq('id', threadId).single();
    if (!threadBeforeVote) return res.status(404).json({ error: "موضوع مورد یافت نشد" });
    
    const { error: voteError } = await supabase
      .from("forum_thread_votes")
      .insert({ thread_id: threadId, user_id: user.id });

    if (voteError) {
      if (voteError.code === "23505") {
        return res.status(400).json({ error: "قبلاً رأی داده‌اید" });
      }
      // fallback if table does not exist
      const voteKey = `vote_${threadId}_${user.id}`;
      const { data: existingVote } = await supabase.from('settings').select('setting_value').eq('setting_key', voteKey).single();
      if (existingVote) {
         return res.status(400).json({ error: "قبلاً رأی داده‌اید" });
      }
      if(threadBeforeVote) {
         await supabase.from('forum_threads').update({ votes: (threadBeforeVote.votes || 0) + 1 }).eq('id', threadId);
         await supabase.from('settings').upsert({ setting_key: voteKey, setting_value: "1" });
      }
    } else {
      const { error: rpcError } = await supabase.rpc("increment_thread_votes", { p_thread_id: threadId });
      if (rpcError) {
        await supabase.from('forum_threads').update({ votes: (threadBeforeVote.votes || 0) + 1 }).eq('id', threadId);
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "ثبت رأی ناموفق بود" });
  }
});

// POST a reply to a thread
router.post("/threads/:threadId/posts", interactionLimiter, async (req, res) => {
  try {
    await ensureForumSchema();
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    const emailGateError = await requireVerifiedEmailForWriting(user);
    if (emailGateError) return res.status(403).json({ error: emailGateError });

    const { threadId } = req.params;
    const { parentId } = req.body;
    
    const parsed = createPostSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "محتوای نامعتبر است" });

    const content = cleanText(parsed.data.content);
    if (!content) return res.status(400).json({ error: "متن الزامی است" });

    const { data: threadInfo } = await supabase.from('forum_threads').select('user_id, title').eq('id', threadId).single();
    if (!threadInfo) return res.status(404).json({ error: "موضوع مورد یافت نشد" });

    // Validate parent post exists if replying to a comment
    let replyDepth = 0;
    if (parentId) {
      const { data: parentPost } = await supabase.from('forum_posts').select('thread_id, reply_depth, user_id').eq('id', parentId).single();
      if (!parentPost) return res.status(404).json({ error: "پاسخ والد مورد یافت نشد" });
      if (parentPost.thread_id !== threadId) return res.status(400).json({ error: "پاسخ والد به این موضوع تعلق ندارد" });
      
      // Limit reply nesting to 5 levels to prevent UI issues
      replyDepth = Math.min((parentPost.reply_depth || 0) + 1, 5);
    }

    const id = `fp-${uuidv4()}`;
    const createdAt = new Date().toISOString();
    const postPayload = await filterPayloadToExistingColumns('forum_posts', {
      id, 
      thread_id: threadId, 
      user_id: user.id, 
      author_id: user.id, 
      author: user.username, 
      content,
      body: content,
      description: content,
      message: content,
      text: content,
      parent_id: parentId || null,
      reply_depth: replyDepth,
      created_at: createdAt,
      updated_at: createdAt
    });
    if (!hasBodyColumn(postPayload)) {
      return res.status(400).json({ error: "ستون محتوای پاسخ انجمن در دسترس نیست." });
    }
    const { error: insertError } = await supabase.from('forum_posts').insert(postPayload);
    if (insertError) throw insertError;
    
    await internalAwardXP(user.id, 2, "forum_reply");

    // Notification to Thread Owner (only for top-level replies)
    if (!parentId) {
      if (threadInfo && threadInfo.user_id !== user.id) {
         const safePreview = cleanText(content).slice(0, 100);
         await createUserNotification(threadInfo.user_id, "forum_reply", "پاسخ انجمن", `${user.username} به موضوع شما «${cleanText(threadInfo.title)}» پاسخ داد: ${safePreview}`, "/forums", "notify_replies");
      }
    } else {
      // Notification to parent post author for nested replies
      const { data: parentPost } = await supabase.from('forum_posts').select('user_id, author').eq('id', parentId).single();
      if (parentPost && parentPost.user_id !== user.id) {
        const { data: threadInfo } = await supabase.from('forum_threads').select('title').eq('id', threadId).single();
        const safePreview = cleanText(content).slice(0, 100);
        await createUserNotification(parentPost.user_id, "forum_reply", "پاسخ انجمن", `${user.username} به پاسخ شما در موضوع «${cleanText(threadInfo?.title || 'ناشناخته')}» پاسخ داد: ${safePreview}`, "/forums", "notify_replies");
      }
    }

    res.json({
      success: true,
      id,
      post: {
        id,
        thread_id: threadId,
        user_id: user.id,
        author_id: user.id,
        author: user.username,
        author_username: user.username,
        author_role: user.role || "writer",
        content,
        parent_id: parentId || null,
        reply_depth: replyDepth,
        created_at: createdAt,
        replies: []
      }
    });
  } catch (err: any) {
    console.error("[forums] Error posting reply", err?.message || err);
    const msg = String(err?.message || "");
    res.status(400).json({ error: msg && /[\u0600-\u06FF]/.test(msg) && msg.length < 300 ? msg : "ارسال پاسخ ناموفق بود" });
  }
});

// DELETE a post (Admin only or Owner)
router.delete("/posts/:postId", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });

    const { postId } = req.params;
    const { data: post } = await supabase.from('forum_posts').select('id, user_id, thread_id, is_thread_body, is_original').eq('id', postId).single();
    if (!post) return res.status(404).json({ error: "مورد یافت نشد" });
    if (isThreadBodyPost(post, post.thread_id)) return res.status(403).json({ error: "متن اصلی موضوع به‌عنوان پاسخ قابل حذف نیست." });

    const normalizedRole = String(user.role || "").toLowerCase().trim();
    if (!["owner", "publisher", "editor"].includes(normalizedRole) && user.id !== post.user_id) {
       return res.status(403).json({ error: "دسترسی غیرمجاز" });
    }

    await supabase.from('forum_posts').delete().eq('id', postId);
    res.json({ success: true });
  } catch(err) {
    res.status(400).json({ error: "ناموفق بود" });
  }
});

// Admin Pin endpoint
router.post("/:type/:id/pin", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    const normalizedRole = String(user.role || "").toLowerCase().trim();
    if (!["owner", "publisher", "editor"].includes(normalizedRole)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    
    const { type, id } = req.params;
    let nextPinned = false;
    if (type === "threads") {
      const { data: thread } = await supabase.from('forum_threads').select('is_pinned').eq('id', id).single();
      if(!thread) return res.status(404).json({ error: "موضوع مورد یافت نشد" });
      nextPinned = !(thread.is_pinned === 1 || thread.is_pinned === true || String(thread.is_pinned || "").toLowerCase() === "true");
      const { error } = await supabase.from('forum_threads').update({ is_pinned: nextPinned ? 1 : 0 }).eq('id', id);
      if (error) throw error;
    } else if (type === "posts") {
      const { data: post } = await supabase.from('forum_posts').select('is_pinned').eq('id', id).single();
      if(!post) return res.status(404).json({ error: "پاسخ مورد یافت نشد" });
      nextPinned = !(post.is_pinned === 1 || post.is_pinned === true || String(post.is_pinned || "").toLowerCase() === "true");
      const { error } = await supabase.from('forum_posts').update({ is_pinned: nextPinned ? 1 : 0 }).eq('id', id);
      if (error) throw error;
    } else {
      return res.status(400).json({ error: "نوع نامعتبر است" });
    }
    res.json({ success: true, isPinned: nextPinned });
  } catch(err) {
    res.status(400).json({ error: "سنجاق کردن ناموفق بود" });
  }
});

export async function internalAwardXP(userId: string, amount: number, source: string) {
    try {
      const { data: user, error: fetchError } = await supabase.from('users').select('xp, level').eq('id', userId).single();
      if (fetchError || !user) {
        console.error("Failed to fetch user for XP award:", fetchError);
        return;
      }
      
      let newXp = (user.xp || 0) + amount;
      let newLevel = (user.level || 1);
      
      // Simple scaling loop
      while (newXp >= 100) {
        newXp -= 100;
        newLevel++;
      }
      
      await supabase.from('users').update({ xp: newXp, level: newLevel }).eq('id', userId);
    } catch (err) {
      console.error("Failed to award XP internally:", err);
    }
}

export default router;
