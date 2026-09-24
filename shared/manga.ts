/**
 * Manga contract shared by the API, the page editor and the reader.
 *
 * A work is either prose (`novel`) or a page-based comic (`manga`). Manga
 * chapters carry an ordered list of image pages instead of HTML, so the page
 * list is the unit that is validated, stored and rendered. Everything else
 * (chapters, likes, comments, bookmarks, reading progress, moderation) is
 * shared with prose and is deliberately not duplicated here.
 */

export type ContentKind = "novel" | "manga";
export type ReadingDirection = "rtl" | "ltr";

/** Reader layouts a manga chapter can be presented with. */
export type MangaReadingMode = "single" | "double" | "strip";

export const CONTENT_KINDS: readonly ContentKind[] = ["novel", "manga"] as const;
export const READING_DIRECTIONS: readonly ReadingDirection[] = ["rtl", "ltr"] as const;
export const MANGA_READING_MODES: readonly MangaReadingMode[] = ["single", "double", "strip"] as const;

/** Mirrors `MEDIA_LIMITS.mangaPagesPerChapter` on the server. */
export const MANGA_MAX_PAGES_PER_CHAPTER = 200;
/** Page scans are large; the per-file ceiling is higher than prose art. */
export const MANGA_PAGE_MAX_BYTES = 12 * 1024 * 1024;
export const MANGA_PAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export const MANGA_ALT_TEXT_MAX_LENGTH = 240;

export interface MangaPage {
  id: string;
  pageNumber: number;
  imageUrl: string;
  width?: number | null;
  height?: number | null;
  altText: string;
  /** A double-page spread occupies both slots in the two-page reader layout. */
  isSpread: boolean;
}

export interface MangaPageInput {
  id?: string;
  imageUrl: string;
  width?: number | null;
  height?: number | null;
  altText?: string;
  isSpread?: boolean;
}

export function normalizeContentKind(value: unknown): ContentKind {
  return String(value || "").trim().toLowerCase() === "manga" ? "manga" : "novel";
}

export function normalizeReadingDirection(value: unknown): ReadingDirection {
  return String(value || "").trim().toLowerCase() === "ltr" ? "ltr" : "rtl";
}

export function normalizeMangaReadingMode(value: unknown): MangaReadingMode {
  const requested = String(value || "").trim().toLowerCase();
  return (MANGA_READING_MODES as readonly string[]).includes(requested)
    ? (requested as MangaReadingMode)
    : "single";
}

export function isMangaWork(work: unknown): boolean {
  const candidate = work as { contentKind?: unknown; content_kind?: unknown } | null | undefined;
  return normalizeContentKind(candidate?.contentKind ?? candidate?.content_kind) === "manga";
}

/** Clamp a reported natural pixel dimension to something storable. */
export function clampPageDimension(value: unknown): number | null {
  const pixels = Math.round(Number(value));
  if (!Number.isFinite(pixels) || pixels <= 0) return null;
  return Math.min(20000, pixels);
}

export interface MangaPageRejection {
  index: number;
  reason: "source" | "count" | "empty";
  message: string;
}

/**
 * A page image must be an upload hosted by this platform or an HTTPS URL.
 *
 * Everything else (blob:, data:, javascript:, plain http) is rejected: a blob
 * URL dies with the tab, and a data URL would be inlined into every reader
 * response.
 */
