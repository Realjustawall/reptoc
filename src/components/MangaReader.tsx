import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ChevronLeft, ChevronRight, Columns2, Loader2, Maximize2, Minimize2, RefreshCw, Rows3,
  Settings2, Square, ZoomIn, ZoomOut,
} from "lucide-react";
import SafeImage from "./SafeImage";
import {
  buildMangaSpreads,
  mangaPageAltText,
  mangaProgressPercent,
  normalizeMangaReadingMode,
  type MangaPage,
  type MangaReadingMode,
  type ReadingDirection,
} from "../../shared/manga";

/**
 * Manga reader.
 *
 * Prose is read by scrolling; manga is read by turning pages, so this is a
 * separate surface rather than a variant of the prose reader:
 *   - single page, two-page spread, or continuous vertical strip (webtoon);
 *   - page-turn direction follows the work (`rtl` by default, as in print manga);
 *   - keyboard, click-zone and swipe navigation, all honouring that direction;
 *   - zoom / fit modes, because a scan's natural size rarely matches the screen.
 *
 * The component reports the page it is on so the surrounding reader can persist
 * reading progress with the same pipeline prose uses.
 */

export interface MangaReaderSettings {
  mode: MangaReadingMode;
  /** Fit the page to the viewport height, its width, or show it at 100%. */
  fit: "height" | "width" | "original";
  zoom: number;
  /** Hide the page chrome until the reader taps/moves the pointer. */
  immersive: boolean;
}

export const MANGA_READER_STORAGE_KEY = "reptoc-manga-reader";
export const MANGA_ZOOM_RANGE = { min: 0.5, max: 3 } as const;

export const DEFAULT_MANGA_READER_SETTINGS: MangaReaderSettings = {
  mode: "single",
  fit: "height",
  zoom: 1,
  immersive: false,
};

export function normalizeMangaReaderSettings(value: unknown): MangaReaderSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<MangaReaderSettings>;
  const zoom = Number(raw.zoom);
  return {
    mode: normalizeMangaReadingMode(raw.mode),
    fit: raw.fit === "width" || raw.fit === "original" ? raw.fit : "height",
    zoom: Number.isFinite(zoom) ? Math.min(MANGA_ZOOM_RANGE.max, Math.max(MANGA_ZOOM_RANGE.min, zoom)) : 1,
    immersive: raw.immersive === true,
  };
}

export interface MangaReaderProps {
  pages: MangaPage[];
  chapterTitle: string;
  chapterNumber: number;
  novelTitle: string;
  readingDirection: ReadingDirection;
  theme: "light" | "dark";
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  /** Page index to open on (0-based); used to resume reading progress. */
  initialPageIndex?: number;
  onProgress?: (pageIndex: number, percent: number) => void;
  /** Called when the reader turns past the last (or before the first) page. */
  onRequestNextChapter?: () => void;
  onRequestPreviousChapter?: () => void;
}

/** Swipe threshold in pixels; below this a touch is treated as a tap. */
const SWIPE_THRESHOLD = 48;

function readStoredSettings(): MangaReaderSettings {
  if (typeof window === "undefined") return DEFAULT_MANGA_READER_SETTINGS;
  try {
    return normalizeMangaReaderSettings(JSON.parse(window.localStorage.getItem(MANGA_READER_STORAGE_KEY) || "null"));
  } catch {
    return DEFAULT_MANGA_READER_SETTINGS;
  }
}

