import { v4 as uuidv4 } from "uuid";
import { db, supabase } from "../postgres";
import { sanitizePlainText } from "./content";
import { normalizeStoredImageReference } from "./images";
import {
  MANGA_ALT_TEXT_MAX_LENGTH,
  clampPageDimension,
  normalizeContentKind,
  normalizeMangaPageList,
  type MangaPage,
  type MangaPageInput,
} from "../../shared/manga";
import { MEDIA_LIMITS, releaseUnreferencedNovelFiles, resolveStoredImageFileIds } from "./mediaLifecycle";

/**
 * Manga page storage.
 *
 * A manga chapter is an ordered list of image pages. Page numbers are always
 * derived from array order rather than trusted from the client, which is what
 * makes "reorder", "insert", "delete" and "replace" a single atomic write: the
 * editor sends the list it wants to exist and this module makes the database
 * match it.
 *
 * Every write also keeps two derived facts correct:
 *   - `chapters.page_count`, so chapter lists and the reader never need to load
 *     page rows just to show progress;
 *   - the upload ledger, so a page removed from a chapter frees its disk space
 *     (see `mediaLifecycle`).
 */

/**
 * Temporary page-number offset used while a chapter is being renumbered.
 *
 * `manga_pages` has a unique index on (chapter_id, page_number) and the stored
 * numbers must stay >= 1, so a reorder writes every page above this offset
 * first and then subtracts it. The offset is far above the per-chapter page cap,
 * so a parked number can never collide with a real one.
 */
const PAGE_NUMBER_PARK_OFFSET = 1_000_000;

export class MangaPageError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "MANGA_PAGES_INVALID") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function rowToPage(row: any): MangaPage {
  return {
    id: String(row.id),
    pageNumber: Number(row.page_number),
    imageUrl: String(row.image_url || ""),
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    height: row.height === null || row.height === undefined ? null : Number(row.height),
    altText: String(row.alt_text || ""),
    isSpread: row.is_spread === true,
  };
}

/** Does this deployment have the manga schema (migration 076) applied? */
export function isMissingMangaSchema(error: any): boolean {
  return ["42P01", "42703"].includes(String(error?.code || ""));
}

export async function loadChapterPages(chapterId: string): Promise<MangaPage[]> {
  try {
    const { rows } = await db.query(
      `SELECT id, page_number, image_url, width, height, alt_text, is_spread
         FROM manga_pages
        WHERE chapter_id = $1
        ORDER BY page_number`,
      [chapterId],
    );
    return rows.map(rowToPage);
  } catch (error: any) {
    if (isMissingMangaSchema(error)) return [];
    throw error;
  }
}

/** Pages for many chapters at once, keyed by chapter id. */
export async function loadPagesForChapters(chapterIds: readonly string[]): Promise<Map<string, MangaPage[]>> {
  const result = new Map<string, MangaPage[]>();
  if (!chapterIds.length) return result;
  try {
    const { rows } = await db.query(
      `SELECT id, chapter_id, page_number, image_url, width, height, alt_text, is_spread
         FROM manga_pages
        WHERE chapter_id = ANY($1::text[])
        ORDER BY chapter_id, page_number`,
      [[...chapterIds]],
    );
    for (const row of rows) {
      const chapterId = String(row.chapter_id);
      const pages = result.get(chapterId) || [];
      pages.push(rowToPage(row));
      result.set(chapterId, pages);
    }
  } catch (error: any) {
    if (!isMissingMangaSchema(error)) throw error;
  }
  return result;
}

/** Page totals per chapter, used by the editor overview and chapter lists. */
export async function loadPageCounts(novelId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  try {
    const { rows } = await db.query(
      `SELECT chapter_id, COUNT(*)::int AS pages FROM manga_pages WHERE novel_id = $1 GROUP BY chapter_id`,
      [novelId],
    );
    for (const row of rows) counts.set(String(row.chapter_id), Number(row.pages || 0));
  } catch (error: any) {
    if (!isMissingMangaSchema(error)) throw error;
  }
  return counts;
}

function sanitizePageInput(page: MangaPageInput, index: number): MangaPageInput {
  let imageUrl: string;
  try {
    imageUrl = normalizeStoredImageReference(page.imageUrl, { allowEmpty: false });
  } catch (error: any) {
    throw new MangaPageError(
      `صفحهٔ ${(index + 1).toLocaleString("fa-IR")}: ${error?.message || "نشانی تصویر معتبر نیست."}`,
    );
  }
  return {
    id: page.id ? sanitizePlainText(page.id, 120).trim() : undefined,
    imageUrl,
    width: clampPageDimension(page.width),
    height: clampPageDimension(page.height),
    altText: sanitizePlainText(page.altText, MANGA_ALT_TEXT_MAX_LENGTH).replace(/\s+/g, " ").trim(),
    isSpread: page.isSpread === true,
  };
}

export interface PageWriteResult {
  pages: MangaPage[];
  pageCount: number;
  removedFiles: number;
  reclaimedBytes: number;
}

/**
 * Make the chapter's stored pages match `requestedPages` exactly.
 *
 * Rows whose id is still present are updated in place (so page comments and
 * external references to a page id survive a reorder); everything else is
 * inserted, and rows that disappeared are deleted and their uploads swept.
 */