export function isStorableMangaPageSource(value: unknown): boolean {
  const source = String(value || "").trim();
  if (!source) return false;
  if (/^\/(?:uploads\/|api\/(?:files|upload)\/[^/]+\/content$)/i.test(source)) return true;
  try {
    return new URL(source).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate and renumber a submitted page list.
 *
 * Page numbers are always derived from array order, never trusted from the
 * client: that is what makes drag-and-drop reordering a single atomic write.
 */
export function normalizeMangaPageList(
  pages: readonly MangaPageInput[] | null | undefined,
  options: { maxPages?: number } = {},
): { pages: Array<Omit<MangaPage, "id"> & { id?: string }>; rejection: MangaPageRejection | null } {
  const list = Array.isArray(pages) ? pages : [];
  const maxPages = Math.max(1, Number(options.maxPages || MANGA_MAX_PAGES_PER_CHAPTER));

  if (list.length > maxPages) {
    return {
      pages: [],
      rejection: {
        index: maxPages,
        reason: "count",
        message: `هر فصل مانگا حداکثر می‌تواند ${maxPages.toLocaleString("fa-IR")} صفحه داشته باشد.`,
      },
    };
  }

  const normalized: Array<Omit<MangaPage, "id"> & { id?: string }> = [];
  for (let index = 0; index < list.length; index += 1) {
    const page = list[index] || ({} as MangaPageInput);
    const imageUrl = String(page.imageUrl || "").trim();
    if (!isStorableMangaPageSource(imageUrl)) {
      return {
        pages: [],
        rejection: {
          index,
          reason: "source",
          message: `صفحهٔ ${(index + 1).toLocaleString("fa-IR")}: نشانی تصویر باید یک فایل بارگذاری‌شده در رپتوک یا نشانی HTTPS باشد.`,
        },
      };
    }
    normalized.push({
      id: page.id ? String(page.id).slice(0, 120) : undefined,
      pageNumber: index + 1,
      imageUrl,
      width: clampPageDimension(page.width),
      height: clampPageDimension(page.height),
      altText: String(page.altText || "").replace(/\s+/g, " ").trim().slice(0, MANGA_ALT_TEXT_MAX_LENGTH),
      isSpread: page.isSpread === true,
    });
  }

  return { pages: normalized, rejection: null };
}

export interface MangaPageRejectionForFile {
  reason: "type" | "size";
  message: string;
}

/** Browser-side check before a page scan is uploaded. */
export function validateMangaPageFile(file: { type?: string; size?: number }): MangaPageRejectionForFile | null {
  const type = String(file.type || "").toLowerCase();
  if (!(MANGA_PAGE_MIME_TYPES as readonly string[]).includes(type)) {
    return { reason: "type", message: "صفحهٔ مانگا باید تصویری با قالب JPEG، PNG، WebP یا AVIF باشد." };
  }
  if (Number(file.size || 0) > MANGA_PAGE_MAX_BYTES) {
    return { reason: "size", message: "حجم هر صفحه باید کمتر از ۱۲ مگابایت باشد." };
  }
  return null;
}

/**
 * Group pages into reader "spreads".
 *
 * `single` and `strip` show one page per step. `double` pairs pages, except a
 * page marked as a spread, which always stands alone so a two-page artwork is
 * never squeezed next to an unrelated page. The first page also stands alone,
 * matching how print manga opens on a single cover.
 */
export function buildMangaSpreads(pages: readonly MangaPage[], mode: MangaReadingMode): MangaPage[][] {
  const ordered = [...pages].sort((left, right) => left.pageNumber - right.pageNumber);
  if (mode !== "double") return ordered.map((page) => [page]);

  const spreads: MangaPage[][] = [];
  let index = 0;
  while (index < ordered.length) {
    const page = ordered[index];
    if (index === 0 || page.isSpread) {
      spreads.push([page]);
      index += 1;
      continue;
    }
    const next = ordered[index + 1];
    if (next && !next.isSpread) {
      spreads.push([page, next]);
      index += 2;
      continue;
    }
    spreads.push([page]);
    index += 1;
  }
  return spreads;
}

/** Reading progress percentage for a page index inside a chapter. */
export function mangaProgressPercent(pageIndex: number, totalPages: number): number {
  if (!Number.isFinite(totalPages) || totalPages <= 0) return 0;
  const bounded = Math.max(0, Math.min(totalPages - 1, Math.floor(pageIndex)));
  return Math.round(((bounded + 1) / totalPages) * 1000) / 10;
}

/** Convert persisted chapter progress back to a safe zero-based page index. */
export function mangaPageIndexFromPercent(percent: unknown, totalPages: number): number {
  if (!Number.isFinite(totalPages) || totalPages <= 0) return 0;
  const boundedPercent = Math.max(0, Math.min(100, Number(percent) || 0));
  if (boundedPercent <= 0) return 0;
  return Math.max(0, Math.min(totalPages - 1, Math.ceil((boundedPercent / 100) * totalPages) - 1));
}

export function mangaPageAltText(page: MangaPage, chapterTitle: string): string {
  const caption = String(page.altText || "").trim();
  if (caption) return caption;
  return `${chapterTitle} — صفحهٔ ${page.pageNumber.toLocaleString("fa-IR")}`;
}
