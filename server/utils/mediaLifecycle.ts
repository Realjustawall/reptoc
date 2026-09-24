import fs from "fs";
import path from "path";
import { db, supabase } from "../postgres";
import { publicUploadFileName } from "./images";

/**
 * Media lifecycle: storage quotas and orphan cleanup.
 *
 * Chapter illustrations and manga pages are uploaded before the text that
 * references them is saved, so the two are only loosely coupled. Two problems
 * follow, and this module owns both:
 *
 *   1. Removing a picture from a chapter used to leave the file on disk
 *      forever. Every reference is now recounted after a write, and a file that
 *      nothing points to is soft-deleted in `files` and unlinked from disk.
 *   2. Nothing limited how much an author could upload. Quotas are enforced per
 *      file, per novel and per account, with a separate ceiling for manga
 *      because page scans are far larger than prose illustrations.
 */

export const MEGABYTE = 1024 * 1024;

/** Defaults are overridable per deployment through the environment. */
export const MEDIA_LIMITS = {
  /** Any single image in a chapter or manga page. */
  imageBytes: Number(process.env.MEDIA_MAX_IMAGE_BYTES || 5 * MEGABYTE),
  /** Every image across one prose novel. */
  novelBytes: Number(process.env.MEDIA_MAX_NOVEL_BYTES || 300 * MEGABYTE),
  /** Every image across one manga series; page scans dwarf prose art. */
  mangaBytes: Number(process.env.MEDIA_MAX_MANGA_BYTES || 2048 * MEGABYTE),
  /** Everything one account has uploaded, across all of its works. */
  userBytes: Number(process.env.MEDIA_MAX_USER_BYTES || 4096 * MEGABYTE),
  /** Pages in a single manga chapter. */
  mangaPagesPerChapter: Number(process.env.MEDIA_MAX_MANGA_PAGES || 200),
} as const;

export function formatBytes(bytes: number): string {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < MEGABYTE) return `${Math.ceil(value / 1024)} کیلوبایت`;
  return `${(value / MEGABYTE).toFixed(value >= 100 * MEGABYTE ? 0 : 1)} مگابایت`;
}

/**
 * Every locally hosted image referenced by a fragment of stored HTML.
 *
 * Only same-origin uploads are returned: remote URLs cost this platform no
 * storage and must never be considered for deletion.
 */
export function extractStoredImageReferences(html: unknown): string[] {
  const source = String(html || "");
  const references = new Set<string>();
  for (const match of source.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)) {
    const reference = String(match[2] || "").trim();
    if (/^\/(?:uploads\/|api\/(?:files|upload)\/)/i.test(reference)) references.add(reference);
  }
  return [...references];
}

/**
 * Resolve stored references (`/uploads/x.webp` or `/api/files/<id>/content`) to
 * the ids of their `files` rows.
 */
export async function resolveStoredImageFileIds(references: readonly string[]): Promise<string[]> {
  return [...(await resolveFileIds(references))];
}

/** Resolve a stored reference to a file row id. */
async function resolveFileIds(references: readonly string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!references.length) return ids;

  const publicUrls: string[] = [];
  for (const reference of references) {
    const contentId = reference.match(/^\/api\/(?:files|upload)\/([a-zA-Z0-9_-]+)\/content$/i)?.[1];
    if (contentId) {
      ids.add(contentId);
      continue;
    }
    const fileName = publicUploadFileName(reference);
    if (fileName) publicUrls.push(`/uploads/${fileName}`);
  }

  if (publicUrls.length) {
    const { rows } = await db.query(`SELECT id FROM files WHERE url = ANY($1::text[])`, [publicUrls]);
    for (const row of rows) ids.add(String(row.id));
  }
  return ids;
}

/**
 * Files that a novel still points at, across every surface that can hold an
 * image: chapter bodies, the cover, character portraits and manga pages.
 */
