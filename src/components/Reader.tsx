import React, { useState, useEffect, useRef } from "react";
import { Chapter, Novel } from "../types";
import { CONTRAST_THEMES } from "../data";
import { ChevronLeft, ChevronRight, Settings2, BookOpen, Menu, Sparkles, Sliders, Type, HelpCircle, Save, Check, AlignLeft, AlignCenter, AlignJustify, AlignRight, Eye, Layout, MessageSquare, Heart, Reply, Share2, Maximize2, Minimize2, Download, Trash2, ShieldAlert } from "lucide-react";
import { api } from "../utils/api";
import { isSafeUrl } from "../utils/safeUrl";
import { copyLink } from "../utils/share";
import ReportButton from "./ReportButton";
import ReadingMusicPlayer from "./ReadingMusicPlayer";
import ParagraphCommentPanel from "./ParagraphCommentPanel";
import SafeImage from "./SafeImage";
import AuthorLinksDisplay from "./AuthorLinksDisplay";
import MangaReader from "./MangaReader";
import { normalizeReadingProgressPercent, readingProgressFromContent, scrollTopForReadingProgress, shouldPublishReadingProgress } from "../utils/renderStability";
import { isMangaWork, mangaPageIndexFromPercent, normalizeReadingDirection, type MangaPage } from "../../shared/manga";
import { isChapterOffline, removeChapterOffline, saveChapterOffline } from "../utils/offlineLibrary";

interface ReaderProps {
  key?: React.Key;
  novel: Novel;
  chapter: Chapter;
  currentUser?: any;
  onBackToNovel: () => void;
  onNavigateChapter: (chapterId: string) => void;
  onUpdateScroll: (chapterId: string, percent: number, options?: { forceSync?: boolean; keepalive?: boolean }) => void;
  onChapterLikeChange?: (novelId: string, chapterId: string, liked: boolean, chapterLikesCount: number, novelLikesCount: number) => void;
  onSelectUser?: (username: string) => void;
  theme: "light" | "dark";
  bookMode?: boolean;
  onBookModeChange?: (enabled: boolean) => void;
  initialProgressPercent?: number;
}

function getSafeAvatarUrl(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("<") || /<\/?[a-z][\s\S]*>/i.test(raw)) return null;
  if (raw.startsWith("/uploads/avatars/") || raw.startsWith("/api/upload/avatar/")) return raw;
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!/\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(parsed.pathname + parsed.search)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

type ReaderFont = "estedad" | "vazirmatn" | "sans" | "serif" | "mono" | "space" | "georgia" | "system-ui";
type ReaderAlign = "justify" | "left" | "center" | "right";
type ReaderThemePreset = "system" | "sepia" | "white" | "coal" | "black" | "forest" | "royal";
type ReaderContainerWidth = "narrow" | "normal" | "wide";

interface ReaderSettings {
  fontFamily: ReaderFont;
  fontSize: number;
  lineHeight: number;
  textAlign: ReaderAlign;
  themePreset: ReaderThemePreset;
  containerWidth: ReaderContainerWidth;
  blurredCoverBackground: boolean;
  bookWidth: number;
  bookHeight: number;
}

const READER_BOOK_WIDTH_RANGE = { min: 720, max: 1400 } as const;
const READER_BOOK_HEIGHT_RANGE = { min: 480, max: 1100 } as const;
const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontFamily: "estedad",
  fontSize: 18,
  lineHeight: 1.8,
  textAlign: "justify",
  themePreset: "system",
  containerWidth: "normal",
  blurredCoverBackground: true,
  bookWidth: 1184,
  bookHeight: 680,
};

function normalizeReaderSettings(value: unknown): ReaderSettings {
  const raw = value && typeof value === "object" ? value as Partial<ReaderSettings> : {};
  const width = Number(raw.bookWidth);
  const height = Number(raw.bookHeight);
  return {
    ...DEFAULT_READER_SETTINGS,
    ...raw,
    bookWidth: Number.isFinite(width) ? Math.min(READER_BOOK_WIDTH_RANGE.max, Math.max(READER_BOOK_WIDTH_RANGE.min, Math.round(width))) : DEFAULT_READER_SETTINGS.bookWidth,
    bookHeight: Number.isFinite(height) ? Math.min(READER_BOOK_HEIGHT_RANGE.max, Math.max(READER_BOOK_HEIGHT_RANGE.min, Math.round(height))) : DEFAULT_READER_SETTINGS.bookHeight,
  };
}

function sanitizeReaderHtml(html: string) {
  if (typeof window === "undefined") return "";
  const template = document.createElement("template");
  template.innerHTML = html || "";
  
  const blockedTags = new Set(["script", "iframe", "object", "embed", "link", "meta", "style", "svg", "video", "audio", "source", "track", "form", "input", "button"]);
  const safeTags = new Set(["div", "span", "p", "a", "img", "br", "strong", "em", "u", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "hr"]);
  
  const sanitizeNode = (node: Node): void => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const tagName = element.tagName.toLowerCase();
      if (blockedTags.has(tagName)) { element.remove(); return; }
      if (!safeTags.has(tagName)) {
        while (element.firstChild) element.parentNode?.insertBefore(element.firstChild, element);
        element.remove();
        return;
      }
      const safeAttrs: {[key: string]: string} = {};
      if (tagName === 'a') {
        const href = element.getAttribute('href') || '';
        if (href && isSafeUrl(href)) {
          safeAttrs['href'] = href; safeAttrs['target'] = '_blank'; safeAttrs['rel'] = 'noopener noreferrer';
        }
      } else if (tagName === 'img') {
        const src = element.getAttribute('src') || '';
        const localImage = /^\/(?:uploads\/|api\/(?:files|upload)\/[^/]+\/content|api\/upload\/avatar\/|api\/novels\/[^/]+\/cover)/i.test(src);
        if (src && (src.toLowerCase().startsWith('https:') || localImage)) {
          safeAttrs['src'] = src; safeAttrs['alt'] = element.getAttribute('alt') || 'تصویر';
          safeAttrs['loading'] = 'lazy';
          safeAttrs['decoding'] = 'async';
          const width = element.getAttribute('width'), height = element.getAttribute('height');
          if (width && /^\d+$/.test(width)) safeAttrs['width'] = width;
          if (height && /^\d+$/.test(height)) safeAttrs['height'] = height;
          // Layout chosen by the author in the writing workspace. These are
          // inert data attributes rendered through stylesheet rules, so the
          // published chapter matches the editor preview exactly.
          const dataWidth = element.getAttribute('data-width') || '';
          const dataAlign = element.getAttribute('data-align') || '';
          const dataFloat = element.getAttribute('data-float') || '';
          if (['small', 'medium', 'full'].includes(dataWidth)) safeAttrs['data-width'] = dataWidth;
          if (['start', 'center', 'end'].includes(dataAlign)) safeAttrs['data-align'] = dataAlign;
          if (['start', 'end'].includes(dataFloat)) safeAttrs['data-float'] = dataFloat;
        }
      }
      Array.from(element.attributes).forEach(attr => element.removeAttribute(attr.name));
      Object.entries(safeAttrs).forEach(([key, value]) => element.setAttribute(key, value));
      Array.from(element.childNodes).forEach(sanitizeNode);
    } else if (node.nodeType !== Node.TEXT_NODE) node.parentNode?.removeChild(node);
  };
  
  Array.from(template.content.childNodes).forEach(sanitizeNode);
  return template.innerHTML;
}

type ParagraphIdentity = NonNullable<Chapter["paragraphs"]>[number];

interface ChapterRenderBlock {
  html: string;
  text: string;
}

export function buildChapterRenderBlocks(content: string): ChapterRenderBlock[] {
  const source = String(content || "");
  if (!source.trim().startsWith("<")) {
    return source
      .split(/\n\s*\n/)
      .filter((paragraph) => paragraph.trim().length > 0)
      .map((text) => ({ html: "", text }));
  }

  // The browser sanitizer relies on the DOM. Server-side markup is only a
  // fallback for tests/crawlers; the interactive reader builds the safe rich
  // element tree below in the browser.
  if (typeof window === "undefined") {
    const text = source.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "").trim();
    return text ? [{ html: "", text }] : [];
  }

  const sanitized = sanitizeReaderHtml(source);
  const blocks = [...sanitized.matchAll(/<(p|h[1-6]|li|blockquote)\b[^>]*>[\s\S]*?<\/\1>/gi)]
    .map((match) => ({ html: match[0], text: "" }));
  return blocks.length ? blocks : sanitized ? [{ html: sanitized, text: "" }] : [];
}

function readerHtmlNodeToReact(node: Node, key: string): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();
  const props: Record<string, unknown> = { key };
  if (tagName === "a") {
    props.href = element.getAttribute("href") || undefined;
    props.target = element.getAttribute("target") || undefined;
    props.rel = element.getAttribute("rel") || undefined;
  } else if (tagName === "img") {
    props.src = element.getAttribute("src") || undefined;
    props.alt = element.getAttribute("alt") || "تصویر";
    props.loading = "lazy";
    props.decoding = "async";
    props.width = element.getAttribute("width") || undefined;
    props.height = element.getAttribute("height") || undefined;
    // Carried through to React so the chapter stylesheet can size and align
    // the illustration exactly as the author arranged it in the editor.
    props["data-width"] = element.getAttribute("data-width") || undefined;
    props["data-align"] = element.getAttribute("data-align") || undefined;
    props["data-float"] = element.getAttribute("data-float") || undefined;
  }
  const children = Array.from(element.childNodes).map((child, index) => readerHtmlNodeToReact(child, `${key}-${index}`));
  return React.createElement(tagName, props, ...children);
}

function readerHtmlToReact(html: string): React.ReactNode {
  if (typeof document === "undefined") return null;
  const template = document.createElement("template");
  template.innerHTML = html;
  return Array.from(template.content.childNodes).map((node, index) => readerHtmlNodeToReact(node, `rich-${index}`));
}

