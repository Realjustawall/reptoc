import { supabase } from "../postgres";
import { sendDiscordChapterPublishedAnnouncement } from "./discord";
import { invalidateNovelCaches } from "./catalogCache";
import { notifyChapterPublishedAudience } from "./notifications";

export function canManageNovel(user: any, novel: any) {
  if (!user || !novel) return false;
  const normalizedRole = String(user.role || "").toLowerCase().trim();
  if (novel.author_id === user.id) return true;
  if (["owner", "publisher"].includes(normalizedRole)) return true;
  return normalizedRole === "editor" && novel.approved_by === user.id;
}

export function isChapterVisibleToUser(chapter: any, canManage: boolean) {
  if (canManage) return true;
  if (String(chapter.status || "").trim().toLowerCase() !== "published") return false;
  if (String(chapter.moderation_status || "visible").trim().toLowerCase() !== "visible") return false;
  if (chapter.scheduled_at && new Date(chapter.scheduled_at).getTime() > Date.now()) return false;
  return true;
}

export function isNovelApprovedForPublic(novel: any): boolean {
  return String(novel?.approval_status || "").trim().toLowerCase() === "approved";
}

export function canUserViewNovel(novel: any, user: any): boolean {
  const normalizedRole = String(user?.role || "").toLowerCase().trim();
  if (user && ["owner", "publisher"].includes(normalizedRole)) {
    return true;
  }
  if (user && novel?.author_id === user.id) {
    return true;
  }
  if (user && normalizedRole === "editor" && canManageNovel(user, novel)) {
    return true;
  }
  return isNovelApprovedForPublic(novel);
}

/**
 * ✅ FIX B-1 & B-5: Batched queries + status guard in UPDATE.
 *
 * Previously, this function issued 4 queries per due chapter (novel lookup,
 * author lookup, chapter update, novel timestamp update), causing N+1 query
 * storms. It also updated chapter status without checking that the chapter
 * was still "Scheduled" between the SELECT and the UPDATE, allowing a race
 * where an admin's status change could be overwritten.
 *
 * Now:
 *   - All novel and author data is fetched in 2 batched queries up front.
 *   - The chapter UPDATE includes `.eq("status", "Scheduled")` so it only
 *     publishes chapters that are still scheduled.
 */
export async function publishDueScheduledChapters() {
  const now = new Date().toISOString();
  const { data: dueChapters } = await supabase
    .from("chapters")
    .select("id, novel_id, title, chapter_number, scheduled_at")
    .eq("status", "Scheduled")
    .lte("scheduled_at", now);

  if (!dueChapters || dueChapters.length === 0) return [];

  // ✅ FIX B-1: Batch-fetch all novels and authors in 2 queries instead of N.
  const novelIds = [...new Set(dueChapters.map(c => c.novel_id))];
  const { data: novels } = await supabase
    .from("novels")
    .select("id, title, author, author_id, genre, cover_url, approval_status")
    .in("id", novelIds);

  const authorIds = [...new Set((novels || []).map((n: any) => n.author_id).filter(Boolean))];
  const { data: authors } = await supabase
    .from("users")
    .select("id, publishing_blocked")
    .in("id", authorIds);

  const novelMap = new Map((novels || []).map((n: any) => [n.id, n]));
  const authorMap = new Map((authors || []).map((a: any) => [a.id, a]));

  const publishedNovelIds = new Set<string>();
  const publishedChapterNovelPairs: { novel: any; chapter: any }[] = [];

  for (const chapter of dueChapters) {
    const novel = novelMap.get(chapter.novel_id);
    if (!novel) continue;
    if (!isNovelApprovedForPublic(novel)) continue;

    const author = authorMap.get((novel as any).author_id) as any;
    if (author?.publishing_blocked === true || author?.publishing_blocked === 1) {
      continue;
    }

    // ✅ FIX B-5: Include `.eq("status", "Scheduled")` so we only update
    // chapters that are still scheduled. If an admin changed the status
    // between our SELECT and UPDATE, this UPDATE will match 0 rows and
    // we skip it safely.
    const { data: publishedChapter } = await supabase
      .from("chapters")
      .update({ status: "Published", editorial_status: "published", scheduled_at: null, published_at: now, updated_at: now })
      .eq("id", chapter.id)
      .eq("status", "Scheduled")
      .select("*")
      .single();

    if (publishedChapter) {
      publishedNovelIds.add(String(chapter.novel_id));
      publishedChapterNovelPairs.push({ novel, chapter: publishedChapter });
    }
  }

  // ✅ FIX B-1: Batch-update novel timestamps in a single query.
  if (publishedNovelIds.size > 0) {
    await supabase
      .from("novels")
      .update({ updated_at: now })
      .in("id", [...publishedNovelIds]);
  }

  // In-app delivery is awaited so a successful scheduler run represents the
  // complete release workflow. Discord remains a best-effort side channel.
  for (const { novel, chapter } of publishedChapterNovelPairs) {
    await notifyChapterPublishedAudience(novel, chapter).catch((err) => {
      console.warn("[notifications] Failed to announce scheduled chapter:", err?.message || err);
    });
    sendDiscordChapterPublishedAnnouncement(novel, chapter).catch((err) => {
      console.warn("[discord] Failed to announce scheduled chapter:", err?.message || err);
    });
  }

  if (publishedNovelIds.size) await invalidateNovelCaches();
  return [...publishedNovelIds];
}

export async function saveChapterVersion(chapter: any, changedBy: string, reason: string) {
  if (!chapter?.id) return;
  await supabase.from("chapter_versions").insert({
    id: `chv-${chapter.id}-${Date.now()}`,
    chapter_id: chapter.id,
    novel_id: chapter.novel_id,
    changed_by: changedBy,
    reason,
    title: chapter.title,
    content: chapter.content || "",
    author_notes_top: chapter.author_notes_top || "",
    author_notes_bottom: chapter.author_notes_bottom || "",
    status: chapter.status || "Draft",
    scheduled_at: chapter.scheduled_at || null,
    chapter_number: chapter.chapter_number || 1,
    word_count: chapter.word_count || 0
  });
}