export async function collectNovelFileIds(novelId: string): Promise<Set<string>> {
  const references = new Set<string>();

  const { rows: chapters } = await db.query(`SELECT content FROM chapters WHERE novel_id = $1`, [novelId]);
  for (const chapter of chapters) {
    for (const reference of extractStoredImageReferences(chapter.content)) references.add(reference);
  }

  const { rows: novels } = await db.query(`SELECT cover_url, characters FROM novels WHERE id = $1`, [novelId]);
  for (const novel of novels) {
    if (novel.cover_url) references.add(String(novel.cover_url));
    const characters = Array.isArray(novel.characters) ? novel.characters : [];
    for (const character of characters) {
      const image = (character as any)?.image || (character as any)?.imageUrl;
      if (image) references.add(String(image));
    }
  }

  // Manga pages live in their own table once migration 076 has run.
  try {
    const { rows: pages } = await db.query(`SELECT image_url FROM manga_pages WHERE novel_id = $1`, [novelId]);
    for (const page of pages) if (page.image_url) references.add(String(page.image_url));
  } catch (error: any) {
    if (!["42P01", "42703"].includes(String(error?.code || ""))) throw error;
  }

  return resolveFileIds([...references]);
}

/**
 * Delete the upload rows a novel no longer references.
 *
 * `candidateFileIds` narrows the sweep to files that were plausibly touched by
 * the current write, so a large novel is not rescanned in full on every save.
 * Only files owned by `ownerId` are ever removed, and only when no other novel
 * of that owner still references them.
 */
export async function releaseUnreferencedNovelFiles(
  novelId: string,
  ownerId: string,
  candidateFileIds?: readonly string[],
): Promise<{ removed: string[]; reclaimedBytes: number }> {
  const stillReferenced = await collectNovelFileIds(novelId);

  const { rows: owned } = candidateFileIds?.length
    ? await db.query(
      `SELECT id, url, size FROM files WHERE user_id = $1 AND deleted_at IS NULL AND id = ANY($2::text[])`,
      [ownerId, [...candidateFileIds]],
    )
    : await db.query(
      `SELECT id, url, size FROM files WHERE user_id = $1 AND deleted_at IS NULL`,
      [ownerId],
    );

  const removed: string[] = [];
  let reclaimedBytes = 0;

  for (const file of owned) {
    const fileId = String(file.id);
    if (stillReferenced.has(fileId)) continue;
    // The same upload may be shared with another of this author's novels.
    if (await isFileReferencedElsewhere(fileId, String(file.url || ""), ownerId, novelId)) continue;

    // Soft-delete first: if the unlink fails the row is already invisible.
    await db.query(`UPDATE files SET deleted_at = now() WHERE id = $1`, [fileId]);
    removed.push(fileId);
    reclaimedBytes += Math.max(0, Number(file.size || 0));
    unlinkStoredUpload(String(file.url || ""));
  }

  return { removed, reclaimedBytes };
}

/** Is this upload referenced by any other novel, avatar or challenge? */
async function isFileReferencedElsewhere(
  fileId: string,
  url: string,
  ownerId: string,
  excludeNovelId: string,
): Promise<boolean> {
  const patterns = [`%${url}%`, `%/api/files/${fileId}/content%`, `%/api/upload/${fileId}/content%`];

  const chapterMatch = await db.query(
    `SELECT 1 FROM chapters chapter
       JOIN novels novel ON novel.id = chapter.novel_id
      WHERE novel.author_id = $1 AND chapter.novel_id <> $2
        AND (chapter.content LIKE ANY($3::text[]))
      LIMIT 1`,
    [ownerId, excludeNovelId, patterns],
  );
  if (chapterMatch.rowCount) return true;

  const novelMatch = await db.query(
    `SELECT 1 FROM novels
      WHERE author_id = $1 AND id <> $2
        AND (cover_url LIKE ANY($3::text[]) OR characters::text LIKE ANY($3::text[]))
      LIMIT 1`,
    [ownerId, excludeNovelId, patterns],
  );
  if (novelMatch.rowCount) return true;

  // Another manga of this author may reuse the same page scan.
  try {
    const pageMatch = await db.query(
      `SELECT 1 FROM manga_pages page
         JOIN novels novel ON novel.id = page.novel_id
        WHERE novel.author_id = $1 AND page.novel_id <> $2
          AND page.image_url LIKE ANY($3::text[])
        LIMIT 1`,
      [ownerId, excludeNovelId, patterns],
    );
    if (pageMatch.rowCount) return true;
  } catch (error: any) {
    if (!["42P01", "42703"].includes(String(error?.code || ""))) throw error;
  }

  // An avatar or a challenge prompt may point at the same upload.
  const profileMatch = await db.query(`SELECT 1 FROM users WHERE avatar LIKE ANY($1::text[]) LIMIT 1`, [patterns]);
  if (profileMatch.rowCount) return true;

  try {
    const challengeMatch = await db.query(
      `SELECT 1 FROM daily_challenges WHERE image_url LIKE ANY($1::text[]) OR audio_url LIKE ANY($1::text[]) LIMIT 1`,
      [patterns],
    );
    if (challengeMatch.rowCount) return true;
  } catch (error: any) {
    if (!["42P01", "42703"].includes(String(error?.code || ""))) throw error;
  }

  return false;
}