const StaticChapterBlock = React.memo(function StaticChapterBlock({
  block,
  index,
  alignment,
  readerBorder,
}: {
  block: ChapterRenderBlock;
  index: number;
  alignment: string;
  readerBorder: string;
}) {
  const paragraph = block.text;
  const richContent = React.useMemo(() => block.html ? readerHtmlToReact(block.html) : null, [block.html]);
  const isSystemAlert = paragraph && paragraph.trim().startsWith("[") && paragraph.trim().endsWith("]");
  const isSpeech = paragraph && (paragraph.trim().startsWith('"') || paragraph.trim().startsWith("“"));

  if (block.html) {
    return <div data-reader-static-text="rich" className={`leading-relaxed ${alignment}`}>{richContent}</div>;
  }
  if (isSystemAlert) {
    return <div data-reader-static-text="alert" className={`my-6 rounded-xl border p-4 ${readerBorder} bg-violet-950/30 font-mono text-sm leading-relaxed text-violet-400 shadow-[0_0_15px_rgba(139,92,246,0.1)]`}>{paragraph}</div>;
  }
  return (
    <p data-reader-static-text="paragraph" className={`mb-6 indent-4 leading-relaxed ${alignment} ${isSpeech ? "font-semibold text-violet-600 dark:text-violet-300" : ""}`}>
      {index === 0 && paragraph.trim() ? <>
        <span className="float-left pr-2 pt-1 font-mono text-5xl font-extrabold leading-[0.8] text-violet-500">{paragraph.trim().charAt(0)}</span>
        {paragraph.trim().slice(1)}
      </> : paragraph}
    </p>
  );
});

const StableChapterHeading = React.memo(function StableChapterHeading({
  chapterNumber,
  isAuxiliary,
  title,
  createdAt,
  wordCount,
  pageCount,
  readerBorder,
  readerTitleColor,
}: {
  chapterNumber: number;
  isAuxiliary?: boolean;
  title: string;
  createdAt: string;
  wordCount: number;
  /** Present for manga chapters, which are measured in pages, not words. */
  pageCount?: number;
  readerBorder: string;
  readerTitleColor: string;
}) {
  return (
    <section className={`text-center space-y-3 pb-8 border-b border-dashed ${readerBorder}`} data-stable-chapter-heading={chapterNumber}>
      <span className={`text-xs font-mono font-bold uppercase tracking-widest ${isAuxiliary ? "text-violet-400" : readerTitleColor}`}>{isAuxiliary ? `فرعی ${chapterNumber}` : `فصل ${chapterNumber}`}</span>
      <h2 className="text-2xl md:text-4xl font-extrabold tracking-tight">{title}</h2>
      <div className="flex items-center justify-center gap-1.5 text-xs opacity-60 font-medium">
        <span>منتشرشده: {new Date(createdAt).toLocaleDateString("fa-IR")}</span><span>•</span>
        <span>{pageCount === undefined ? `تعداد کلمات: ${wordCount} کلمه` : `${pageCount.toLocaleString("fa-IR")} صفحه`}</span>
      </div>
    </section>
  );
});

