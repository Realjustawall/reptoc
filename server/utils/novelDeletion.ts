import { db, supabase } from "../postgres";
import { deleteSuggestionNovelArtifacts } from "../suggestion/maintenance";
import { collectNovelFileIds, unlinkStoredUpload } from "./mediaLifecycle";

async function deleteWhere(table: string, column: string, value: string) {
  try {
    const { error } = await supabase.from(table).delete().eq(column, value);
    if (error) throw error;
  } catch (error: any) {
    const code = String(error?.code || "");
    const message = String(error?.message || error || "");
    if (!["42P01", "42703", "PGRST204", "PGRST205"].includes(code) && !/does not exist|schema cache|column/i.test(message)) {
      console.warn(`[novel-delete] skipped ${table}.${column}`, message);
    }
  }
}

async function deleteWherePair(table: string, firstColumn: string, firstValue: string, secondColumn: string, secondValue: string) {
  try {
    const { error } = await supabase.from(table).delete().eq(firstColumn, firstValue).eq(secondColumn, secondValue);
    if (error) throw error;
  } catch (error: any) {
    const code = String(error?.code || "");
    const message = String(error?.message || error || "");
    if (!["42P01", "42703", "PGRST204", "PGRST205"].includes(code) && !/does not exist|schema cache|column/i.test(message)) {
      console.warn(`[novel-delete] skipped ${table}.${firstColumn}/${secondColumn}`, message);
    }
  }
}

/**
 * ✅ FIX B-6: Batched delete to avoid PostgreSQL's 32,767 parameter limit.
 *
 * Previously, deleteIn passed all values in a single `IN(...)` query. If
 * a novel had more than 32,767 chapters/comments, the query would fail.
 * Now we batch in groups of 1000.
 */
async function deleteIn(table: string, column: string, values: string[]) {
  const cleanValues = Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
  if (cleanValues.length === 0) return;
  const BATCH_SIZE = 1000;
  try {
    for (let i = 0; i < cleanValues.length; i += BATCH_SIZE) {
      const batch = cleanValues.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from(table).delete().in(column, batch);
      if (error) throw error;
    }
  } catch (error: any) {
    const code = String(error?.code || "");
    const message = String(error?.message || error || "");
    if (!["42P01", "42703", "PGRST204", "PGRST205"].includes(code) && !/does not exist|schema cache|column/i.test(message)) {
      console.warn(`[novel-delete] skipped ${table}.${column} in`, message);
    }
  }
}

async function deleteInPair(table: string, firstColumn: string, firstValue: string, secondColumn: string, values: string[]) {
  const cleanValues = Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
  if (cleanValues.length === 0) return;
  const BATCH_SIZE = 1000;
  try {
    for (let i = 0; i < cleanValues.length; i += BATCH_SIZE) {
      const batch = cleanValues.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from(table).delete().eq(firstColumn, firstValue).in(secondColumn, batch);
      if (error) throw error;
    }
  } catch (error: any) {
    const code = String(error?.code || "");
    const message = String(error?.message || error || "");
    if (!["42P01", "42703", "PGRST204", "PGRST205"].includes(code) && !/does not exist|schema cache|column/i.test(message)) {
      console.warn(`[novel-delete] skipped ${table}.${firstColumn}/${secondColumn} in`, message);
    }
  }
}

async function selectIds(table: string, column: string, value: string): Promise<string[]> {
  try {
    const { data, error } = await supabase.from(table).select("id").eq(column, value);
    if (error) throw error;
    return (data || []).map((row: any) => String(row.id || "")).filter(Boolean);
  } catch {
    return [];
  }
}