/** Remove the backing file from disk, staying inside the uploads directory. */
export function unlinkStoredUpload(url: string): void {
  const fileName = publicUploadFileName(url);
  if (!fileName) return;
  const uploadDir = path.resolve(process.cwd(), "uploads");
  const resolved = path.resolve(uploadDir, fileName);
  if (!resolved.startsWith(uploadDir + path.sep)) return;
  try {
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
  } catch (error: any) {
    console.warn("[media] could not unlink orphaned upload", { fileName, message: error?.message });
  }
}

export interface StorageUsage {
  userBytes: number;
  novelBytes: number;
}

/** Bytes currently attributed to an account, and to one of its novels. */
export async function storageUsage(ownerId: string, novelId?: string): Promise<StorageUsage> {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(size), 0)::bigint AS total FROM files WHERE user_id = $1 AND deleted_at IS NULL`,
    [ownerId],
  );
  const userBytes = Number(rows[0]?.total || 0);
  if (!novelId) return { userBytes, novelBytes: 0 };

  const fileIds = await collectNovelFileIds(novelId);
  if (!fileIds.size) return { userBytes, novelBytes: 0 };
  const { rows: novelRows } = await db.query(
    `SELECT COALESCE(SUM(size), 0)::bigint AS total FROM files WHERE deleted_at IS NULL AND id = ANY($1::text[])`,
    [[...fileIds]],
  );
  return { userBytes, novelBytes: Number(novelRows[0]?.total || 0) };
}

export interface QuotaRejection {
  scope: "image" | "novel" | "user";
  message: string;
}

/**
 * Decide whether one more upload of `incomingBytes` is allowed.
 *
 * Returns `null` when the upload fits. Manga series get the larger ceiling.
 */
export async function checkUploadQuota(options: {
  ownerId: string;
  incomingBytes: number;
  novelId?: string;
  isManga?: boolean;
  /** Per-file ceiling override; manga page scans are allowed a larger one. */
  maxImageBytes?: number;
}): Promise<QuotaRejection | null> {
  const incoming = Math.max(0, Number(options.incomingBytes) || 0);
  const imageCeiling = Math.max(MEDIA_LIMITS.imageBytes, Number(options.maxImageBytes || 0));
  if (incoming > imageCeiling) {
    return {
      scope: "image",
      message: `حجم هر تصویر باید کمتر از ${formatBytes(imageCeiling)} باشد.`,
    };
  }

  const usage = await storageUsage(options.ownerId, options.novelId);

  if (usage.userBytes + incoming > MEDIA_LIMITS.userBytes) {
    return {
      scope: "user",
      message: `سهم فضای ذخیره‌سازی حساب شما (${formatBytes(MEDIA_LIMITS.userBytes)}) پر شده است. تصاویر بی‌استفاده را حذف کنید.`,
    };
  }

  if (options.novelId) {
    const ceiling = options.isManga ? MEDIA_LIMITS.mangaBytes : MEDIA_LIMITS.novelBytes;
    if (usage.novelBytes + incoming > ceiling) {
      return {
        scope: "novel",
        message: `سهم فضای این ${options.isManga ? "مانگا" : "رمان"} (${formatBytes(ceiling)}) پر شده است.`,
      };
    }
  }

  return null;
}
