import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, Columns2,
  ImageUp, Layers, Loader2, RefreshCw, Replace, Save, Trash2,
} from "lucide-react";
import { api } from "../utils/api";
import { uploadImageBlob } from "../utils/imageUpload";
import SafeImage from "./SafeImage";
import {
  MANGA_ALT_TEXT_MAX_LENGTH,
  MANGA_MAX_PAGES_PER_CHAPTER,
  MANGA_PAGE_MIME_TYPES,
  validateMangaPageFile,
  type MangaPage,
} from "../../shared/manga";

/**
 * Manga page editor.
 *
 * A manga chapter is an ordered list of image pages, so this is the manga
 * equivalent of the prose editor: upload scans in bulk, reorder them, replace or
 * delete one, mark double-page spreads, and write the alt text a screen reader
 * announces.
 *
 * Two rules keep it predictable:
 *   - The page list is always saved whole (`PUT .../pages`), so a reorder can
 *     never half-apply and page numbers always match array order.
 *   - Uploading appends immediately (`POST .../pages`); everything else is a
 *     local edit that is autosaved, with an explicit save button that flushes.
 */

export interface MangaPageEditorProps {
  novelId: string;
  /** Null until the chapter row exists; `ensureChapter` creates it on demand. */
  chapterId: string | null;
  chapterTitle: string;
  theme: "light" | "dark";
  readingDirection: "rtl" | "ltr";
  readOnly?: boolean;
  /**
   * Create (or save) the chapter and return its id.
   *
   * Pages reference a chapter row, so the first upload into a brand-new chapter
   * has to create it first. Returning null means the chapter could not be saved
   * and the upload is abandoned with a message.
   */
  ensureChapter: () => Promise<string | null>;
  onPageCountChange?: (chapterId: string, pageCount: number) => void;
  onPreview?: (pages: MangaPage[]) => void;
}

interface UploadProgress {
  total: number;
  done: number;
  failed: number;
}

const AUTOSAVE_DELAY_MS = 1200;

/** Natural pixel size of a picked file, used for correct reader placeholders. */
async function readImageDimensions(file: File): Promise<{ width: number | null; height: number | null }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth || null, height: image.naturalHeight || null });
      image.onerror = () => resolve({ width: null, height: null });
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Page order as a comparable string, so "dirty" never depends on identity. */
function pagesFingerprint(pages: readonly MangaPage[]): string {
  return pages
    .map((page) => [page.id, page.imageUrl, page.altText, page.isSpread ? "1" : "0"].join("\u0001"))
    .join("\u0002");
}

function reorder(pages: readonly MangaPage[], from: number, to: number): MangaPage[] {
  const next = [...pages];
  const bounded = Math.max(0, Math.min(next.length - 1, to));
  const [moved] = next.splice(from, 1);
  next.splice(bounded, 0, moved);
  return next.map((page, index) => ({ ...page, pageNumber: index + 1 }));
}