export default function MangaReader({
  pages,
  chapterTitle,
  chapterNumber,
  novelTitle,
  readingDirection,
  theme,
  loading = false,
  error = "",
  onRetry,
  initialPageIndex = 0,
  onProgress,
  onRequestNextChapter,
  onRequestPreviousChapter,
}: MangaReaderProps) {
  const isDark = theme === "dark";
  const [settings, setSettings] = useState<MangaReaderSettings>(readStoredSettings);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const chromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportedPageRef = useRef(-1);
  const initialPositionAppliedRef = useRef(false);
  const layoutAnchorPageIdRef = useRef<string | null>(null);

  const orderedPages = useMemo(
    () => [...pages].sort((left, right) => left.pageNumber - right.pageNumber),
    [pages],
  );
  const spreads = useMemo(() => buildMangaSpreads(orderedPages, settings.mode), [orderedPages, settings.mode]);
  const totalPages = orderedPages.length;

  const updateSettings = useCallback((changes: Partial<MangaReaderSettings>) => {
    setSettings((current) => {
      const next = normalizeMangaReaderSettings({ ...current, ...changes });
      try {
        window.localStorage.setItem(MANGA_READER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // A private-mode browser refusing storage must not break reading.
      }
      return next;
    });
  }, []);

  /** Index of the first page in a spread, used to keep position across modes. */
  const currentPageIndex = useMemo(() => {
    const spread = spreads[Math.min(spreadIndex, Math.max(0, spreads.length - 1))];
    if (!spread || spread.length === 0) return 0;
    return orderedPages.findIndex((page) => page.id === spread[0].id);
  }, [orderedPages, spreadIndex, spreads]);

  const scrollStripToPage = useCallback((pageIndex: number) => {
    window.requestAnimationFrame(() => {
      stripRef.current
        ?.querySelector<HTMLElement>(`[data-manga-page-index="${pageIndex}"]`)
        ?.scrollIntoView({ behavior: "auto", block: "start" });
    });
  }, []);

  // Apply persisted progress once, after an asynchronously loaded page list is
  // available. Layout changes have their own anchor and must not reset this.
  useEffect(() => {
    if (spreads.length === 0 || initialPositionAppliedRef.current) return;
    const target = Math.max(0, Math.min(totalPages - 1, Math.floor(initialPageIndex)));
    const targetPage = orderedPages[target];
    if (!targetPage) return;
    const nextSpread = spreads.findIndex((spread) => spread.some((page) => page.id === targetPage.id));
    setSpreadIndex(nextSpread >= 0 ? nextSpread : 0);
    initialPositionAppliedRef.current = true;
    if (settings.mode === "strip") scrollStripToPage(target);
  }, [initialPageIndex, orderedPages, scrollStripToPage, settings.mode, spreads, totalPages]);

  const changeMode = useCallback((mode: MangaReadingMode) => {
    layoutAnchorPageIdRef.current = orderedPages[currentPageIndex]?.id || null;
    updateSettings({ mode });
  }, [currentPageIndex, orderedPages, updateSettings]);

  // Preserve the visible page when moving between single, double and strip.
  useEffect(() => {
    const anchorId = layoutAnchorPageIdRef.current;
    if (!anchorId || spreads.length === 0) return;
    layoutAnchorPageIdRef.current = null;
    const pageIndex = orderedPages.findIndex((page) => page.id === anchorId);
    const nextSpread = spreads.findIndex((spread) => spread.some((page) => page.id === anchorId));
    if (nextSpread >= 0) setSpreadIndex(nextSpread);
    if (settings.mode === "strip" && pageIndex >= 0) scrollStripToPage(pageIndex);
  }, [orderedPages, scrollStripToPage, settings.mode, spreads]);

  const visiblePageIndex = useMemo(() => {
    const spread = spreads[Math.min(spreadIndex, Math.max(0, spreads.length - 1))] || [];
    return spread.reduce((furthest, page) => Math.max(furthest, orderedPages.findIndex((item) => item.id === page.id)), currentPageIndex);
  }, [currentPageIndex, orderedPages, spreadIndex, spreads]);

  useEffect(() => {
    if (totalPages === 0) return;
    if (reportedPageRef.current === visiblePageIndex) return;
    reportedPageRef.current = visiblePageIndex;
    onProgress?.(visiblePageIndex, mangaProgressPercent(visiblePageIndex, totalPages));
  }, [onProgress, totalPages, visiblePageIndex]);

  const goToSpread = useCallback((next: number) => {
    if (spreads.length === 0) return;
    if (next < 0) {
      onRequestPreviousChapter?.();
      return;
    }
    if (next >= spreads.length) {
      onRequestNextChapter?.();
      return;
    }
    setSpreadIndex(next);
    stageRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [onRequestNextChapter, onRequestPreviousChapter, spreads.length]);

  /**
   * "Forward" and "back" are physical directions; which arrow key maps to which
   * depends on the work's page-turn direction. In RTL manga, pressing the left
   * arrow advances, exactly as turning a printed page leftwards does.
   */
  const advance = useCallback(() => goToSpread(spreadIndex + 1), [goToSpread, spreadIndex]);
  const retreat = useCallback(() => goToSpread(spreadIndex - 1), [goToSpread, spreadIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable='true']")) return;
      const rtl = readingDirection === "rtl";
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          if (settings.mode === "strip") return;
          rtl ? advance() : retreat();
          break;
        case "ArrowRight":
          event.preventDefault();
          if (settings.mode === "strip") return;
          rtl ? retreat() : advance();
          break;
        case "ArrowDown":
        case "PageDown":
        case " ":
          if (settings.mode === "strip") return;
          event.preventDefault();
          advance();
          break;
        case "ArrowUp":
        case "PageUp":
          if (settings.mode === "strip") return;
          event.preventDefault();
          retreat();
          break;
        case "Home":
          event.preventDefault();
          goToSpread(0);
          break;
        case "End":
          event.preventDefault();
          goToSpread(spreads.length - 1);
          break;
        case "f":
        case "F":
          setFullscreen((value) => !value);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance, goToSpread, readingDirection, retreat, settings.mode, spreads.length]);

  // Immersive mode: chrome fades out while reading and returns on interaction.
  const revealChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    if (!settings.immersive) return;
    chromeTimerRef.current = setTimeout(() => setChromeVisible(false), 2600);
  }, [settings.immersive]);

  useEffect(() => {
    revealChrome();
    return () => {
      if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    };
  }, [revealChrome, spreadIndex]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  // Continuous strip mode reports progress from the scroll position, because a
  // webtoon has no discrete page turns.
  useEffect(() => {
    if (settings.mode !== "strip" || totalPages === 0) return;
    const strip = stripRef.current;
    if (!strip) return;
    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const children = Array.from(strip.querySelectorAll<HTMLElement>("[data-manga-page-index]"));
        const viewportMiddle = strip.scrollTop + strip.clientHeight / 2;
        let visibleIndex = 0;
        for (const child of children) {
          if (child.offsetTop <= viewportMiddle) visibleIndex = Number(child.dataset.mangaPageIndex || 0);
        }
        if (reportedPageRef.current === visibleIndex) return;
        // In strip mode each spread is one page. Keeping this state in sync
        // makes the header, scrubber and a later switch to paged mode follow
        // the page actually visible in the viewport.
        setSpreadIndex(visibleIndex);
        reportedPageRef.current = visibleIndex;
        onProgress?.(visibleIndex, mangaProgressPercent(visibleIndex, totalPages));
      });
    };
    strip.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      strip.removeEventListener("scroll", onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [onProgress, settings.mode, totalPages]);

  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || settings.mode === "strip") return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY)) {
      revealChrome();
      return;
    }
    // Swiping leftwards in an RTL work turns to the next page.
    const swipedLeft = deltaX < 0;
    const rtl = readingDirection === "rtl";
    if (swipedLeft === rtl) advance();
    else retreat();
  };

  const pageStyle = useMemo<React.CSSProperties>(() => {
    const zoom = settings.zoom;
    if (settings.fit === "original") {
      return { width: "auto", maxWidth: "none", transform: `scale(${zoom})`, transformOrigin: "top center" };
    }
    if (settings.fit === "width") {
      return { width: `${Math.round(zoom * 100)}%`, height: "auto", maxWidth: "none" };
    }
    return {
      maxHeight: `${Math.round(zoom * 100)}%`,
      width: "auto",
      maxWidth: "100%",
      objectFit: "contain",
    };
  }, [settings.fit, settings.zoom]);

  const currentSpread = spreads[Math.min(spreadIndex, Math.max(0, spreads.length - 1))] || [];
  const stageBackground = isDark ? "bg-[var(--app-subtle)]" : "bg-[#f1f1f1]";
  const chrome = "bg-[var(--app-header)] text-[var(--app-text)]";
  const chipButton = (active: boolean) =>
    `inline-flex min-h-9 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
      active ? (isDark ? "bg-violet-600 text-white" : "bg-orange-600 text-white") : isDark ? "bg-slate-800/70 text-slate-300 hover:bg-slate-700" : "bg-[#f2f2f2] text-stone-700 hover:bg-orange-50 hover:text-orange-700"
    }`;

  if (loading) {
    return (
      <div className={`flex min-h-[60vh] items-center justify-center rounded-2xl ${stageBackground}`} aria-busy="true">
        <span className="flex items-center gap-2 text-xs font-bold text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> در حال بارگذاری صفحه‌ها…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-2xl px-6 text-center ${stageBackground}`} role="alert">
        <AlertTriangle className={`h-7 w-7 ${isDark ? "text-amber-400" : "text-orange-600"}`} />
        <span className={`text-sm font-bold ${isDark ? "text-slate-200" : "text-stone-800"}`}>{error}</span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-full bg-orange-600 px-4 py-2 text-xs font-black text-white transition-colors hover:bg-orange-500">
            <RefreshCw className="h-4 w-4" /> تلاش دوباره
          </button>
        )}
      </div>
    );
  }

  if (totalPages === 0) {
    return (
      <div className={`flex min-h-[40vh] flex-col items-center justify-center gap-2 rounded-2xl ${stageBackground} text-center`}>
        <span className={`text-sm font-bold ${isDark ? "text-slate-300" : "text-stone-900"}`}>این فصل هنوز صفحه‌ای ندارد.</span>
        <span className={`text-xs ${isDark ? "text-slate-500" : "text-stone-600"}`}>به‌زودی صفحه‌ها منتشر می‌شوند.</span>
      </div>
    );
  }

  const progressPercent = mangaProgressPercent(visiblePageIndex, totalPages);

  return (
    <div
      className={`${fullscreen ? "fixed inset-0 z-[70]" : "relative rounded-2xl"} flex flex-col overflow-hidden ${stageBackground}`}
      dir={readingDirection}
      data-manga-reader={settings.mode}
      onMouseMove={settings.immersive ? revealChrome : undefined}
    >
      {/* Page chrome. Kept above the stage so a tall page never covers it. */}
      <header
        className={`z-20 flex flex-wrap items-center gap-2 border-b px-3 py-2 backdrop-blur-md transition-opacity ${chrome} ${
          isDark ? "border-violet-950/40" : "border-stone-200"
        } ${chromeVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-bold text-slate-500">{novelTitle}</p>
          <p className="truncate text-xs font-black">
            فصل {chapterNumber.toLocaleString("fa-IR")}: {chapterTitle}
          </p>
        </div>

        <span className={`rounded-lg px-2 py-1 text-[11px] font-black tabular-nums ${isDark ? "bg-violet-500/15 text-violet-300" : "bg-orange-50 text-orange-700"}`}>
          {(visiblePageIndex + 1).toLocaleString("fa-IR")} / {totalPages.toLocaleString("fa-IR")}
        </span>

        <div className="flex items-center gap-1">
          <button type="button" className={chipButton(settings.mode === "single")} onClick={() => changeMode("single")} title="نمای یک‌صفحه‌ای" aria-label="نمای یک‌صفحه‌ای">
            <Square className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={chipButton(settings.mode === "double")} onClick={() => changeMode("double")} title="نمای دوصفحه‌ای" aria-label="نمای دوصفحه‌ای">
            <Columns2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={chipButton(settings.mode === "strip")} onClick={() => changeMode("strip")} title="نمای نواری پیوسته (وب‌تون)" aria-label="نمای نواری پیوسته">
            <Rows3 className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          type="button"
          className={chipButton(showSettings)}
          onClick={() => setShowSettings((value) => !value)}
          title="تنظیمات نمایش"
          aria-label="تنظیمات نمایش"
          aria-expanded={showSettings}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={chipButton(fullscreen)}
          onClick={() => setFullscreen((value) => !value)}
          title={fullscreen ? "خروج از تمام‌صفحه (Esc)" : "تمام‌صفحه (F)"}
          aria-label={fullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
        >
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </header>

      {showSettings && (
        <div className={`z-20 flex flex-wrap items-center gap-3 border-b px-3 py-2 text-[11px] ${chrome} ${isDark ? "border-violet-950/40" : "border-stone-200"}`}>
          <div className="flex items-center gap-1">
            <span className="text-slate-500">اندازه:</span>
            <button type="button" className={chipButton(settings.fit === "height")} onClick={() => updateSettings({ fit: "height" })}>هم‌اندازهٔ ارتفاع</button>
            <button type="button" className={chipButton(settings.fit === "width")} onClick={() => updateSettings({ fit: "width" })}>هم‌اندازهٔ عرض</button>
            <button type="button" className={chipButton(settings.fit === "original")} onClick={() => updateSettings({ fit: "original" })}>اندازهٔ اصلی</button>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-slate-500">بزرگ‌نمایی:</span>
            <button
              type="button"
              className={chipButton(false)}
              onClick={() => updateSettings({ zoom: Math.max(MANGA_ZOOM_RANGE.min, Math.round((settings.zoom - 0.1) * 10) / 10) })}
              aria-label="کوچک‌نمایی"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="w-12 text-center font-mono tabular-nums text-slate-400">{Math.round(settings.zoom * 100).toLocaleString("fa-IR")}%</span>
            <button
              type="button"
              className={chipButton(false)}
              onClick={() => updateSettings({ zoom: Math.min(MANGA_ZOOM_RANGE.max, Math.round((settings.zoom + 0.1) * 10) / 10) })}
              aria-label="بزرگ‌نمایی"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            {settings.zoom !== 1 && (
              <button type="button" className={chipButton(false)} onClick={() => updateSettings({ zoom: 1 })}>بازنشانی</button>
            )}
          </div>

          <button type="button" className={chipButton(settings.immersive)} onClick={() => updateSettings({ immersive: !settings.immersive })} aria-pressed={settings.immersive}>
            پنهان‌سازی خودکار نوار
          </button>

          <span className="ms-auto text-[10px] text-slate-500">
            {readingDirection === "rtl" ? "ترتیب خواندن: راست به چپ" : "ترتیب خواندن: چپ به راست"}
          </span>
        </div>
      )}

      {/* Reading stage */}
      {settings.mode === "strip" ? (
        <div ref={stripRef} className="flex-1 overflow-y-auto" style={{ maxHeight: fullscreen ? "100vh" : "80vh" }}>
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
            {orderedPages.map((page, index) => (
              <SafeImage
                key={page.id}
                data-manga-page-index={index}
                src={page.imageUrl}
                alt={mangaPageAltText(page, chapterTitle)}
                loading={index < 2 ? "eager" : "lazy"}
                decoding="async"
                width={page.width || undefined}
                height={page.height || undefined}
                className="block w-full"
                style={settings.fit === "original" ? { width: "auto", maxWidth: "none" } : { width: `${Math.round(settings.zoom * 100)}%` }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={stageRef}
          className="relative flex flex-1 items-center justify-center overflow-auto"
          style={{ minHeight: fullscreen ? "calc(100vh - 96px)" : "clamp(420px, 74vh, 900px)" }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className={`flex h-full w-full items-center justify-center gap-1 ${settings.fit === "height" ? "" : "flex-col"}`}>
            {currentSpread.map((page) => (
              <SafeImage
                key={page.id}
                src={page.imageUrl}
                alt={mangaPageAltText(page, chapterTitle)}
                loading="eager"
                decoding="async"
                width={page.width || undefined}
                height={page.height || undefined}
                className={`block select-none ${isDark ? "" : "shadow-[0_8px_30px_rgba(0,0,0,0.14)]"}`}
                style={pageStyle}
                draggable={false}
              />
            ))}
          </div>

          {/* Click zones. The forward zone is on the side the reader turns
              towards, so a tap always does what the direction implies. */}
          <button
            type="button"
            onClick={readingDirection === "rtl" ? advance : retreat}
            className="absolute inset-y-0 start-0 w-1/4 cursor-w-resize opacity-0"
            aria-label={readingDirection === "rtl" ? "صفحهٔ بعد" : "صفحهٔ قبل"}
            tabIndex={-1}
          />
          <button
            type="button"
            onClick={readingDirection === "rtl" ? retreat : advance}
            className="absolute inset-y-0 end-0 w-1/4 cursor-e-resize opacity-0"
            aria-label={readingDirection === "rtl" ? "صفحهٔ قبل" : "صفحهٔ بعد"}
            tabIndex={-1}
          />

          {/* Preload the next spread so a page turn is instant. */}
          <div className="hidden" aria-hidden="true">
            {(spreads[spreadIndex + 1] || []).map((page) => (
              <img key={`preload-${page.id}`} src={page.imageUrl} alt="" loading="eager" decoding="async" />
            ))}
          </div>
        </div>
      )}

      {/* Footer navigation and the page scrubber. */}
      <footer
        className={`z-20 flex flex-wrap items-center gap-2 border-t px-3 py-2 backdrop-blur-md transition-opacity ${chrome} ${
          isDark ? "border-violet-950/40" : "border-stone-200"
        } ${chromeVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        {settings.mode !== "strip" && (
          <>
            <button
              type="button"
              onClick={retreat}
              className={`${chipButton(false)} min-w-11 justify-center`}
              aria-label="صفحهٔ قبل"
              title="صفحهٔ قبل"
            >
              {readingDirection === "rtl" ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={advance}
              className={`${chipButton(false)} min-w-11 justify-center`}
              aria-label="صفحهٔ بعد"
              title="صفحهٔ بعد"
            >
              {readingDirection === "rtl" ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </>
        )}

        <label className="flex min-w-40 flex-1 items-center gap-2">
          <span className="sr-only">پیمایش صفحه‌ها</span>
          <input
            type="range"
            min={1}
            max={totalPages}
            value={visiblePageIndex + 1}
            onChange={(event) => {
              const targetPage = orderedPages[Number(event.target.value) - 1];
              if (!targetPage) return;
              if (settings.mode === "strip") {
                setSpreadIndex(Number(event.target.value) - 1);
                const element = stripRef.current?.querySelector<HTMLElement>(`[data-manga-page-index="${Number(event.target.value) - 1}"]`);
                element?.scrollIntoView({ behavior: "auto", block: "start" });
                return;
              }
              const nextSpread = spreads.findIndex((spread) => spread.some((page) => page.id === targetPage.id));
              if (nextSpread >= 0) setSpreadIndex(nextSpread);
            }}
            className={`w-full ${isDark ? "accent-violet-500" : "accent-orange-600"}`}
            aria-label="پیمایش صفحه‌ها"
          />
        </label>

        <span className="text-[10px] font-bold tabular-nums text-slate-500">
          {progressPercent.toLocaleString("fa-IR")}%
        </span>
      </footer>
    </div>
  );
}