export async function deleteNovelCompletely(novelId: string) {
  const id = String(novelId || "").trim();
  if (!id) throw new Error("شناسه رمان الزامی است.");

  // Every upload this novel owns, captured before its rows are deleted: once
  // the chapters are gone the references cannot be discovered any more.
  let ownedFileIds: string[] = [];
  try {
    ownedFileIds = [...(await collectNovelFileIds(id))];
  } catch (error: any) {
    console.warn("[media] could not enumerate novel uploads before deletion", { novelId: id, message: error?.message });
  }

  const [chapterIds, reviewIds, chapterCommentIds, editorThreadIds] = await Promise.all([
    selectIds("chapters", "novel_id", id),
    selectIds("reviews", "novel_id", id),
    selectIds("chapter_comments", "novel_id", id),
    selectIds("editor_threads", "novel_id", id)
  ]);

  await Promise.allSettled([
    deleteInPair("comment_replies", "target_type", "review", "target_id", reviewIds),
    deleteInPair("comment_replies", "target_type", "chapter_comment", "target_id", chapterCommentIds),
    deleteIn("editor_thread_messages", "thread_id", editorThreadIds),
    deleteIn("chapter_versions", "chapter_id", chapterIds),
    deleteIn("editor_inline_comments", "chapter_id", chapterIds),
    deleteIn("editor_review_checklists", "chapter_id", chapterIds)
  ]);

  await Promise.allSettled([
    deleteWhere("bookmarks", "novel_id", id),
    deleteWhere("novel_likes", "novel_id", id),
    deleteWhere("reviews", "novel_id", id),
    deleteWhere("chapter_comments", "novel_id", id),
    deleteWhere("reading_progress", "novel_id", id),
    deleteWhere("reading_sessions", "novel_id", id),
    deleteWhere("analytics_logs", "novel_id", id),
    deleteWhere("author_posts", "novel_id", id),
    deleteWhere("editor_messages", "novel_id", id),
    deleteWhere("editor_assignments", "novel_id", id),
    deleteWhere("editor_inline_comments", "novel_id", id),
    deleteWhere("editor_review_checklists", "novel_id", id),
    deleteWhere("editor_threads", "novel_id", id),
    deleteWhere("content_moderation_scans", "novel_id", id),
    deleteWhere("star_transactions", "novel_id", id),
    deleteWherePair("follows", "target_type", "novel", "target_id", id),
    deleteWherePair("reports", "target_type", "novel", "target_id", id),
    // Page rows cascade with their chapter, but deleting them explicitly keeps
    // the sweep correct on a database whose FK was created without CASCADE.
    deleteWhere("manga_pages", "novel_id", id),
    deleteWhere("chapters", "novel_id", id),
    deleteSuggestionNovelArtifacts(id)
  ]);

  const { error } = await supabase.from("novels").delete().eq("id", id);
  if (error) throw error;

  // Reclaim the storage. Files shared with another of the author's works are
  // skipped, so a reused cover never disappears from a novel that still needs it.
  await releaseNovelUploads(id, ownedFileIds);
}

/** Soft-delete and unlink the uploads a deleted novel exclusively owned. */
async function releaseNovelUploads(novelId: string, fileIds: readonly string[]): Promise<void> {
  if (!fileIds.length) return;
  try {
    const { rows } = await db.query(
      `SELECT id, url FROM files WHERE deleted_at IS NULL AND id = ANY($1::text[])`,
      [[...fileIds]],
    );
    for (const file of rows) {
      const patterns = [`%${String(file.url || "")}%`, `%/api/files/${file.id}/content%`, `%/api/upload/${file.id}/content%`];
      const shared = await db.query(
        `SELECT 1 FROM chapters WHERE content LIKE ANY($1::text[]) LIMIT 1`,
        [patterns],
      );
      if (shared.rowCount) continue;
      const sharedNovel = await db.query(
        `SELECT 1 FROM novels WHERE cover_url LIKE ANY($1::text[]) OR characters::text LIKE ANY($1::text[]) LIMIT 1`,
        [patterns],
      );
      if (sharedNovel.rowCount) continue;
      // A page scan may be shared with another manga (a recap page, a cover).
      try {
        const sharedPage = await db.query(
          `SELECT 1 FROM manga_pages WHERE image_url LIKE ANY($1::text[]) LIMIT 1`,
          [patterns],
        );
        if (sharedPage.rowCount) continue;
      } catch (error: any) {
        if (!["42P01", "42703"].includes(String(error?.code || ""))) throw error;
      }

      await db.query(`UPDATE files SET deleted_at = now() WHERE id = $1`, [file.id]);
      unlinkStoredUpload(String(file.url || ""));
    }
  } catch (error: any) {
    console.warn("[media] could not release novel uploads", { novelId, message: error?.message });
  }
}