export default function MangaPageEditor({
  novelId,
  chapterId,
  chapterTitle,
  theme,
  readingDirection,
  readOnly = false,
  ensureChapter,
  onPageCountChange,
  onPreview,
}: MangaPageEditorProps) {
  const isDark = theme === "dark";
  const [pages, setPages] = useState<MangaPage[]>([]);
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "unsaved" | "saving" | "saved" | "failed">("idle");
  const [notice, setNotice] = useState<{ tone: "info" | "error"; message: string } | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [maxPages, setMaxPages] = useState(MANGA_MAX_PAGES_PER_CHAPTER);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef<Promise<unknown> | null>(null);
  const pagesRef = useRef<MangaPage[]>([]);
  const chapterIdRef = useRef<string | null>(chapterId);

  pagesRef.current = pages;
  chapterIdRef.current = chapterId;

  const announce = useCallback((message: string, tone: "info" | "error" = "info") => {
    setNotice({ tone, message });
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
  }, []);

  const applyLoaded = useCallback((loaded: MangaPage[]) => {
    setPages(loaded);
    setSavedFingerprint(pagesFingerprint(loaded));
    setSaveState("idle");
    setSelectedIds(new Set());
  }, []);

  const loadPages = useCallback(async (targetChapterId: string) => {
    setLoading(true);
    try {
      const result = await api.getMangaPages(novelId, targetChapterId);
      applyLoaded(result.pages);
      setMaxPages(result.limits.maxPages || MANGA_MAX_PAGES_PER_CHAPTER);
      onPageCountChange?.(targetChapterId, result.pages.length);
    } catch (error: any) {
      announce(error?.message || "بارگذاری صفحه‌های این فصل ممکن نشد.", "error");
    } finally {
      setLoading(false);
    }
  }, [announce, applyLoaded, novelId, onPageCountChange]);

  useEffect(() => {
    if (!chapterId) {
      applyLoaded([]);
      return;
    }
    void loadPages(chapterId);
  }, [applyLoaded, chapterId, loadPages]);

  const isDirty = pagesFingerprint(pages) !== savedFingerprint;

  useEffect(() => {
    if (!isDirty) return;
    setSaveState((current) => (current === "saving" ? current : "unsaved"));
  }, [isDirty]);

  /** Persist the current list. Returns true when the server accepted it. */
  const savePages = useCallback(async (list?: MangaPage[]): Promise<boolean> => {
    const targetChapterId = chapterIdRef.current;
    if (!targetChapterId || readOnly) return false;
    const payload = (list || pagesRef.current).map((page) => ({
      id: page.id,
      imageUrl: page.imageUrl,
      width: page.width,
      height: page.height,
      altText: page.altText,
      isSpread: page.isSpread,
    }));

    setSaveState("saving");
    const request = api.saveMangaPages(novelId, targetChapterId, payload);
    saveInFlightRef.current = request;
    try {
      const result = await request;
      // The server is the source of truth for ids and numbering.
      setPages(result.pages);
      setSavedFingerprint(pagesFingerprint(result.pages));
      setSaveState("saved");
      onPageCountChange?.(targetChapterId, result.pageCount);
      return true;
    } catch (error: any) {
      setSaveState("failed");
      announce(error?.message || "ذخیره ترتیب صفحه‌ها ممکن نشد.", "error");
      return false;
    } finally {
      if (saveInFlightRef.current === request) saveInFlightRef.current = null;
    }
  }, [announce, novelId, onPageCountChange, readOnly]);

  // Autosave: local edits (reorder, alt text, spread, delete) are flushed shortly
  // after the author stops changing things, so closing the tab cannot lose work.
  useEffect(() => {
    if (readOnly || !chapterId || !isDirty) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void savePages();
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [chapterId, isDirty, pages, readOnly, savePages]);

  // Leaving with unsaved page order would silently discard it.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (readOnly || files.length === 0) return;

    let targetChapterId = chapterIdRef.current;
    if (!targetChapterId) {
      // Pages reference a chapter row, so create it before the first upload.
      targetChapterId = await ensureChapter();
      if (!targetChapterId) {
        announce("پیش از افزودن صفحه، فصل ذخیره نشد. عنوان فصل را کامل کنید و دوباره تلاش کنید.", "error");
        return;
      }
      chapterIdRef.current = targetChapterId;
    }

    const room = maxPages - pagesRef.current.length;
    if (room <= 0) {
      announce(`این فصل به سقف ${maxPages.toLocaleString("fa-IR")} صفحه رسیده است.`, "error");
      return;
    }

    const accepted: File[] = [];
    for (const file of files) {
      const rejection = validateMangaPageFile(file);
      if (rejection) {
        announce(`${file.name}: ${rejection.message}`, "error");
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;

    const batch = accepted.slice(0, room);
    if (batch.length < accepted.length) {
      announce(`فقط ${batch.length.toLocaleString("fa-IR")} صفحه جا داشت؛ بقیه افزوده نشد.`, "error");
    }

    // Files land in the order the author picked them, which for scan folders is
    // the page order. Sorting by name keeps "1, 2, 10" numeric rather than
    // lexicographic.
    batch.sort((left, right) => left.name.localeCompare(right.name, "en", { numeric: true, sensitivity: "base" }));

    setUpload({ total: batch.length, done: 0, failed: 0 });
    const uploaded: Array<{ imageUrl: string; width: number | null; height: number | null; altText: string }> = [];
    let failed = 0;

    for (const file of batch) {
      try {
        const dimensions = await readImageDimensions(file);
        const body = await uploadImageBlob(file, {
          // `purpose` is also in the query string because the upload rate-limit
          // bucket is chosen before the multipart body is parsed.
          endpoint: "/api/files/upload?purpose=manga-page",
          fileName: file.name || "page.jpg",
          csrfToken: api.getToken(),
          // `public` so readers can fetch the page; `purpose` unlocks the larger
          // per-file ceiling that page scans need.
          fields: { visibility: "public", novelId, purpose: "manga-page" },
        });
        const url = String(body.url || "").trim();
        if (!url) throw new Error("بارگذاری بدون نشانی قابل استفاده پایان یافت.");
        uploaded.push({ imageUrl: url, width: dimensions.width, height: dimensions.height, altText: "" });
      } catch (error: any) {
        failed += 1;
        announce(`${file.name}: ${error?.message || "بارگذاری ناموفق بود."}`, "error");
      }
      setUpload((current) => (current ? { ...current, done: current.done + 1, failed } : current));
    }

    setUpload(null);
    if (uploaded.length === 0) return;

    try {
      // Any pending local reordering is written first, so appending cannot
      // resurrect the previously saved order.
      if (pagesFingerprint(pagesRef.current) !== savedFingerprint) {
        const persisted = await savePages(pagesRef.current);
        if (!persisted) return;
      }
      const result = await api.appendMangaPages(novelId, targetChapterId, uploaded);
      applyLoaded(result.pages);
      onPageCountChange?.(targetChapterId, result.pageCount);
      announce(`${uploaded.length.toLocaleString("fa-IR")} صفحه افزوده شد.`);
    } catch (error: any) {
      announce(error?.message || "افزودن صفحه‌ها ممکن نشد.", "error");
    }
  }, [announce, applyLoaded, ensureChapter, maxPages, novelId, onPageCountChange, readOnly, savePages, savedFingerprint]);

  const replacePageImage = useCallback(async (pageId: string, file: File) => {
    if (readOnly) return;
    const rejection = validateMangaPageFile(file);
    if (rejection) {
      announce(rejection.message, "error");
      return;
    }
    setUpload({ total: 1, done: 0, failed: 0 });
    try {
      const dimensions = await readImageDimensions(file);
      const body = await uploadImageBlob(file, {
        endpoint: "/api/files/upload?purpose=manga-page",
        fileName: file.name || "page.jpg",
        csrfToken: api.getToken(),
        fields: { visibility: "public", novelId, purpose: "manga-page" },
      });
      const url = String(body.url || "").trim();
      if (!url) throw new Error("بارگذاری بدون نشانی قابل استفاده پایان یافت.");
      const next = pagesRef.current.map((page) => (
        page.id === pageId ? { ...page, imageUrl: url, width: dimensions.width, height: dimensions.height } : page
      ));
      setPages(next);
      // Replacing an image releases the old upload, which only happens on save.
      await savePages(next);
      announce("تصویر این صفحه جای‌گزین شد.");
    } catch (error: any) {
      announce(error?.message || "جای‌گزینی تصویر ممکن نشد.", "error");
    } finally {
      setUpload(null);
    }
  }, [announce, novelId, readOnly, savePages]);

  const mutate = useCallback((next: MangaPage[]) => {
    setPages(next.map((page, index) => ({ ...page, pageNumber: index + 1 })));
  }, []);

  const movePage = (index: number, delta: number) => {
    if (readOnly) return;
    const target = index + delta;
    if (target < 0 || target >= pages.length) return;
    mutate(reorder(pages, index, target));
  };

  const movePageTo = (index: number, position: number) => {
    if (readOnly) return;
    const target = Math.max(1, Math.min(pages.length, Math.round(position))) - 1;
    if (target === index) return;
    mutate(reorder(pages, index, target));
  };

  const deletePages = async (ids: readonly string[]) => {
    if (readOnly || ids.length === 0) return;
    const label = ids.length === 1 ? "این صفحه" : `${ids.length.toLocaleString("fa-IR")} صفحه`;
    if (!window.confirm(`${label} حذف شود؟ فایل تصویر هم از فضای ذخیره‌سازی آزاد می‌شود.`)) return;
    const removing = new Set(ids);
    const next = pages.filter((page) => !removing.has(page.id));
    mutate(next);
    setSelectedIds(new Set());
    await savePages(next.map((page, index) => ({ ...page, pageNumber: index + 1 })));
  };

  const toggleSelected = (pageId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  };

  const setAltText = (pageId: string, value: string) => {
    if (readOnly) return;
    mutate(pages.map((page) => (page.id === pageId ? { ...page, altText: value.slice(0, MANGA_ALT_TEXT_MAX_LENGTH) } : page)));
  };

  const toggleSpread = (pageId: string) => {
    if (readOnly) return;
    mutate(pages.map((page) => (page.id === pageId ? { ...page, isSpread: !page.isSpread } : page)));
  };

  const markSelectedSpread = (isSpread: boolean) => {
    if (readOnly || selectedIds.size === 0) return;
    mutate(pages.map((page) => (selectedIds.has(page.id) ? { ...page, isSpread } : page)));
  };

  const reverseOrder = () => {
    if (readOnly || pages.length < 2) return;
    if (!window.confirm("ترتیب همهٔ صفحه‌ها معکوس شود؟")) return;
    mutate([...pages].reverse());
  };

  const spreadCount = useMemo(() => pages.filter((page) => page.isSpread).length, [pages]);
  const missingAltCount = useMemo(() => pages.filter((page) => !page.altText.trim()).length, [pages]);

  const cardClass = "border-[var(--app-border)] bg-[var(--app-card)]";
  const chipButton = (active: boolean) =>
    `rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
      active ? (isDark ? "bg-violet-600 text-white" : "bg-orange-600 text-white") : isDark ? "bg-slate-800/70 text-slate-300 hover:bg-slate-700" : "bg-stone-100 text-stone-700 hover:bg-orange-50 hover:text-orange-700"
    }`;

  const saveLabel = saveState === "saving"
    ? "در حال ذخیره…"
    : saveState === "saved" && !isDirty
      ? "ذخیره شد"
      : saveState === "failed"
        ? "ذخیره ناموفق"
        : isDirty
          ? "تغییرات ذخیره‌نشده"
          : "همگام";

  return (
    <section className={`overflow-hidden rounded-2xl border shadow-md ${cardClass}`} dir="rtl" data-manga-page-editor={chapterId || "new"}>
      <header className={`flex flex-wrap items-center gap-2 border-b p-3 ${isDark ? "border-violet-950/50" : "border-stone-200"}`}>
        <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-violet-400">
          <Layers className="h-4 w-4" /> صفحه‌های مانگا
        </span>
        <span className="text-[11px] font-bold text-slate-500">
          {pages.length.toLocaleString("fa-IR")} / {maxPages.toLocaleString("fa-IR")} صفحه
          {spreadCount > 0 ? ` · ${spreadCount.toLocaleString("fa-IR")} صفحهٔ گسترده` : ""}
        </span>

        <div className="ms-auto flex flex-wrap items-center gap-2">
          <span
            role="status"
            aria-live="polite"
            className={`text-[11px] font-bold ${
              saveState === "failed" ? "text-rose-400" : isDirty || saveState === "saving" ? "text-amber-500" : "text-emerald-500"
            }`}
          >
            {saveLabel}
          </span>
          {chapterId && (
            <button
              type="button"
              onClick={() => void loadPages(chapterId)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold ${
                isDark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-stone-200 text-stone-700 hover:bg-stone-100"
              }`}
              title="بارگذاری دوباره از سرور"
            >
              <RefreshCw className="h-3.5 w-3.5" /> نوسازی
            </button>
          )}
          {onPreview && pages.length > 0 && (
            <button
              type="button"
              onClick={() => onPreview(pages)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold ${
                isDark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-stone-200 text-stone-700 hover:bg-stone-100"
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" /> پیش‌نمایش خواننده
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              disabled={!chapterId || saveState === "saving" || !isDirty}
              onClick={() => void savePages()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-violet-500 disabled:opacity-40"
            >
              {saveState === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              ذخیره ترتیب
            </button>
          )}
        </div>
      </header>

      {notice && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 px-4 py-2 text-[11px] font-bold ${
            notice.tone === "error"
              ? (isDark ? "bg-rose-500/15 text-rose-300" : "bg-rose-50 text-rose-700")
              : (isDark ? "bg-violet-600/15 text-violet-200" : "bg-orange-50 text-orange-800")
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            {notice.tone === "error" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
            <span className="break-words">{notice.message}</span>
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label="بستن پیام" className="shrink-0 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      {!readOnly && (
        <div
          className={`m-3 rounded-2xl border-2 border-dashed p-5 text-center transition-colors ${
            dropActive
              ? "border-violet-500 bg-violet-500/10"
              : isDark ? "border-slate-700 hover:border-violet-600" : "border-stone-300 hover:border-violet-500"
          }`}
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
            event.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDropActive(false);
            void uploadFiles(Array.from(event.dataTransfer?.files || []));
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={MANGA_PAGE_MIME_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = "";
              void uploadFiles(files);
            }}
          />
          <button
            type="button"
            disabled={!!upload}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-black text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {upload ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
            {upload ? `بارگذاری ${upload.done.toLocaleString("fa-IR")} از ${upload.total.toLocaleString("fa-IR")}` : "افزودن صفحه‌ها"}
          </button>
          <p className="mt-2 text-[11px] text-slate-500">
            چند فایل را همزمان انتخاب کنید یا اینجا رها کنید. صفحه‌ها بر اساس نام فایل مرتب می‌شوند؛ بعد می‌توانید با کشیدن، ترتیب را تغییر دهید.
          </p>
          <p className="mt-1 text-[10px] text-slate-500">قالب‌های مجاز: JPEG، PNG، WebP، AVIF · حداکثر ۱۲ مگابایت برای هر صفحه</p>
          {upload && (
            <div className="mx-auto mt-3 h-1.5 w-48 overflow-hidden rounded-full bg-slate-700/30">
              <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${Math.round((upload.done / Math.max(1, upload.total)) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {!readOnly && pages.length > 0 && (
        <div className={`flex flex-wrap items-center gap-2 border-y px-3 py-2 ${isDark ? "border-violet-950/50 bg-[#0e0a1c]" : "border-stone-200 bg-stone-50"}`}>
          <span className="text-[10px] font-bold text-slate-500">
            {selectedIds.size > 0 ? `${selectedIds.size.toLocaleString("fa-IR")} صفحه انتخاب شده` : "برای عملیات گروهی، صفحه‌ها را انتخاب کنید"}
          </span>
          <button type="button" className={chipButton(false)} disabled={selectedIds.size === 0} onClick={() => markSelectedSpread(true)}>
            علامت‌گذاری به‌عنوان گسترده
          </button>
          <button type="button" className={chipButton(false)} disabled={selectedIds.size === 0} onClick={() => markSelectedSpread(false)}>
            حذف حالت گسترده
          </button>
          <button
            type="button"
            className="rounded-lg bg-rose-500/15 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-600 hover:text-white disabled:opacity-40"
            disabled={selectedIds.size === 0}
            onClick={() => void deletePages([...selectedIds])}
          >
            حذف انتخاب‌شده‌ها
          </button>
          <button type="button" className={chipButton(false)} onClick={() => setSelectedIds(new Set(pages.map((page) => page.id)))}>
            انتخاب همه
          </button>
          {selectedIds.size > 0 && (
            <button type="button" className={chipButton(false)} onClick={() => setSelectedIds(new Set())}>
              لغو انتخاب
            </button>
          )}
          <button type="button" className={`${chipButton(false)} ms-auto`} onClick={reverseOrder}>
            معکوس کردن ترتیب
          </button>
          {missingAltCount > 0 && (
            <span className="text-[10px] font-bold text-amber-500">
              {missingAltCount.toLocaleString("fa-IR")} صفحه بدون متن جانشین
            </span>
          )}
        </div>
      )}

      <input
        ref={replaceInputRef}
        type="file"
        accept={MANGA_PAGE_MIME_TYPES.join(",")}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const pageId = replaceTargetRef.current;
          event.target.value = "";
          replaceTargetRef.current = null;
          if (file && pageId) void replacePageImage(pageId, file);
        }}
      />

      <div className="p-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs font-bold text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> در حال بارگذاری صفحه‌ها…
          </div>
        ) : pages.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-500">
            {chapterId
              ? "این فصل هنوز صفحه‌ای ندارد. برای انتشار، حداقل یک صفحه لازم است."
              : "پس از افزودن نخستین صفحه، فصل به‌صورت پیش‌نویس ساخته می‌شود."}
          </p>
        ) : (
          <ol
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
            aria-label={`صفحه‌های ${chapterTitle}`}
          >
            {pages.map((page, index) => {
              const isSelected = selectedIds.has(page.id);
              const isDragging = dragIndex === index;
              const isDropTarget = dragOverIndex === index && dragIndex !== null && dragIndex !== index;
              return (
                <li
                  key={page.id}
                  draggable={!readOnly}
                  onDragStart={(event) => {
                    if (readOnly) return;
                    setDragIndex(index);
                    event.dataTransfer.effectAllowed = "move";
                    // Firefox requires a payload before a drag starts.
                    event.dataTransfer.setData("text/plain", page.id);
                  }}
                  onDragOver={(event) => {
                    if (readOnly || dragIndex === null) return;
                    event.preventDefault();
                    setDragOverIndex(index);
                  }}
                  onDrop={(event) => {
                    if (readOnly || dragIndex === null) return;
                    event.preventDefault();
                    mutate(reorder(pages, dragIndex, index));
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  className={`relative flex flex-col gap-2 rounded-2xl border p-2 transition-all ${
                    isDropTarget ? "border-violet-500 ring-2 ring-violet-500/40" : isSelected ? "border-violet-500" : isDark ? "border-violet-950/60" : "border-stone-200"
                  } ${isDragging ? "opacity-50" : ""} ${isDark ? "bg-[#0e0a1c]" : "bg-stone-50"}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <label className="flex items-center gap-1.5 text-[11px] font-black text-violet-400">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelected(page.id)}
                        className="h-4 w-4 accent-violet-500"
                        aria-label={`انتخاب صفحهٔ ${page.pageNumber}`}
                      />
                      <span>صفحهٔ {page.pageNumber.toLocaleString("fa-IR")}</span>
                    </label>
                    {page.isSpread && (
                      <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-black text-violet-300">گسترده</span>
                    )}
                  </div>

                  <div className={`relative overflow-hidden rounded-xl ${isDark ? "bg-black/40" : "bg-white"}`}>
                    <SafeImage
                      src={page.imageUrl}
                      alt={page.altText || `پیش‌نمایش صفحهٔ ${page.pageNumber}`}
                      loading="lazy"
                      decoding="async"
                      className="h-40 w-full object-contain"
                    />
                  </div>

                  {!readOnly && (
                    <>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => movePage(index, readingDirection === "rtl" ? 1 : -1)}
                          className={chipButton(false)}
                          title={readingDirection === "rtl" ? "یک صفحه به بعد" : "یک صفحه به قبل"}
                          aria-label={readingDirection === "rtl" ? "انتقال به صفحهٔ بعد" : "انتقال به صفحهٔ قبل"}
                        >
                          <ArrowLeft className="h-3.5 w-3.5" />
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={pages.length}
                          value={page.pageNumber}
                          onChange={(event) => movePageTo(index, Number(event.target.value))}
                          className={`w-14 rounded-lg border px-1.5 py-1 text-center text-[11px] ${
                            isDark ? "border-violet-950 bg-[#0b0716] text-white" : "border-stone-200 bg-white text-stone-900"
                          }`}
                          aria-label={`جای‌گیری صفحهٔ ${page.pageNumber}`}
                        />
                        <button
                          type="button"
                          onClick={() => movePage(index, readingDirection === "rtl" ? -1 : 1)}
                          className={chipButton(false)}
                          title={readingDirection === "rtl" ? "یک صفحه به قبل" : "یک صفحه به بعد"}
                          aria-label={readingDirection === "rtl" ? "انتقال به صفحهٔ قبل" : "انتقال به صفحهٔ بعد"}
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <input
                        type="text"
                        value={page.altText}
                        onChange={(event) => setAltText(page.id, event.target.value)}
                        placeholder="متن جانشین (برای دسترس‌پذیری)"
                        className={`w-full rounded-lg border px-2 py-1 text-[11px] ${
                          isDark ? "border-violet-950 bg-[#0b0716] text-white" : "border-stone-200 bg-white text-stone-900"
                        }`}
                        aria-label={`متن جانشین صفحهٔ ${page.pageNumber}`}
                      />

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleSpread(page.id)}
                          className={chipButton(page.isSpread)}
                          title="صفحهٔ گسترده (دوصفحه‌ای) — در نمای دوصفحه‌ای تنها نمایش داده می‌شود"
                        >
                          <Columns2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            replaceTargetRef.current = page.id;
                            replaceInputRef.current?.click();
                          }}
                          className={chipButton(false)}
                          title="جای‌گزینی تصویر این صفحه"
                          aria-label={`جای‌گزینی تصویر صفحهٔ ${page.pageNumber}`}
                        >
                          <Replace className="h-3.5 w-3.5" />
                        </button>
                        <a
                          href={page.imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${chipButton(false)} inline-flex`}
                          title="مشاهدهٔ تصویر در اندازهٔ اصلی"
                        >
                          <ArrowDownToLine className="h-3.5 w-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => void deletePages([page.id])}
                          className="ms-auto rounded-lg bg-rose-500/15 px-2 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-600 hover:text-white"
                          title="حذف این صفحه"
                          aria-label={`حذف صفحهٔ ${page.pageNumber}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {(page.width || page.height) && (
                        <span className="text-center text-[9px] font-mono text-slate-500">
                          {Number(page.width || 0).toLocaleString("fa-IR")}×{Number(page.height || 0).toLocaleString("fa-IR")}
                        </span>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