const StableChapterStory = React.memo(function StableChapterStory({
  novelId,
  chapterId,
  content,
  paragraphs,
  currentUser,
  paragraphCommentCounts,
  activeParagraph,
  textAlign,
  readerBorder,
  onSelectParagraph,
  onCloseParagraph,
  onParagraphCountChange,
}: {
  novelId: string;
  chapterId: string;
  content: string;
  paragraphs?: Chapter["paragraphs"];
  currentUser?: any;
  paragraphCommentCounts: Record<string, number>;
  activeParagraph: ParagraphIdentity | null;
  textAlign: ReaderAlign;
  readerBorder: string;
  onSelectParagraph: (paragraph: ParagraphIdentity) => void;
  onCloseParagraph: () => void;
  onParagraphCountChange: (paragraphId: string, count: number) => void;
}) {
  const blocks = React.useMemo(() => buildChapterRenderBlocks(content), [content]);
  const identitiesByOrdinal = React.useMemo(
    () => new Map((paragraphs || []).map((paragraph) => [paragraph.ordinal, paragraph])),
    [paragraphs],
  );
  const alignment = textAlign === "justify" ? "text-justify" : textAlign === "center" ? "text-center" : textAlign === "right" ? "text-right" : "text-left";
  return (
    <div className="chapter-story-body space-y-4" data-stable-chapter-story={`${chapterId}:${content.length}`}>
      {blocks.map((block, index) => {
        const identity = identitiesByOrdinal.get(index);
        const count = identity ? Number(paragraphCommentCounts[identity.id] || 0) : 0;
        return (
          <React.Fragment key={identity?.id || `chapter-block-${index}`}>
            <div className="group/paragraph relative pr-8">
              <StaticChapterBlock block={block} index={index} alignment={alignment} readerBorder={readerBorder} />
              {identity && (
                <button
                  type="button"
                  onClick={() => onSelectParagraph(identity)}
                  aria-label={`باز کردن ${count} دیدگاه پاراگراف ${index + 1}`}
                  title={`دیدگاه‌های پاراگراف ${index + 1}`}
                  className="absolute right-0 top-1 inline-flex min-h-7 min-w-7 items-center justify-center gap-1 rounded-lg border border-current/10 bg-current/[0.04] px-1.5 text-[9px] opacity-45 transition hover:opacity-100 focus-visible:opacity-100"
                >
                  <MessageSquare className="h-3.5 w-3.5" /><span>{count}</span>
                </button>
              )}
              {identity && activeParagraph?.id === identity.id && (
                <ParagraphCommentPanel
                  novelId={novelId}
                  chapterId={chapterId}
                  paragraphId={identity.id}
                  paragraphNumber={identity.ordinal + 1}
                  currentUser={currentUser}
                  onClose={onCloseParagraph}
                  onCountChange={onParagraphCountChange}
                />
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
});

function Reader({
  novel,
  chapter,
  currentUser,
  onBackToNovel,
  onNavigateChapter,
  onUpdateScroll,
  onChapterLikeChange,
  onSelectUser,
  theme,
  bookMode = false,
  onBookModeChange,
  initialProgressPercent = 0,
}: ReaderProps) {
  // Customizable reader settings state
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    try {
      const saved = localStorage.getItem("reptoc-reader-settings");
      if (saved) {
        return normalizeReaderSettings(JSON.parse(saved));
      }
    } catch (e) {
      // Ignored
    }
    return DEFAULT_READER_SETTINGS;
  });

  // Manga chapters are read page by page, so the page list is loaded separately
  // from the prose body and rendered by the dedicated viewer.
  const isManga = isMangaWork(novel);
  const readingDirection = normalizeReadingDirection((novel as any).readingDirection);
  const [mangaPages, setMangaPages] = useState<MangaPage[]>(() => (Array.isArray(chapter.pages) ? chapter.pages : []));
  const [mangaPagesLoading, setMangaPagesLoading] = useState(false);
  const [mangaPagesError, setMangaPagesError] = useState("");
  const [mangaReloadKey, setMangaReloadKey] = useState(0);
  const [mangaPageIndex, setMangaPageIndex] = useState(0);

  const [isPrefBarOpen, setIsPrefBarOpen] = useState(false);
  const [isIndexOpen, setIsIndexOpen] = useState(false);
  const [chapterSearch, setChapterSearch] = useState("");
  const [customNotes, setCustomNotes] = useState("");
  const [isSavedNote, setIsSavedNote] = useState(false);
  const [chapterComments, setChapterComments] = useState<any[]>([]);
  const [chapterCommentDraft, setChapterCommentDraft] = useState("");
  const [chapterReplyTo, setChapterReplyTo] = useState<any | null>(null);
  const [commentLikeBusyIds, setCommentLikeBusyIds] = useState<Set<string>>(new Set());
  const [commentError, setCommentError] = useState("");
  const [paragraphCommentCounts, setParagraphCommentCounts] = useState<Record<string, number>>({});
  const [activeParagraph, setActiveParagraph] = useState<{ id: string; ordinal: number } | null>(null);
  const [chapterLiked, setChapterLiked] = useState(false);
  const [chapterLikesCount, setChapterLikesCount] = useState(Number(chapter.likesCount || 0));
  const [chapterLikeBusy, setChapterLikeBusy] = useState(false);
  const [chapterLikeError, setChapterLikeError] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [resumeNotice, setResumeNotice] = useState<number | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isScreenShielded, setIsScreenShielded] = useState(false);
  const [offlineState, setOfflineState] = useState<"checking" | "ready" | "saving" | "saved" | "error">("checking");
  const [offlineMessage, setOfflineMessage] = useState("");
  const [visibleProgress, setVisibleProgress] = useState(() => normalizeReadingProgressPercent(initialProgressPercent));
  const selectParagraph = React.useCallback((paragraph: ParagraphIdentity) => setActiveParagraph(paragraph), []);
  const closeParagraph = React.useCallback(() => setActiveParagraph(null), []);
  const updateParagraphCommentCount = React.useCallback((paragraphId: string, nextCount: number) => {
    setParagraphCommentCounts((current) => (
      Number(current[paragraphId] || 0) === nextCount ? current : { ...current, [paragraphId]: nextCount }
    ));
  }, []);

  const shareChapter = async () => {
    const url = `${window.location.origin}/novels/${encodeURIComponent(novel.id)}/chapters/${encodeURIComponent(chapter.id)}`;
    try {
      await copyLink(url);
      setShareStatus("لینک کپی شد");
      window.setTimeout(() => setShareStatus(""), 2500);
    } catch (error: any) {
      if (error?.name !== "AbortError") setShareStatus("کپی لینک انجام نشد");
    }
  };

  useEffect(() => {
    let active = true;
    setOfflineState("checking");
    isChapterOffline(novel.id, chapter.id).then((saved) => { if (active) setOfflineState(saved ? "saved" : "ready"); }).catch(() => { if (active) setOfflineState("ready"); });
    return () => { active = false; };
  }, [novel.id, chapter.id]);

  useEffect(() => {
    if (!offlineMessage) return;
    const timer = window.setTimeout(() => setOfflineMessage(""), 3500);
    return () => window.clearTimeout(timer);
  }, [offlineMessage]);

  const toggleOfflineChapter = async () => {
    setOfflineState("saving"); setOfflineMessage("");
    try {
      if (await isChapterOffline(novel.id, chapter.id)) {
        await removeChapterOffline(novel.id, chapter.id);
        setOfflineState("ready"); setOfflineMessage("دانلود آفلاین حذف شد.");
      } else {
        await saveChapterOffline(novel, chapter, mangaPages);
        setOfflineState("saved"); setOfflineMessage("فصل برای مطالعه بدون اینترنت ذخیره شد.");
      }
    } catch (error: any) {
      setOfflineState("error"); setOfflineMessage(error?.message || "ذخیره آفلاین انجام نشد.");
    }
  };

  const updateSetting = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => {
    setSettings((prev) => {
      const updated = { ...prev, [key]: value };
      localStorage.setItem("reptoc-reader-settings", JSON.stringify(updated));
      return updated;
    });
  };

  const enterFocusMode = () => {
    setIsIndexOpen(false);
    setIsPrefBarOpen(false);
    setIsFocusMode(true);
  };

  useEffect(() => {
    document.documentElement.classList.toggle("reader-focus-active", isFocusMode);
    return () => document.documentElement.classList.remove("reader-focus-active");
  }, [isFocusMode]);

  useEffect(() => {
    const handleFocusShortcut = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape" && isFocusMode) {
        setIsFocusMode(false);
        return;
      }
      if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (isFocusMode) setIsFocusMode(false);
        else enterFocusMode();
      }
    };
    window.addEventListener("keydown", handleFocusShortcut);
    return () => window.removeEventListener("keydown", handleFocusShortcut);
  }, [isFocusMode]);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const readerPageRef = useRef<HTMLDivElement>(null);
  const preventCopy = novel.preventCopy === true || chapter.preventCopy === true;
  const preventScreenshot = novel.preventScreenshot === true || chapter.preventScreenshot === true;
  const canCopyChapterText = !preventCopy;
  const watermarkIdentity = String(currentUser?.username || currentUser?.displayName || "خواننده مهمان").slice(0, 48);

  useEffect(() => {
    if (canCopyChapterText) return;

    const isEditableTarget = (target: EventTarget | null) => {
      const element = target instanceof HTMLElement ? target : null;
      return Boolean(element?.closest("input, textarea, [contenteditable='true']"));
    };
    const selectionTouchesReader = () => {
      const readerPage = readerPageRef.current;
      const selection = window.getSelection();
      if (!readerPage || !selection || selection.rangeCount === 0) return false;
      return Array.from({ length: selection.rangeCount }).some((_, index) => {
        const range = selection.getRangeAt(index);
        return readerPage.contains(range.commonAncestorContainer);
      });
    };
    const blockClipboard = (event: ClipboardEvent) => {
      if (!isEditableTarget(event.target) && selectionTouchesReader()) event.preventDefault();
    };
    const blockShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !["c", "x"].includes(event.key.toLowerCase())) return;
      if (!isEditableTarget(event.target) && (readerPageRef.current?.contains(event.target as Node) || selectionTouchesReader())) event.preventDefault();
    };
    const blockSelection = (event: Event) => {
      if (!isEditableTarget(event.target) && readerPageRef.current?.contains(event.target as Node)) event.preventDefault();
    };

    document.addEventListener("copy", blockClipboard, true);
    document.addEventListener("cut", blockClipboard, true);
    document.addEventListener("keydown", blockShortcut, true);
    document.addEventListener("dragstart", blockSelection, true);
    document.addEventListener("selectstart", blockSelection, true);
    document.addEventListener("contextmenu", blockSelection, true);
    return () => {
      document.removeEventListener("copy", blockClipboard, true);
      document.removeEventListener("cut", blockClipboard, true);
      document.removeEventListener("keydown", blockShortcut, true);
      document.removeEventListener("dragstart", blockSelection, true);
      document.removeEventListener("selectstart", blockSelection, true);
      document.removeEventListener("contextmenu", blockSelection, true);
    };
  }, [canCopyChapterText, chapter.id]);

  useEffect(() => {
    if (!preventScreenshot) {
      setIsScreenShielded(false);
      return;
    }
    let timer = 0;
    const shield = () => setIsScreenShielded(true);
    const reveal = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIsScreenShielded(false), 180);
    };
    const handleVisibility = () => document.visibilityState === "hidden" ? shield() : reveal();
    const handleKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "p") {
        event.preventDefault();
        shield();
        timer = window.setTimeout(() => setIsScreenShielded(false), 1200);
      } else if (event.key === "PrintScreen") {
        shield();
        timer = window.setTimeout(() => setIsScreenShielded(false), 1200);
      }
    };
    window.addEventListener("blur", shield);
    window.addEventListener("focus", reveal);
    window.addEventListener("beforeprint", shield);
    window.addEventListener("afterprint", reveal);
    window.addEventListener("keydown", handleKey, true);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("blur", shield);
      window.removeEventListener("focus", reveal);
      window.removeEventListener("beforeprint", shield);
      window.removeEventListener("afterprint", reveal);
      window.removeEventListener("keydown", handleKey, true);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [preventScreenshot, chapter.id]);

  // Close menus when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        isPrefBarOpen &&
        !target.closest("#pref-bar") &&
        !target.closest("#pref-toggle-btn")
      ) {
        setIsPrefBarOpen(false);
      }
      if (
        isIndexOpen &&
        !target.closest("#index-drawer") &&
        !target.closest("#index-toggle-btn")
      ) {
        setIsIndexOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isPrefBarOpen, isIndexOpen]);

  const readTimeRef = useRef(0);
  const completedRef = useRef(false);
  const maxScrollRef = useRef(0);
  const progressCallbackRef = useRef(onUpdateScroll);
  const restoredChapterRef = useRef<string | null>(null);
  const lastFlushedProgressRef = useRef("");

  useEffect(() => {
    progressCallbackRef.current = onUpdateScroll;
  }, [onUpdateScroll]);

  useEffect(() => {
    maxScrollRef.current = Math.max(maxScrollRef.current, normalizeReadingProgressPercent(initialProgressPercent));
  }, [chapter.id, initialProgressPercent]);

  // Flush even a small final movement when the reader closes, the chapter
  // changes, or the browser backgrounds the page. keepalive lets the same-origin
  // request finish during a tab close on supported browsers.
  useEffect(() => {
    const flushProgress = (keepalive: boolean) => {
      if (chapter.isAuxiliary || maxScrollRef.current <= 0) return;
      const percent = normalizeReadingProgressPercent(maxScrollRef.current);
      const flushKey = `${chapter.id}:${percent}`;
      if (lastFlushedProgressRef.current === flushKey) return;
      lastFlushedProgressRef.current = flushKey;
      progressCallbackRef.current(chapter.id, percent, { forceSync: true, keepalive });
    };
    const handlePageHide = () => flushProgress(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushProgress(true);
    };
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushProgress(false);
    };
  }, [chapter.id, chapter.isAuxiliary]);

  useEffect(() => {
    // Count only foreground time spent on the actual chapter reader. Hidden
    // tabs, backgrounded mobile browsers, and time elsewhere in the app do not
    // contribute to the reader's profile hours.
    readTimeRef.current = 0;
    completedRef.current = false;
    maxScrollRef.current = Math.max(maxScrollRef.current, normalizeReadingProgressPercent(initialProgressPercent));
    let pendingReadSeconds = 0;
    let lastTickAt = performance.now();
    let disposed = false;

    const isActivelyReading = () => (
      document.visibilityState === "visible"
      && (typeof document.hasFocus !== "function" || document.hasFocus())
    );

    const accrueForegroundTime = () => {
      const now = performance.now();
      const elapsedSeconds = Math.max(0, Math.min(5, (now - lastTickAt) / 1000));
      lastTickAt = now;
      if (!isActivelyReading()) return;
      pendingReadSeconds += elapsedSeconds;
      readTimeRef.current += elapsedSeconds;
    };

    const flushReadingTime = async (force = false) => {
      accrueForegroundTime();
      const seconds = Math.floor(pendingReadSeconds);
      if (!currentUser?.id || seconds < (force ? 1 : 15)) return;
      pendingReadSeconds -= seconds;
      const saved = await api.logReadingSession({
        novelId: novel.id,
        chapterId: chapter.id,
        chapterNumber: chapter.chapterNumber,
        readSeconds: seconds,
        scrollPercentage: maxScrollRef.current,
        source: "chapter-reader"
      });
      if (!saved && !disposed) pendingReadSeconds += seconds;
    };
    
    // Log View in actual analytics logs for author dashboard
    const token = api.getToken();
    api.logAnalyticsEvent(token, novel.id, "view", { source: document.referrer || "reader" });

    if (currentUser?.id) {
      api.trackEvent(currentUser.id, novel.id, "chapter_start", 0, chapter.chapterNumber);
    }

    const timer = window.setInterval(() => {
      accrueForegroundTime();
      if (pendingReadSeconds >= 15) void flushReadingTime();
    }, 1000);
    const handleActivityStateChange = () => {
      accrueForegroundTime();
      if (!isActivelyReading()) void flushReadingTime(true);
    };
    const handlePageHide = () => {
      accrueForegroundTime();
      void flushReadingTime(true);
    };
    document.addEventListener("visibilitychange", handleActivityStateChange);
    window.addEventListener("focus", handleActivityStateChange);
    window.addEventListener("blur", handleActivityStateChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      accrueForegroundTime();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleActivityStateChange);
      window.removeEventListener("focus", handleActivityStateChange);
      window.removeEventListener("blur", handleActivityStateChange);
      window.removeEventListener("pagehide", handlePageHide);
      void flushReadingTime(true);
      disposed = true;
      const sessionReadTime = Math.floor(readTimeRef.current);
      if (currentUser?.id) {
         api.trackEvent(currentUser.id, novel.id, "read_time", sessionReadTime, chapter.chapterNumber);
      }
    };
  }, [chapter.id, currentUser?.id, novel.id, chapter.chapterNumber]);

  // Load notes from local storage specific to this chapter
  useEffect(() => {
    const token = api.getToken();
    if (token) {
      api.getNote(token, chapter.id).then((saved) => {
        setCustomNotes(saved || "");
      });
    } else {
      setCustomNotes("");
    }
    setIsSavedNote(false);
    
    // A chapter without persisted progress starts at the beginning. Resuming a
    // prose chapter is handled separately after its typography has laid out.
    if (normalizeReadingProgressPercent(initialProgressPercent) <= 0) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [chapter.id]);

  useEffect(() => {
    if (isManga || restoredChapterRef.current === chapter.id) return;
    const percent = normalizeReadingProgressPercent(initialProgressPercent);
    if (percent <= 0) return;
    restoredChapterRef.current = chapter.id;
    maxScrollRef.current = Math.max(maxScrollRef.current, percent);
    setVisibleProgress(percent);

    let cancelled = false;
    let userMoved = false;
    let firstFrame = 0;
    let secondFrame = 0;
    const timers: number[] = [];
    const markUserMovement = () => { userMoved = true; };
    const restore = () => {
      const content = containerRef.current;
      if (cancelled || userMoved || !content) return;
      const contentTop = content.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: scrollTopForReadingProgress(percent, contentTop, content.scrollHeight, window.innerHeight),
        behavior: "auto",
      });
    };

    window.addEventListener("wheel", markUserMovement, { passive: true });
    window.addEventListener("touchstart", markUserMovement, { passive: true });
    window.addEventListener("pointerdown", markUserMovement, { passive: true });
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(restore);
    });
    timers.push(window.setTimeout(restore, 180), window.setTimeout(restore, 650));
    void document.fonts?.ready.then(restore);
    setResumeNotice(Math.round(percent));
    const noticeTimer = window.setTimeout(() => setResumeNotice(null), 3200);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(noticeTimer);
      window.removeEventListener("wheel", markUserMovement);
      window.removeEventListener("touchstart", markUserMovement);
      window.removeEventListener("pointerdown", markUserMovement);
    };
  }, [chapter.id, initialProgressPercent, isManga]);

  /**
   * Load the pages of a manga chapter.
   *
   * The novel payload already carries them, so the fetch only runs when it did
   * not (a catalogue-sourced novel, or a chapter opened straight from a link).
   */
  useEffect(() => {
    if (!isManga) return;
    const embedded = Array.isArray(chapter.pages) ? chapter.pages : [];
    setMangaPageIndex(0);
    setMangaPagesError("");
    if (embedded.length > 0) {
      setMangaPages(embedded);
      setMangaPagesLoading(false);
      return;
    }
    let active = true;
    setMangaPagesLoading(true);
    api.getMangaPages(novel.id, chapter.id)
      .then((result) => {
        if (!active) return;
        setMangaPages(result.pages);
        setMangaPagesError("");
      })
      .catch((error: any) => {
        if (active) {
          setMangaPages([]);
          setMangaPagesError(error?.message || "بارگذاری صفحه‌های این فصل انجام نشد.");
        }
      })
      .finally(() => {
        if (active) setMangaPagesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [chapter.id, chapter.pages, isManga, mangaReloadKey, novel.id]);

  /**
   * Manga reading progress.
   *
   * A page turn is the manga equivalent of a scroll position, so it feeds the
   * same progress pipeline prose uses; the reader therefore resumes on the page
   * it left off and finished chapters count towards the profile the same way.
   */
  const handleMangaProgress = React.useCallback((pageIndex: number, percent: number) => {
    setMangaPageIndex(pageIndex);
    setVisibleProgress(normalizeReadingProgressPercent(percent));
    if (chapter.isAuxiliary) return;
    maxScrollRef.current = Math.max(maxScrollRef.current, percent);
    onUpdateScroll(chapter.id, percent);
    if (percent > 90 && !completedRef.current && currentUser?.id) {
      completedRef.current = true;
      api.trackEvent(currentUser.id, novel.id, "chapter_complete", 0, chapter.chapterNumber);
    }
  }, [chapter.chapterNumber, chapter.id, chapter.isAuxiliary, currentUser?.id, novel.id, onUpdateScroll]);

  useEffect(() => {
    api.getChapterComments(novel.id, chapter.id).then(setChapterComments);
    api.getParagraphCommentCounts(novel.id, chapter.id).then(setParagraphCommentCounts);
    setChapterCommentDraft("");
    setChapterReplyTo(null);
    setCommentLikeBusyIds(new Set());
    setCommentError("");
    setActiveParagraph(null);
  }, [novel.id, chapter.id]);

  useEffect(() => {
    let active = true;
    setChapterLikeError("");
    setChapterLikesCount(Number(chapter.likesCount || 0));
    api.getChapterLike(api.getToken(), novel.id, chapter.id).then((state) => {
      if (!active || !state) return;
      setChapterLiked(state.liked);
      setChapterLikesCount(state.likesCount);
      if (typeof state.novelLikesCount === "number") {
        onChapterLikeChange?.(novel.id, chapter.id, state.liked, state.likesCount, state.novelLikesCount);
      }
    });
    return () => { active = false; };
  }, [novel.id, chapter.id, chapter.likesCount, currentUser?.id, onChapterLikeChange]);

  // Handle scroll and report back progress. A manga chapter's progress comes
  // from the page it is on, not from the window scroll, so this is skipped.
  useEffect(() => {
    if (isManga) return;
    let animationFrame: number | null = null;
    let lastReportedProgress: number | undefined;
    const publishScrollProgress = () => {
      animationFrame = null;
      const content = containerRef.current;
      if (!content) return;
      const contentTop = content.getBoundingClientRect().top + window.scrollY;
      const roundedProgress = readingProgressFromContent(window.scrollY, contentTop, content.scrollHeight, window.innerHeight);
      setVisibleProgress(roundedProgress);
      maxScrollRef.current = Math.max(maxScrollRef.current, roundedProgress);
      if (!chapter.isAuxiliary && shouldPublishReadingProgress(lastReportedProgress, roundedProgress)) {
        lastReportedProgress = roundedProgress;
        onUpdateScroll(chapter.id, maxScrollRef.current);
      }
      
      if (maxScrollRef.current > 90 && !completedRef.current && currentUser?.id) {
         completedRef.current = true;
         api.trackEvent(currentUser.id, novel.id, "chapter_complete", 0, chapter.chapterNumber);
      }
    };

    const handleScroll = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(publishScrollProgress);
    };

    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, [chapter.id, chapter.isAuxiliary, isManga, onUpdateScroll, currentUser?.id, novel.id, chapter.chapterNumber]);

  const handleSaveNotes = () => {
    const token = api.getToken();
    if (token) {
      api.saveNote(token, chapter.id, customNotes);
    }
    setIsSavedNote(true);
    setTimeout(() => setIsSavedNote(false), 2000);
  };

  const handlePostChapterComment = async () => {
    const token = api.getToken();
    if (!token) {
      setCommentError("برای پیوستن به گفتگوی فصل وارد شوید.");
      return;
    }
    if (!chapterCommentDraft.trim()) return;
    const result = await api.addChapterComment(token, novel.id, chapter.id, chapterCommentDraft, chapterReplyTo?.id);
    if (result?.success) {
      setChapterCommentDraft("");
      setChapterReplyTo(null);
      setCommentError(result.moderationStatus && result.moderationStatus !== "visible" ? (result.message || "دیدگاه برای بررسی ارسال شد.") : "");
      if (result.comment) {
        setChapterComments((prev) => [...prev, result.comment]);
      }
      api.getChapterComments(novel.id, chapter.id).then(setChapterComments);
      return;
    }
    setCommentError(result?.error || "دیدگاه شما منتشر نشد. لطفاً دوباره تلاش کنید.");
  };

  const handleChapterCommentLike = async (comment: any) => {
    const token = api.getToken();
    if (!token) {
      setCommentError("برای پسندیدن دیدگاه وارد شوید.");
      return;
    }
    if (commentLikeBusyIds.has(comment.id)) return;
    const liked = !comment.likedByCurrentUser;
    setCommentLikeBusyIds((current) => new Set(current).add(comment.id));
    setCommentError("");
    const result = await api.setChapterCommentLike(token, novel.id, chapter.id, comment.id, liked);
    if (result?.success) {
      setChapterComments((current) => current.map((item) => item.id === comment.id ? {
        ...item,
        likedByCurrentUser: result.liked,
        likesCount: Number(result.likesCount || 0),
      } : item));
    } else {
      setCommentError(result?.error || "پسند دیدگاه به‌روزرسانی نشد.");
    }
    setCommentLikeBusyIds((current) => {
      const next = new Set(current);
      next.delete(comment.id);
      return next;
    });
  };

  const handleChapterLike = async () => {
    const token = api.getToken();
    if (!token) {
      setChapterLikeError("برای پسندیدن این فصل وارد شوید.");
      return;
    }
    if (chapterLikeBusy) return;
    setChapterLikeBusy(true);
    setChapterLikeError("");
    const result = await api.toggleChapterLike(token, novel.id, chapter.id, !chapterLiked);
    if (result.success && typeof result.liked === "boolean") {
      setChapterLiked(result.liked);
      const nextChapterLikesCount = Number(result.likesCount || 0);
      const nextNovelLikesCount = Number(result.novelLikesCount ?? novel.likesCount ?? 0);
      setChapterLikesCount(nextChapterLikesCount);
      onChapterLikeChange?.(novel.id, chapter.id, result.liked, nextChapterLikesCount, nextNovelLikesCount);
    } else {
      setChapterLikeError(result.error || "پسندیدن این فصل ممکن نشد.");
      const serverState = await api.getChapterLike(token, novel.id, chapter.id);
      if (serverState) {
        setChapterLiked(serverState.liked);
        setChapterLikesCount(serverState.likesCount);
      }
    }
    setChapterLikeBusy(false);
  };

  const publishedChapters = [...(novel.chapters || [])]
    .filter((item) => String((item as any).status || "Published").toLowerCase() === "published")
    .sort((a,b) => Number(a.isAuxiliary) - Number(b.isAuxiliary) || Number(a.chapterNumber || 0) - Number(b.chapterNumber || 0));
  const normalChapters = publishedChapters.filter((item) => !item.isAuxiliary);
  const auxiliaryChapters = publishedChapters.filter((item) => item.isAuxiliary);
  const sortedChapters = chapter.isAuxiliary ? auxiliaryChapters : normalChapters;
  const currentChapterIndex = sortedChapters.findIndex((item) => item.id === chapter.id);
  const prevChapter = currentChapterIndex > 0 ? sortedChapters[currentChapterIndex - 1] : null;
  const nextChapter = currentChapterIndex >= 0 ? sortedChapters[currentChapterIndex + 1] : null;
  const visibleIndexChapters = publishedChapters.filter((item) =>
    `${item.chapterNumber} ${item.title}`.toLowerCase().includes(chapterSearch.trim().toLowerCase())
  );

  // Theme presets definitions
  const THEME_PRESETS: Record<ReaderThemePreset, {
    bg: string;
    text: string;
    card: string;
    border: string;
    sidebar: string;
    title: string;
    header: string;
  }> = {
    system: {
      bg: "bg-[var(--app-card)]",
      text: "text-[var(--app-text)]",
      card: "bg-[var(--app-elevated)] border-[var(--app-border)]",
      border: "border-[var(--app-border)]",
      sidebar: "bg-[var(--app-elevated)] border-[var(--app-border)] text-[var(--app-text)]",
      title: "text-[var(--accent-text)]",
      header: "bg-[var(--app-header)] border-[var(--app-border)] text-[var(--app-text)]"
    },
    sepia: {
      bg: "bg-[#F4ECD8]",
      text: "text-[#433422]",
      card: "bg-[#EADFCA] border-[#DFD4BF]",
      border: "border-[#DFD4BF]",
      sidebar: "bg-[#ECE1CC] border-[#DFD4BF] text-[#433422]",
      title: "text-[#8C5E24]",
      header: "bg-[#ECE1CC]/95 border-[#DFD4BF] text-[#433422]"
    },
    white: {
      bg: "bg-white",
      text: "text-stone-900",
      card: "bg-stone-50 border-stone-200",
      border: "border-stone-200",
      sidebar: "bg-[#F9FAFB] border-stone-200 text-stone-900",
      title: "text-purple-600",
      header: "bg-stone-50/95 border-stone-200 text-stone-900"
    },
    coal: {
      bg: "bg-[#1C1F2B]",
      text: "text-[#E2E8F0]",
      card: "bg-[#252A3C] border-[#3F4764]",
      border: "border-[#3A435E]",
      sidebar: "bg-[#1E2333] border-[#3A435E] text-[#E2E8F0]",
      title: "text-violet-400",
      header: "bg-[#1E2333]/95 border-[#3D455C] text-[#E2E8F0]"
    },
    black: {
      bg: "bg-[#050508]",
      text: "text-stone-300",
      card: "bg-[#0E0F14] border-[#1D1E26]",
      border: "border-[#1A1A22]",
      sidebar: "bg-[#09090C] border-[#1D1E26] text-stone-300",
      title: "text-violet-500",
      header: "bg-[#09090C]/95 border-[#1D1E26] text-stone-300"
    },
    forest: {
      bg: "bg-[#0B1511]",
      text: "text-[#E1ECE6]",
      card: "bg-[#12241D] border-[#1E3C30]",
      border: "border-[#1D3B2F]",
      sidebar: "bg-[#0F1F19] border-[#1D3B2F] text-[#E1ECE6]",
      title: "text-emerald-400",
      header: "bg-[#0F1F19]/95 border-[#1D3B2F] text-[#E1ECE6]"
    },
    royal: {
      bg: "bg-[#07091B]",
      text: "text-[#E0E6ED]",
      card: "bg-[#111430] border-[#22295E]",
      border: "border-[#212759]",
      sidebar: "bg-[#0D1026] border-[#212759] text-[#E0E6ED]",
      title: "text-purple-400",
      header: "bg-[#0D1026]/95 border-[#212759] text-[#E0E6ED]"
    }
  };

  const fontStyle = {
    estedad: "[font-family:'Estedad','Vazirmatn',sans-serif] tracking-normal",
    vazirmatn: "[font-family:'Vazirmatn','Estedad',sans-serif] tracking-normal",
    sans: "font-sans tracking-normal",
    serif: "font-serif tracking-wide",
    mono: "font-mono tracking-tight",
    space: "font-space tracking-wide",
    georgia: "[font-family:Georgia,'Estedad','Vazirmatn',serif] tracking-normal",
    "system-ui": "[font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI','Estedad',sans-serif] tracking-normal"
  };

  const activeTheme = CONTRAST_THEMES[theme];
  const activePreset = THEME_PRESETS[settings.themePreset];
  const isSystemTheme = settings.themePreset === "system";

  const readerBg = isSystemTheme ? "bg-[var(--app-card)]" : activePreset.bg;
  const readerText = isSystemTheme ? activeTheme.text : activePreset.text;
  const readerBorder = isSystemTheme ? activeTheme.border : activePreset.border;
  const readerCard = isSystemTheme ? "bg-[var(--app-elevated)] border-[var(--app-border)]" : activePreset.card;
  const readerHeader = isSystemTheme ? "bg-[var(--app-header)] border-[var(--app-border)] text-[var(--app-text)]" : activePreset.header;
  const readerSidebar = isSystemTheme 
    ? "bg-[var(--app-elevated)] border-[var(--app-border)] text-[var(--app-text)] shadow-xl"
    : `${activePreset.sidebar} shadow-2xl`;
  const readerTitleColor = isSystemTheme ? "text-[var(--accent-text)]" : activePreset.title;
  const coverBackground = String((novel as any).coverUrl || (novel as any).cover_url || "").trim();

  return (
    <div
      ref={readerPageRef}
      translate="yes"
      data-focus-mode={isFocusMode ? "true" : "false"}
      data-book-mode={bookMode ? "true" : "false"}
      className={`reader-focus-surface relative min-h-screen pb-24 transition-colors duration-300 ${bookMode ? "reader-book-mode" : ""} ${bookMode && isFocusMode ? "reader-book-fullscreen" : ""} ${preventCopy ? "reader-copy-protected" : ""} ${preventScreenshot ? "reader-content-protected" : ""} ${readerBg} ${readerText}`}
      style={{
        "--reader-book-width": `${settings.bookWidth}px`,
        "--reader-book-height": `${settings.bookHeight}px`,
      } as React.CSSProperties}
    >
      {preventScreenshot && (
        <div className="reader-screen-watermark pointer-events-none fixed inset-0 z-30 grid grid-cols-2 content-around overflow-hidden" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => <span key={index}>رپتوک · {watermarkIdentity}</span>)}
        </div>
      )}
      {preventScreenshot && isScreenShielded && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#08060d] p-6 text-center text-white" role="status">
          <div><ShieldAlert className="mx-auto h-10 w-10 text-amber-400" /><p className="mt-4 text-sm font-black">محتوای محافظت‌شده</p><p className="mt-2 text-xs text-slate-400">برای ادامهٔ مطالعه به صفحه برگردید.</p></div>
        </div>
      )}
      {resumeNotice !== null && !isManga && (
        <div role="status" className="fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-full border border-[var(--accent-border)] bg-[var(--app-elevated)]/95 px-4 py-2 text-xs font-bold text-[var(--app-text)] shadow-lg">
          ادامه از جای قبلی · {resumeNotice.toLocaleString("fa-IR")}٪
        </div>
      )}
      {offlineMessage && (
        <div role="status" className="fixed left-1/2 top-28 z-50 -translate-x-1/2 rounded-full border border-violet-500/30 bg-[var(--app-elevated)]/95 px-4 py-2 text-xs font-bold text-[var(--app-text)] shadow-lg">
          {offlineMessage}
        </div>
      )}
      {settings.blurredCoverBackground && coverBackground && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <div className="absolute -inset-10 bg-cover bg-center opacity-[0.16] blur-3xl scale-110" style={{backgroundImage:`url(${coverBackground})`}} />
          <div className={`absolute inset-0 ${theme === "dark" ? "bg-[var(--app-bg)]/80" : "bg-white/95"}`} />
        </div>
      )}
      {/* Floating Scroll Progress Bar */}
      <div className="fixed top-0 left-0 w-full h-[3px] bg-slate-900/10 dark:bg-violet-950/20 z-50">
        <div 
          className="h-full bg-[var(--accent)] transition-[width] duration-150"
          style={{ width: `${visibleProgress}%` }}
        />
      </div>

      {isFocusMode && (
        <div className="fixed inset-x-3 top-4 z-50 flex items-center justify-between gap-3 sm:inset-x-6" dir="rtl">
          <button type="button" onClick={() => setIsFocusMode(false)} className={`flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-xs font-black shadow-lg ${readerHeader}`} aria-label="خروج از حالت تمرکز" title="خروج از حالت تمرکز (F یا Escape)">
            <Minimize2 className="h-4 w-4" /> خروج از تمرکز
          </button>
          <span className={`rounded-full border px-3 py-2 text-xs font-black tabular-nums shadow-lg ${readerHeader}`} aria-label={`پیشرفت مطالعه ${Math.round(visibleProgress)} درصد`}>
            {Math.round(visibleProgress).toLocaleString("fa-IR")}٪
          </span>
        </div>
      )}

      {/* Reader Auxiliary Header */}
      {!isFocusMode && <header className={`sticky top-0 z-40 backdrop-blur-md border-b ${readerBorder} ${readerHeader} px-3 py-2.5 sm:px-4 sm:py-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between transition-all`}>
        <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto">
          <button
            onClick={onBackToNovel}
            className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border ${readerBorder} hover:text-violet-500 cursor-pointer transition-colors sm:min-h-0 sm:min-w-0 sm:p-2`}
            title="بازگشت به جزئیات"
            aria-label="بازگشت به نمای کلی رمان"
          >
            <ChevronLeft className="h-5 w-5 sm:h-4 sm:w-4" />
          </button>
          
          <div className="min-w-0 flex-1 sm:max-w-xs md:max-w-sm">
            <h1 className="truncate text-xs font-semibold text-slate-500 sm:text-xs">{novel.title}</h1>
            <p className="truncate text-sm font-bold sm:text-xs">
              {chapter.isAuxiliary ? `فرعی ${chapter.chapterNumber}` : `فصل ${chapter.chapterNumber}`}: {chapter.title}
            </p>
          </div>
        </div>

        {/* Quick controls bar */}
        <div className="grid w-full grid-cols-5 gap-2 sm:flex sm:w-auto sm:items-center sm:gap-1.5">
          {shareStatus && <span role="status" className={`hidden sm:inline text-[10px] font-bold ${shareStatus === "لینک کپی شد" ? "text-emerald-500" : "text-rose-500"}`}>{shareStatus}</span>}
          <button onClick={shareChapter} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold ${readerBorder} text-slate-500 hover:text-violet-400 transition-all cursor-pointer sm:min-h-0 sm:p-2.5`} title={shareStatus || "کپی لینک فصل"} aria-label={shareStatus || "کپی لینک فصل"}>
            <Share2 className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
            <span className="sm:hidden">{shareStatus === "لینک کپی شد" ? "کپی شد" : "همرسانی"}</span>
          </button>
          <button type="button" onClick={toggleOfflineChapter} disabled={offlineState === "checking" || offlineState === "saving"} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-all disabled:opacity-50 sm:min-h-0 sm:p-2.5 ${offlineState === "saved" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" : `${readerBorder} text-slate-500 hover:text-violet-400`}`} title={offlineState === "saved" ? "حذف دانلود آفلاین" : "دانلود برای مطالعه آفلاین"} aria-label={offlineState === "saved" ? "حذف دانلود آفلاین فصل" : "دانلود فصل برای مطالعه آفلاین"}>
            {offlineState === "saved" ? <Trash2 className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" /> : <Download className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />}
            <span className="sm:hidden">{offlineState === "saving" ? "ذخیره…" : offlineState === "saved" ? "حذف" : "آفلاین"}</span>
          </button>
          {/* Chapter selector index button */}
          <button
            id="index-toggle-btn"
            onClick={() => {
              setIsIndexOpen(!isIndexOpen);
              setIsPrefBarOpen(false);
            }}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold ${isIndexOpen ? "bg-violet-500 border-violet-600 text-white" : `${readerBorder} text-slate-500 hover:text-violet-400`} transition-all cursor-pointer sm:min-h-0 sm:p-2.5`}
            title="فهرست فصل‌ها"
            aria-label="باز کردن فهرست فصل‌ها"
            aria-expanded={isIndexOpen}
          >
            <Menu className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
            <span className="sm:hidden">فصل‌ها</span>
          </button>

          {/* Typography configuration button */}
          <button
            id="pref-toggle-btn"
            onClick={() => {
              setIsPrefBarOpen(!isPrefBarOpen);
              setIsIndexOpen(false);
            }}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold ${isPrefBarOpen ? "bg-violet-500 border-violet-600 text-white" : `${readerBorder} text-slate-500 hover:text-violet-400`} transition-all cursor-pointer sm:min-h-0 sm:p-2.5`}
            title="تنظیمات خواندن"
            aria-label="باز کردن تنظیمات خواندن"
            aria-expanded={isPrefBarOpen}
          >
            <Settings2 className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
            <span className="sm:hidden">تنظیمات</span>
          </button>
          <button
            type="button"
            onClick={enterFocusMode}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold ${readerBorder} text-slate-500 hover:text-violet-400 transition-all cursor-pointer sm:min-h-0 sm:p-2.5`}
            title="حالت تمرکز (F)"
            aria-label="ورود به حالت مطالعه بدون حواس‌پرتی"
          >
            <Maximize2 className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
            <span className="sm:hidden">تمرکز</span>
          </button>
        </div>
      </header>}

      {/* Slide-out Chapters Index Drawer */}
      {isIndexOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-sm">
          <div id="index-drawer" className={`flex h-full w-full flex-col justify-between border-r ${readerBorder} ${readerSidebar} p-4 sm:w-96 sm:p-6`}>
            <div className="max-h-[calc(100vh-5rem)] space-y-5 overflow-y-auto scrollbar-none sm:space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-dashed border-slate-700/20">
                <h3 className="flex items-center gap-2 text-lg font-extrabold sm:text-sm">
                  <BookOpen className="h-5 w-5 text-violet-400 sm:h-4 sm:w-4" />
                  <span>همه فصل‌ها</span>
                </h3>
                <button 
                  onClick={() => setIsIndexOpen(false)}
                  className="min-h-11 rounded-xl border border-current/15 px-4 text-sm font-bold hover:text-rose-400 cursor-pointer sm:min-h-0 sm:border-0 sm:px-0 sm:text-xs sm:underline"
                >
                  بستن
                </button>
              </div>

              <div className={`rounded-xl border ${readerBorder} p-3 space-y-2`}>
                <div className="flex items-center justify-between text-xs font-mono sm:text-[10px]">
                  <span>{normalChapters.length} فصل • {auxiliaryChapters.length} فرعی</span>
                  <span>{chapter.isAuxiliary ? "محتوای فرعی" : `در حال مطالعه ${Math.max(1, currentChapterIndex + 1)} از ${normalChapters.length}`}</span>
                </div>
                <input value={chapterSearch} onChange={(e) => setChapterSearch(e.target.value)} placeholder="جستجوی شماره یا عنوان فصل..." className={`min-h-11 w-full rounded-lg border ${readerBorder} bg-transparent px-3 py-2 text-sm outline-none focus:border-violet-500 sm:min-h-0 sm:text-xs`} />
              </div>

              <div className="space-y-2">
                {visibleIndexChapters.map((c) => {
                  const isActive = c.id === chapter.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        onNavigateChapter(c.id);
                        setIsIndexOpen(false);
                      }}
                      className={`flex min-h-[60px] w-full gap-3 rounded-xl border p-4 text-left text-sm font-semibold transition-colors cursor-pointer sm:min-h-0 sm:p-3 sm:text-xs ${
                        isActive
                          ? "bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-500/10"
                          : `${readerBorder} hover:border-violet-500/30 opacity-80 hover:opacity-100`
                      }`}
                    >
                      <span className={`opacity-70 font-mono ${c.isAuxiliary ? "text-violet-300" : ""}`}>{c.isAuxiliary ? `A${c.chapterNumber}` : String(c.chapterNumber).padStart(2, "0")}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate">{c.title}</span><span className="mt-1 block text-xs opacity-65 sm:mt-0.5 sm:text-[9px]">{c.isAuxiliary ? "فرعی • " : ""}{Number(c.wordCount || 0).toLocaleString()} کلمه{isActive ? " • در حال مطالعه" : ""}</span></span>
                    </button>
                  );
                })}
                {visibleIndexChapters.length === 0 && <p className="py-8 text-center text-xs opacity-60">هیچ فصلی با جستجوی شما مطابقت ندارد.</p>}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-805/10 dark:border-violet-955/20 text-xs font-mono opacity-50 text-center">
              موتور خواندن رپتوک — نسخه 1.12
            </div>
          </div>
        </div>
      )}

      {/* Floating Preferences Toolbar */}
      {isPrefBarOpen && (
        <div id="pref-bar" className={`fixed inset-x-3 top-28 z-40 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-2xl border p-4 shadow-2xl sm:inset-x-auto sm:left-4 sm:top-16 sm:max-h-[85vh] sm:w-85 sm:max-w-sm sm:p-5 ${readerBorder} ${readerSidebar} space-y-4`}>
          <div className="flex items-center gap-2 border-b border-dashed border-slate-700/25 pb-2.5">
            <Sliders className="h-5 w-5 text-violet-400 sm:h-4 sm:w-4" />
            <h4 className="text-sm font-extrabold sm:text-xs sm:font-mono sm:uppercase sm:tracking-wider">تنظیمات خواندن</h4>
          </div>

          <button type="button" onClick={enterFocusMode} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-black text-[var(--accent-contrast)] shadow-sm">
            <Maximize2 className="h-4 w-4" /> مطالعه بدون حواس‌پرتی <span className="opacity-70">(F)</span>
          </button>

          <button
            type="button"
            onClick={() => onBookModeChange?.(!bookMode)}
            className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs font-black transition-all ${bookMode ? "border-amber-500 bg-amber-500/15 text-amber-500" : `${readerBorder} hover:border-amber-500/50`}`}
            aria-pressed={bookMode}
          >
            <span className="flex items-center gap-2"><BookOpen className="h-4 w-4" /> حالت کتابی</span>
            <span>{bookMode ? "فعال" : "غیرفعال"}</span>
          </button>

          <div className={`space-y-3 rounded-xl border p-3 ${readerBorder}`}>
            <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase opacity-70">
              <span className="flex items-center gap-1.5"><Layout className="h-3.5 w-3.5 text-amber-500" /> اندازه کتاب</span>
              <span>{settings.bookWidth.toLocaleString("fa-IR")} × {settings.bookHeight.toLocaleString("fa-IR")}</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {[
                { label: "جمع‌وجور", width: 820, height: 560 },
                { label: "استاندارد", width: 1184, height: 680 },
                { label: "بزرگ", width: 1360, height: 840 },
              ].map((size) => (
                <button
                  key={size.label}
                  type="button"
                  onClick={() => setSettings((current) => {
                    const updated = { ...current, bookWidth: size.width, bookHeight: size.height };
                    localStorage.setItem("reptoc-reader-settings", JSON.stringify(updated));
                    return updated;
                  })}
                  className={`min-h-10 rounded-lg border px-1 py-2 text-[10px] font-black transition-all ${settings.bookWidth === size.width && settings.bookHeight === size.height ? "border-amber-500 bg-amber-500/15 text-amber-500" : "border-slate-700/20 opacity-75 hover:opacity-100"}`}
                >
                  {size.label}
                </button>
              ))}
            </div>
            <label className="block space-y-1 text-[10px] font-bold opacity-75">
              <span className="flex justify-between"><span>عرض کتاب</span><span>{settings.bookWidth.toLocaleString("fa-IR")}px</span></span>
              <input type="range" min={READER_BOOK_WIDTH_RANGE.min} max={READER_BOOK_WIDTH_RANGE.max} step={20} value={settings.bookWidth} onChange={(event) => updateSetting("bookWidth", Number(event.target.value))} className="w-full accent-amber-500" aria-label="عرض کتاب در صفحه خواننده" />
            </label>
            <label className="block space-y-1 text-[10px] font-bold opacity-75">
              <span className="flex justify-between"><span>ارتفاع کتاب</span><span>{settings.bookHeight.toLocaleString("fa-IR")}px</span></span>
              <input type="range" min={READER_BOOK_HEIGHT_RANGE.min} max={READER_BOOK_HEIGHT_RANGE.max} step={20} value={settings.bookHeight} onChange={(event) => updateSetting("bookHeight", Number(event.target.value))} className="w-full accent-amber-500" aria-label="ارتفاع کتاب در صفحه خواننده" />
            </label>
            <p className="text-[10px] leading-5 opacity-55">این ابعاد در حالت کتابی اعمال می‌شوند و روی موبایل خودکار متناسب خواهند شد.</p>
          </div>

          {/* Theme selection */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold opacity-60 uppercase font-mono flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-violet-400" />
              <span>تم‌های مطالعه</span>
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-1">
              {[
                { id: "system", label: "سیستم", style: "border-slate-400 bg-transparent text-current" },
                { id: "sepia", label: "سپیا", style: "border-[#DFD4BF] bg-[#F4ECD8] text-[#433422]" },
                { id: "white", label: "روشن", style: "border-stone-200 bg-white text-stone-900" },
                { id: "coal", label: "ذغالی", style: "border-[#3A435E] bg-[#1C1F2B] text-slate-200" },
                { id: "black", label: "مشکی", style: "border-[#1D1E26] bg-[#050508] text-[#D1D5DB]" },
                { id: "forest", label: "جنگلی", style: "border-[#1D3B2F] bg-[#0B1511] text-[#E1ECE6]" },
                { id: "royal", label: "سلطنتی", style: "border-[#212759] bg-[#07091B] text-[#E0E6ED]" },
              ].map((themeOpt) => (
                <button
                  key={themeOpt.id}
                  onClick={() => updateSetting("themePreset", themeOpt.id as any)}
                  className={`min-h-10 rounded-lg border px-2 py-2 text-xs font-bold transition-all cursor-pointer truncate sm:min-h-0 sm:py-1 sm:text-[10px] ${themeOpt.style} ${
                    settings.themePreset === themeOpt.id ? "ring-2 ring-violet-500 scale-102" : "opacity-85 hover:opacity-100"
                  }`}
                  title={themeOpt.label}
                >
                  {themeOpt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Font selection */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold opacity-60 uppercase font-mono flex items-center gap-1.5">
              <Type className="w-3.5 h-3.5 text-violet-400" />
              <span>انتخاب قلم</span>
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: "estedad", label: "استعداد (پیش‌فرض)" },
                { id: "vazirmatn", label: "وزیرمتن" },
                { id: "serif", label: "Playfair Display" },
                { id: "sans", label: "Inter (بی‌خط)" },
                { id: "mono", label: "Fira Code (مونو)" },
                { id: "space", label: "Space Grotesk" },
                { id: "georgia", label: "Georgia (کلاسیک)" },
                { id: "system-ui", label: "قلم سیستم" },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => updateSetting("fontFamily", f.id as any)}
                  className={`min-h-10 rounded-lg border px-2 py-2 text-xs font-bold transition-all cursor-pointer text-left truncate sm:min-h-0 sm:py-1.5 sm:text-[10.5px] ${
                    settings.fontFamily === f.id
                      ? "bg-violet-500 border-violet-600 text-white"
                      : "bg-transparent border-slate-700/20 opacity-75 hover:opacity-100"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Text scale / sizing with double button control */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-bold opacity-60 uppercase font-mono">
              <span className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-violet-400" />
                <span>اندازه قلم</span>
              </span>
              <span>{settings.fontSize}px</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateSetting("fontSize", Math.max(12, settings.fontSize - 1))}
                className="min-h-10 flex-1 rounded-lg border border-slate-700/20 py-2 text-xs font-bold hover:text-violet-400 transition-all cursor-pointer bg-black/5 dark:bg-white/5 sm:min-h-0 sm:py-1"
              >
                A- (کوچک‌تر)
              </button>
              <button
                onClick={() => updateSetting("fontSize", Math.min(32, settings.fontSize + 1))}
                className="min-h-10 flex-1 rounded-lg border border-slate-700/20 py-2 text-xs font-bold hover:text-violet-400 transition-all cursor-pointer bg-black/5 dark:bg-white/5 sm:min-h-0 sm:py-1"
              >
                A+ (بزرگ‌تر)
              </button>
            </div>
          </div>

          {/* Line spacing / Rhythmic height */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-bold opacity-60 uppercase font-mono">
              <span>فاصله خطوط</span>
              <span>{settings.lineHeight}x</span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {[1.4, 1.7, 2.0, 2.4].map((lh) => (
                <button
                  key={lh}
                  onClick={() => updateSetting("lineHeight", lh)}
                  className={`min-h-10 rounded-lg border py-2 text-xs font-bold transition-all cursor-pointer sm:min-h-0 sm:py-1 sm:text-[10px] ${
                    settings.lineHeight === lh
                      ? "bg-violet-500 border-violet-600 text-white"
                      : "bg-transparent border-slate-700/20 opacity-70 hover:opacity-100"
                  }`}
                >
                  {lh}x
                </button>
              ))}
            </div>
          </div>

          {/* Alignment Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-bold opacity-60 uppercase font-mono">
              <span className="flex items-center gap-1.5">
                <AlignLeft className="w-3.5 h-3.5 text-violet-400" />
                <span>چینش متن</span>
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {[
                { id: "justify", icon: AlignJustify, label: "دوطرفه" },
                { id: "left", icon: AlignLeft, label: "چپ" },
                { id: "center", icon: AlignCenter, label: "وسط" },
                { id: "right", icon: AlignRight, label: "راست" },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => updateSetting("textAlign", item.id as any)}
                  className={`min-h-12 rounded-lg border py-2 flex flex-col items-center justify-center gap-1 transition-all cursor-pointer sm:min-h-0 sm:py-1 sm:gap-0.5 ${
                    settings.textAlign === item.id
                      ? "bg-violet-500 border-violet-600 text-white animate-soft"
                      : "bg-transparent border-slate-700/20 opacity-75 hover:opacity-100"
                  }`}
                  title={item.label}
                >
                  <item.icon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                  <span className="text-[11px] font-sans sm:text-[9px]">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Page Layout / Container Limits */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-bold opacity-60 uppercase font-mono">
              <span className="flex items-center gap-1.5">
                <Layout className="w-3.5 h-3.5 text-violet-400" />
                <span>عرض صفحه</span>
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {[
                { id: "narrow", label: "باریک" },
                { id: "normal", label: "معمولی" },
                { id: "wide", label: "عریض" },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => updateSetting("containerWidth", item.id as any)}
                  className={`min-h-10 rounded-lg border py-2 text-xs font-bold transition-all cursor-pointer sm:min-h-0 sm:py-1 sm:text-[10px] ${
                    settings.containerWidth === item.id
                      ? "bg-violet-500 border-violet-600 text-white"
                      : "bg-transparent border-slate-700/20 opacity-70 hover:opacity-100"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-700/20 p-2.5 text-xs">
            <input type="checkbox" checked={settings.blurredCoverBackground !== false} onChange={(event) => updateSetting("blurredCoverBackground", event.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-500" />
            <span><strong className="block">پس‌زمینه محو جلد</strong><span className="opacity-65">جلد این رمان به‌صورت محو در پس‌زمینه صفحهٔ مطالعه نمایش داده شود.</span></span>
          </label>
        </div>
      )}

      {/* Main Immersive Reader Column */}
      <div className="flex justify-center relative w-full">
        <main className={`reader-book-layout w-full max-w-full px-4 sm:px-6 mt-12 md:mt-16 space-y-10 transition-all duration-300 ${
          settings.containerWidth === "narrow" ? "sm:max-w-xl" :
          settings.containerWidth === "wide" ? "sm:max-w-4xl" : "sm:max-w-2xl"
        }`}>
        {!isFocusMode && <ReadingMusicPlayer />}
        
        {/* Editorial Title Header. A manga chapter is measured in pages, so the
            prose word count is replaced with the page total. */}
        <StableChapterHeading
          chapterNumber={chapter.chapterNumber}
          isAuxiliary={chapter.isAuxiliary}
          title={chapter.title}
          createdAt={chapter.createdAt}
          wordCount={chapter.wordCount}
          pageCount={isManga ? (mangaPages.length || Number(chapter.pageCount || 0)) : undefined}
          readerBorder={readerBorder}
          readerTitleColor={readerTitleColor}
        />

        {/* Top Author Notes if loaded */}
        {chapter.authorNotesTop && chapter.authorNotesTop.trim().length > 0 && (
          <div className={`p-4 rounded-xl border ${readerBorder} bg-violet-500/5 text-xs italic space-y-1`}>
            <span className="not-italic font-mono font-bold text-violet-500 uppercase text-[10px] tracking-wider block">هشدار/یادداشت نویسنده:</span>
            <p className="leading-relaxed opacity-80">{chapter.authorNotesTop}</p>
          </div>
        )}

        {/* Manga chapters are turned page by page in the dedicated viewer; prose
            chapters keep the typographic scroll below. */}
        {isManga ? (
          <MangaReader
            pages={mangaPages}
            chapterTitle={chapter.title}
            chapterNumber={chapter.chapterNumber}
            novelTitle={novel.title}
            readingDirection={readingDirection}
            theme={theme}
            loading={mangaPagesLoading}
            error={mangaPagesError}
            onRetry={() => setMangaReloadKey((value) => value + 1)}
            initialPageIndex={mangaPageIndex || mangaPageIndexFromPercent(initialProgressPercent, mangaPages.length)}
            onProgress={handleMangaProgress}
            onRequestNextChapter={nextChapter ? () => onNavigateChapter(nextChapter.id) : undefined}
            onRequestPreviousChapter={prevChapter ? () => onNavigateChapter(prevChapter.id) : undefined}
          />
        ) : (
        /* Dynamic Typography Story Text Block */
        <article
          ref={containerRef}
          translate="yes"
          onCopy={canCopyChapterText ? undefined : (event) => {
            if (!(event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable='true']"))) event.preventDefault();
          }}
          onCut={canCopyChapterText ? undefined : (event) => {
            if (!(event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable='true']"))) event.preventDefault();
          }}
          onDragStart={canCopyChapterText ? undefined : (event) => {
            if (!(event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable='true']"))) event.preventDefault();
          }}
          className={`${fontStyle[settings.fontFamily] || fontStyle.estedad} reader-prose ${bookMode ? "reader-book-prose" : ""} ${preventCopy ? "reader-protected-prose" : ""} relative ${preventCopy ? "select-none" : "select-text"}`}
          style={{
            fontSize: `${settings.fontSize}px`,
            lineHeight: `${settings.lineHeight}`,
            "--reader-line-step": `${settings.fontSize * settings.lineHeight}px`,
            WebkitUserSelect: "text",
            userSelect: "text",
          } as React.CSSProperties}
        >
          <StableChapterStory
            novelId={novel.id}
            chapterId={chapter.id}
            content={chapter.content}
            paragraphs={chapter.paragraphs}
            currentUser={currentUser}
            paragraphCommentCounts={paragraphCommentCounts}
            activeParagraph={activeParagraph}
            textAlign={settings.textAlign}
            readerBorder={readerBorder}
            onSelectParagraph={selectParagraph}
            onCloseParagraph={closeParagraph}
            onParagraphCountChange={updateParagraphCommentCount}
          />
        </article>
        )}

        <section className={`flex flex-col items-center gap-2 rounded-2xl border ${readerBorder} ${readerCard} p-6 text-center`}>
          <button
            type="button"
            onClick={handleChapterLike}
            disabled={chapterLikeBusy}
            aria-pressed={chapterLiked}
            className={`inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-extrabold transition-all disabled:cursor-wait disabled:opacity-60 ${chapterLiked ? "border-rose-500 bg-rose-500 text-white shadow-lg shadow-rose-500/20" : `${readerBorder} hover:border-rose-400 hover:text-rose-500`}`}
          >
            <Heart className={`h-5 w-5 ${chapterLiked ? "fill-current" : ""}`} />
            <span>{chapterLiked ? "پسندیده شد" : "پسندیدن این فصل"}</span>
            <span className="tabular-nums opacity-80">{chapterLikesCount.toLocaleString()}</span>
          </button>
          <p className="text-[11px] opacity-60">{currentUser ? "می‌توانید هر تعداد فصل متفاوت را پسندید." : "برای پسندیدن این فصل وارد شوید."}</p>
          {chapterLikeError && <p role="alert" className="text-xs font-semibold text-rose-500">{chapterLikeError}</p>}
        </section>

        {/* Bottom Author Notes if loaded */}
        {chapter.authorNotesBottom && chapter.authorNotesBottom.trim().length > 0 && (
          <div className={`p-4 rounded-xl border ${readerBorder} bg-violet-500/5 text-xs italic space-y-1`}>
            <span className="not-italic font-mono font-bold text-violet-500 uppercase text-[10px] tracking-wider block">یادداشت پایانی نویسنده:</span>
            <p className="leading-relaxed opacity-80">{chapter.authorNotesBottom}</p>
          </div>
        )}

        <AuthorLinksDisplay
          username={novel.authorUsername || novel.author}
          authorName={novel.authorDisplayName || novel.author}
          placement="chapter"
        />

        {/* Previous / Next Chapter Footer Controls */}
        <div className={`flex items-center justify-between gap-4 pt-12 border-t border-dashed ${readerBorder}`}>
          {prevChapter ? (
            <button
              onClick={() => onNavigateChapter(prevChapter.id)}
              className={`flex-1 py-3 px-4 rounded-xl border ${readerBorder} ${readerCard} flex items-center justify-center gap-1.5 text-xs font-bold hover:border-violet-500/30 transition-all cursor-pointer`}
            >
              <ChevronLeft className="w-4 h-4" />
              <span>{prevChapter.isAuxiliary ? "فرعی" : "فصل"} {prevChapter.chapterNumber}: قبلی</span>
            </button>
          ) : (
            <div className="flex-1" />
          )}

          <button
            onClick={onBackToNovel}
            className={`px-4 py-3 rounded-xl border ${readerBorder} ${readerCard} text-xs font-bold hover:border-violet-500/30 transition-all cursor-pointer`}
            title="نمای فهرست"
          >
            <span>نمای کلی</span>
          </button>

          {nextChapter ? (
            <button
              onClick={() => onNavigateChapter(nextChapter.id)}
              className="flex-1 py-3 px-4 rounded-xl bg-violet-600 text-white flex items-center justify-center gap-1.5 text-xs font-bold hover:bg-violet-500 transition-all shadow shadow-violet-500/10 cursor-pointer"
            >
              <span>{nextChapter.isAuxiliary ? "فرعی" : "فصل"} {nextChapter.chapterNumber}: بعدی</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onBackToNovel}
              className="flex-1 py-3 px-4 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 flex items-center justify-center gap-1 text-xs font-bold opacity-60 hover:opacity-100 transition-all cursor-pointer"
            >
              <span>پایان کتاب</span>
            </button>
          )}
        </div>

        <section className={`p-5 rounded-2xl border ${readerBorder} ${readerCard} space-y-4 shadow-sm`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-emerald-400" />
              <h4 className="font-extrabold text-xs font-mono uppercase tracking-wider">دیدگاه‌های فصل</h4>
            </div>
            <span className="text-[10px] font-mono opacity-50">{chapterComments.length} دیدگاه</span>
          </div>

          <div className="space-y-3 max-h-72 overflow-y-auto custom-scrollbar pr-1">
            {chapterComments.length === 0 ? (
              <p className="text-xs opacity-55 font-sans">هنوز دیدگاهی برای این فصل ثبت نشده است. گفتگو را با یادداشتی دربارهٔ این فصل آغاز کنید.</p>
            ) : (
              chapterComments.map((comment) => (
                <div key={comment.id} className={`p-3 rounded-xl border ${comment.parent_id ? "ml-5" : ""} ${readerBorder} ${theme === "dark" ? "bg-black/25" : "bg-white/60"}`}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <button
                      type="button"
                      onClick={() => comment.username && onSelectUser?.(comment.username)}
                      disabled={!comment.username || !onSelectUser}
                      className="min-w-0 flex items-center gap-2 text-left disabled:cursor-default enabled:cursor-pointer group"
                    >
                      <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 via-purple-600 to-emerald-500 text-white flex items-center justify-center text-[11px] font-black shrink-0 overflow-hidden">
                        {getSafeAvatarUrl(comment.avatar) ? (
                          <SafeImage
                            src={getSafeAvatarUrl(comment.avatar) || ""}
                            alt={comment.displayName || comment.username || "خواننده"}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          String(comment.displayName || comment.username || "خواننده").slice(0, 2).toUpperCase()
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-extrabold text-violet-400 truncate group-hover:text-violet-300">
                          {comment.displayName || comment.username || "خواننده"}
                        </span>
                        {comment.username && (
                          <span className="block text-[9px] opacity-50 font-mono truncate">@{comment.username}</span>
                        )}
                      </span>
                    </button>
                    <div className="flex items-center gap-2">
                      {currentUser && currentUser.id !== comment.user_id && <ReportButton targetType="message" targetId={comment.id} label="" className="text-rose-400/70 hover:text-rose-400" />}
                      <span className="text-[9px] opacity-45 font-mono">{new Date(comment.created_at).toLocaleString("fa-IR")}</span>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{comment.content}</p>
                  {!comment.deleted_at && (
                    <div className="mt-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleChapterCommentLike(comment)}
                        disabled={commentLikeBusyIds.has(comment.id)}
                        aria-label={comment.likedByCurrentUser ? "لغو پسند دیدگاه" : "پسندیدن دیدگاه"}
                        aria-pressed={!!comment.likedByCurrentUser}
                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold disabled:opacity-50 ${comment.likedByCurrentUser ? "text-rose-500" : "opacity-60 hover:text-rose-500 hover:opacity-100"}`}
                      >
                        <Heart className={`h-3.5 w-3.5 ${comment.likedByCurrentUser ? "fill-current" : ""}`} />
                        {Number(comment.likesCount || 0)}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setChapterReplyTo(comment); setChapterCommentDraft(""); }}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold opacity-60 hover:text-violet-400 hover:opacity-100"
                      >
                        <Reply className="h-3.5 w-3.5" /> پاسخ
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="space-y-2">
            {chapterReplyTo && (
              <div className="flex items-center justify-between rounded-lg bg-violet-500/10 px-3 py-2 text-[10px]">
                <span>در حال پاسخ به {chapterReplyTo.displayName || chapterReplyTo.username || "خواننده"}</span>
                <button type="button" onClick={() => { setChapterReplyTo(null); setChapterCommentDraft(""); }} className="font-bold text-violet-400">لغو</button>
              </div>
            )}
            <textarea
              rows={3}
              value={chapterCommentDraft}
              onChange={(e) => setChapterCommentDraft(e.target.value)}
              placeholder={chapterReplyTo ? "پاسخ خود را بنویسید..." : "دیدگاه خود را دربارهٔ این فصل بنویسید..."}
              className={`w-full p-3 text-xs font-sans rounded-xl border border-slate-700/15 focus:outline-none transition-all resize-none ${
                settings.themePreset === "sepia" ? "bg-[#ECE1CC] text-[#433422] focus:border-[#B45309]" :
                theme === "dark" || ["coal", "black", "forest", "royal"].includes(settings.themePreset) ? "bg-black/40 text-white focus:border-emerald-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-emerald-500"
              }`}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] text-rose-400">{commentError}</p>
              <button
                onClick={handlePostChapterComment}
                disabled={!chapterCommentDraft.trim()}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-50 hover:bg-emerald-500 transition-all cursor-pointer"
              >
                {chapterReplyTo ? "ارسال پاسخ" : "ارسال دیدگاه"}
              </button>
            </div>
          </div>
        </section>

        {/* Private Readers Notebook widget */}
        <section id="readers-notebook" className={`p-5 rounded-2xl border ${readerBorder} ${readerCard} space-y-4 shadow-sm`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <h4 className="font-extrabold text-xs font-mono uppercase tracking-wider">دفترچهٔ یادداشت خواننده</h4>
            </div>
            
            {customNotes.trim().length > 0 && (
              <button
                onClick={handleSaveNotes}
                className="text-xs font-bold text-violet-400 bg-violet-500/10 px-2 py-1 rounded hover:bg-violet-500 hover:text-white transition-all cursor-pointer flex items-center gap-1"
              >
                {isSavedNote ? <Check className="w-3" /> : <Save className="w-3" />}
                <span>{isSavedNote ? "ذخیره شد" : "ذخیره یادداشت‌ها"}</span>
              </button>
            )}
          </div>
          
          <p className="text-xs opacity-60 font-sans">
            نظریه‌های شخصی، خط زمانی داستان یا جزئیات شخصیت‌ها را اینجا ثبت کنید. یادداشت‌ها خصوصی هستند و با حساب شما همگام می‌شوند.
          </p>

          <textarea
            rows={3}
            value={customNotes}
            onChange={(e) => {
              setCustomNotes(e.target.value);
              setIsSavedNote(false);
            }}
            placeholder="مثلاً: به نظرم خواهر ایتان در واقع امپراتریس سایه‌های شکاف سوم است! نشان موجود در فصل 2 با گردنبند او مطابقت دارد..."
            className={`w-full p-3 text-xs font-sans rounded-xl border border-slate-700/15 focus:outline-none transition-all resize-none ${
              settings.themePreset === "sepia" ? "bg-[#ECE1CC] text-[#433422] focus:border-[#B45309]" :
              theme === "dark" || ["coal", "black", "forest", "royal"].includes(settings.themePreset) ? "bg-black/40 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-purple-500"
            }`}
          />
        </section>

        {currentUser && currentUser.id !== novel.author_id && <ReportButton targetType="chapter" targetId={chapter.id} label="گزارش این فصل" className="text-[10px] text-rose-400 hover:text-rose-300" />}

      </main>
      </div>
    </div>
  );
}

export default React.memo(Reader);
