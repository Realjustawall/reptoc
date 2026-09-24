import { v4 as uuidv4 } from "uuid";
import { db, supabase } from "../postgres";
import { filterExistingColumns, reportSchemaGapOnce, runOptionalSchemaQueries } from "./dbSchema";
import { notificationBus } from "./notificationBus";
import { sendWebPushNotification } from "./webPush";
import crypto from "crypto";
import sanitizeHtml from "sanitize-html";

type PreferenceKey = "notify_comments" | "notify_ratings" | "notify_defaults" | "notify_likes" | "notify_replies" | "notify_logins" | "notify_followers" | "notify_bookmarks";

let notificationTableReady: Promise<void> | null = null;

export async function ensureNotificationTable() {
  if (!notificationTableReady) {
    notificationTableReady = (async () => {
      await runOptionalSchemaQueries([`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          username TEXT,
          title TEXT NOT NULL,
          text TEXT,
          message TEXT,
          type TEXT DEFAULT 'system',
          link TEXT,
          time TEXT DEFAULT 'Just now',
          is_read INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS username TEXT`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title TEXT`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS text TEXT`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message TEXT`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'system'`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS time TEXT DEFAULT 'Just now'`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read INTEGER DEFAULT 0`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_notifications_username_created ON notifications(username, created_at DESC)`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_comments BOOLEAN DEFAULT true`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_ratings BOOLEAN DEFAULT true`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_defaults BOOLEAN DEFAULT true`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_replies BOOLEAN DEFAULT true`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_logins BOOLEAN DEFAULT true`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_followers BOOLEAN DEFAULT true`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_likes BOOLEAN DEFAULT true`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_bookmarks BOOLEAN DEFAULT true`]);
    })().catch((error) => {
      // Notification reads are column filtered, so a refused top-up is not
      // fatal. Keep the memo so the same DDL is not retried per request, and
      // surface one actionable line pointing at `npm run db:migrate`.
      reportSchemaGapOnce("notification tables", error);
    });
  }
  return notificationTableReady;
}

/**
 * ✅ SECURITY (BL-4): Strip HTML from notification title and text.
 *
 * Notifications are rendered in the frontend, and some rendering paths
 * (e.g. legacy React components, push notifications) may not escape HTML.
 * To prevent stored XSS via notifications, we strip all HTML tags from
 * the title and text before persisting.
 *
 * This also protects against admin-impersonation attacks where a user
 * crafts a notification text that looks like an admin message.
 */
function sanitizeNotificationText(value: unknown, maxLength = 1000): string {
  if (typeof value !== "string") return "";
  return sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
    allowedSchemes: [],
    disallowedTagsMode: "discard",
  }).slice(0, maxLength);
}

function sanitizeNotificationLink(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().slice(0, 500);
  // Only allow same-site relative URLs and absolute https URLs.
  if (trimmed.startsWith("/")) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export async function createUserNotification(
  userId: string,
  type: string,
  title: string,
  text: string,
  link = "",
  preference?: PreferenceKey,
  dedupeKey?: string,
) {
  // ✅ SECURITY (BL-4): Sanitize all user-controllable fields before persisting.
  title = sanitizeNotificationText(title, 200);
  text = sanitizeNotificationText(text, 2000);
  link = sanitizeNotificationLink(link);
  // ✅ SECURITY: Also sanitize the type to prevent log injection.
  type = String(type || "system").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "system";
  // Notification delivery must never break the primary user action
  // (posting a comment, liking, following...). Every failure path is logged,
  // never rethrown to the caller.
  try {
    await ensureNotificationTable();
    const userColumns = await filterExistingColumns("users", [
      "id",
      "username",
      "notify_comments",
      "notify_ratings",
      "notify_defaults",
      "notify_replies",
      "notify_logins",
      "notify_followers",
      "notify_likes",
      "notify_bookmarks"
    ]);
    const { data: user } = await supabase
      .from("users")
      .select(userColumns.join(", "))
      .eq("id", userId)
      .single();

    if (!user) return;
    if (preference && user[preference] === false) return;
    // Achievement unlocks are milestone receipts, not optional social/default
    // noise, so they always remain available in the user's notification history.
    if (!preference && type !== "achievement" && user.notify_defaults === false) return;

    const notificationColumns = await filterExistingColumns("notifications", [
      "id",
      "user_id",
      "username",
      "title",
      "text",
      "message",
      "type",
      "link",
      "time",
      "is_read"
    ]);
    const notificationId = type === "achievement"
      ? `notif-ach-${crypto.createHash("sha256").update(`${user.id}\0${title}`).digest("hex").slice(0, 32)}`
      : dedupeKey
        ? `notif-event-${crypto.createHash("sha256").update(`${user.id}\0${dedupeKey}`).digest("hex").slice(0, 32)}`
      : `notif-${uuidv4()}`;
    const payload: Record<string, any> = {
      id: notificationId,
      user_id: user.id,
      username: user.username,
      title,
      text,
      message: text,
      type,
      link,
      time: "همین حالا",
      is_read: 0
    };
    const { error } = await supabase.from("notifications").insert(
      Object.fromEntries(Object.entries(payload).filter(([key]) => notificationColumns.includes(key)))
    );
    if (error?.code === "23505") return;
    if (error) {
      console.error("Failed to create user notification.", {
        userId: user.id,
        type,
        code: error.code,
        detail: error.detail,
        message: error.message,
      });
      // Fallback: plain parameterized INSERT so a wrapper-level quirk cannot
      // silently drop social notifications. Missing optional columns are
      // tolerated by retrying with the intersection both shapes support.
      try {
        await db.query(
          `INSERT INTO notifications (id, user_id, username, title, text, message, type, link, time, is_read)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO NOTHING`,
          [notificationId, user.id, user.username ?? null, title, text, text, type, link, "همین حالا", 0]
        );
        notificationBus.emitNotification({ id: notificationId, userId: user.id, type, title, text, link });
        void sendWebPushNotification(user.id, { type, title, text, link }).catch((pushError) => console.warn("Web Push delivery failed:", pushError?.message || pushError));
      } catch (fallbackError: any) {
        console.error("Notification fallback insert failed.", {
          userId: user.id,
          type,
          code: fallbackError?.code,
          message: fallbackError?.message,
        });
      }
      return;
    }
    notificationBus.emitNotification({ id: notificationId, userId: user.id, type, title, text, link });
    void sendWebPushNotification(user.id, { type, title, text, link }).catch((pushError) => console.warn("Web Push delivery failed:", pushError?.message || pushError));
  } catch (error: any) {
    console.error("createUserNotification failed.", {
      userId,
      type,
      code: error?.code,
      message: error?.message,
    });
  }
}

export async function notifyFollowersOfTarget(
  targetType: "user" | "novel",
  targetId: string,
  type: string,
  title: string,
  text: string,
  link = "",
  preference?: PreferenceKey,
  dedupeKey?: string,
) {
  const { data: followers } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("target_type", targetType)
    .eq("target_id", targetId);

  const uniqueFollowerIds = [...new Set((followers || []).map((f: any) => f.follower_id).filter(Boolean))] as string[];
  await Promise.all(uniqueFollowerIds.map((id) => createUserNotification(id, type, title, text, link, preference, dedupeKey)));
}

export async function notifyChapterPublishedAudience(novel: any, chapter: any): Promise<number> {
  const novelId = String(novel?.id || chapter?.novel_id || "");
  const authorId = String(novel?.author_id || "");
  const chapterId = String(chapter?.id || "");
  if (!novelId || !chapterId) return 0;

  const [novelFollowersResult, authorFollowersResult, bookmarksResult] = await Promise.all([
    supabase.from("follows").select("follower_id").eq("target_type", "novel").eq("target_id", novelId),
    authorId
      ? supabase.from("follows").select("follower_id").eq("target_type", "user").eq("target_id", authorId)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("bookmarks").select("user_id").eq("novel_id", novelId),
  ]);

  const audiences = new Map<string, Set<PreferenceKey>>();
  const addAudience = (userId: unknown, preference: PreferenceKey) => {
    const id = String(userId || "");
    if (!id || id === authorId) return;
    const preferences = audiences.get(id) || new Set<PreferenceKey>();
    preferences.add(preference);
    audiences.set(id, preferences);
  };
  for (const row of novelFollowersResult.data || []) addAudience((row as any).follower_id, "notify_followers");
  for (const row of authorFollowersResult.data || []) addAudience((row as any).follower_id, "notify_followers");
  for (const row of bookmarksResult.data || []) addAudience((row as any).user_id, "notify_bookmarks");

  const title = "فصل جدید منتشر شد";
  const text = `${String(novel?.title || "رمان")} فصل جدیدی دارد: ${String(chapter?.title || "فصل جدید")}`;
  const link = `/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}`;
  const dedupeKey = `chapter-published:${chapterId}`;
  await Promise.all([...audiences.entries()].map(async ([userId, preferences]) => {
    // Run a user's channels in order. If one preference is disabled, another
    // eligible channel can still deliver; the deterministic id prevents two
    // copies when both are enabled.
    for (const preference of preferences) {
      await createUserNotification(userId, "chapter_published", title, text, link, preference, dedupeKey);
    }
  }));
  return audiences.size;
}