export async function replaceChapterPages(
  novelId: string,
  chapterId: string,
  requestedPages: readonly MangaPageInput[],
  options: { ownerId: string; maxPages?: number } = { ownerId: "" },
): Promise<PageWriteResult> {
  const sanitized = (Array.isArray(requestedPages) ? requestedPages : []).map(sanitizePageInput);
  const { pages: ordered, rejection } = normalizeMangaPageList(sanitized, {
    maxPages: options.maxPages || MEDIA_LIMITS.mangaPagesPerChapter,
  });
  if (rejection) throw new MangaPageError(rejection.message);

  const removedImageUrls: string[] = [];

  const written = await db.withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT id, image_url FROM manga_pages WHERE chapter_id = $1 FOR UPDATE`,
      [chapterId],
    );
    const existingById = new Map<string, string>(
      existing.rows.map((row: any) => [String(row.id), String(row.image_url || "")]),
    );

    const keptIds = new Set<string>();
    const now = new Date().toISOString();
    const stored: MangaPage[] = [];

    for (const page of ordered) {
      const reuseId = page.id && existingById.has(page.id) ? page.id : "";
      const id = reuseId || `mpg-${uuidv4()}`;
      keptIds.add(id);
      // Two-phase numbering: pages are parked above PAGE_NUMBER_PARK_OFFSET
      // first so the (chapter_id, page_number) unique index cannot collide while
      // a reorder swaps two pages around.
      await client.query(
        `INSERT INTO manga_pages(id, novel_id, chapter_id, page_number, image_url, width, height, alt_text, is_spread, created_at, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
         ON CONFLICT(id) DO UPDATE
           SET page_number = EXCLUDED.page_number,
               image_url = EXCLUDED.image_url,
               width = EXCLUDED.width,
               height = EXCLUDED.height,
               alt_text = EXCLUDED.alt_text,
               is_spread = EXCLUDED.is_spread,
               updated_at = EXCLUDED.updated_at`,
        [
          id,
          novelId,
          chapterId,
          PAGE_NUMBER_PARK_OFFSET + page.pageNumber,
          page.imageUrl,
          page.width,
          page.height,
          page.altText,
          page.isSpread,
          now,
        ],
      );
      stored.push({ ...page, id });
    }

    for (const [id, imageUrl] of existingById) {
      if (keptIds.has(id)) continue;
      await client.query(`DELETE FROM manga_pages WHERE id = $1`, [id]);
      if (imageUrl) removedImageUrls.push(imageUrl);
    }

    // Second phase: bring the parked numbers down to their final positions.
    await client.query(
      `UPDATE manga_pages
          SET page_number = page_number - $2
        WHERE chapter_id = $1 AND page_number > $2`,
      [chapterId, PAGE_NUMBER_PARK_OFFSET],
    );

    // `chapters.page_count` arrives with the same migration as `manga_pages`,
    // so if the table exists this column does too.
    await client.query(
      `UPDATE chapters SET page_count = $2, updated_at = $3 WHERE id = $1`,
      [chapterId, stored.length, now],
    );

    return stored;
  });

  // Uploads that no page points at any more are released best-effort: a failed
  // sweep must never fail the author's save.
  let removedFiles = 0;
  let reclaimedBytes = 0;
  const stillReferenced = new Set(written.map((page) => page.imageUrl));
  const orphanCandidates = removedImageUrls.filter((url) => !stillReferenced.has(url));
  if (orphanCandidates.length && options.ownerId) {
    try {
      const fileIds = await resolveStoredImageFileIds(orphanCandidates);
      const released = await releaseUnreferencedNovelFiles(novelId, options.ownerId, fileIds);
      removedFiles = released.removed.length;
      reclaimedBytes = released.reclaimedBytes;
    } catch (error: any) {
      console.warn("[manga] orphan page sweep failed", { novelId, chapterId, message: error?.message || error });
    }
  }

  return { pages: written, pageCount: written.length, removedFiles, reclaimedBytes };
}

/** Append pages to the end of a chapter, preserving existing order and ids. */
export async function appendChapterPages(
  novelId: string,
  chapterId: string,
  newPages: readonly MangaPageInput[],
  options: { ownerId: string },
): Promise<PageWriteResult> {
  const current = await loadChapterPages(chapterId);
  return replaceChapterPages(
    novelId,
    chapterId,
    [
      ...current.map((page) => ({
        id: page.id,
        imageUrl: page.imageUrl,
        width: page.width,
        height: page.height,
        altText: page.altText,
        isSpread: page.isSpread,
      })),
      ...newPages,
    ],
    options,
  );
}

/**
 * Is this chapter allowed to be published?
 *
 * A prose chapter needs text; a manga chapter needs at least one page. Both
 * checks live here so `POST /novels/:id/chapters` cannot publish an empty
 * manga chapter that would render as a blank reader.
 */
export async function chapterHasPublishableBody(
  contentKind: unknown,
  chapterId: string,
  content: unknown,
): Promise<boolean> {
  if (normalizeContentKind(contentKind) !== "manga") {
    return String(content || "").replace(/<[^>]*>/g, " ").trim().length > 0;
  }
  const pages = await loadChapterPages(chapterId);
  return pages.length > 0;
}

/** Novel type + page-turn direction, tolerant of a pre-migration deployment. */
export async function loadNovelKind(novelId: string): Promise<{ contentKind: "novel" | "manga"; readingDirection: "rtl" | "ltr" }> {
  const { data } = await supabase.from("novels").select("content_kind, reading_direction").eq("id", novelId).single();
  return {
    contentKind: normalizeContentKind((data as any)?.content_kind),
    readingDirection: String((data as any)?.reading_direction || "rtl") === "ltr" ? "ltr" : "rtl",
  };
}
