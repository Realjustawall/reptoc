import React, { useState, useRef } from "react";
import { Novel, Chapter } from "../types";
import { GENRES, CONTRAST_THEMES, MAIN_CATEGORIES, SUB_CATEGORIES, CONTENT_WARNINGS, filterTaxonomyList, normalizeMainGenre } from "../data";
import {
  Sparkles, PenTool, Plus, Check, Trash2, FileText, Calendar, ArrowLeft,
  Eye, Flame, RotateCw, Save, Bookmark, Star, Upload, Cloud, Image, Trash, BarChart3,
  TrendingUp, Users, Award, BookOpen, Clock, Settings, MessageSquare, History, Globe2, Smartphone, ShieldAlert, Monitor, Pencil, Heart,
  MessagesSquare, Search, Activity, Wallet
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as ReTooltip, 
  CartesianGrid, BarChart, Bar, LineChart, Line, Rectangle
} from "recharts";
import TiptapEditor from "./TiptapEditor";
import MangaPageEditor from "./MangaPageEditor";
import MangaReader from "./MangaReader";
import CoverEditorModal from "./CoverEditorModal";
import CharacterImageCropModal from "./CharacterImageCropModal";
import { api } from "../utils/api";
import AuthorSocialLinksPanel from "./AuthorSocialLinksPanel";
import { normalizeContentWarnings } from "../../shared/contentWarnings";
import { PREMIUM_TEMPLATES, premiumTemplateById, sanitizePremiumPresentation } from "../../shared/premiumTemplates";
import { extractAccessibleCoverPalette } from "../utils/premiumPalette";
import SafeImage from "./SafeImage";
import { formatAverageViews } from "../../shared/statistics";
import { browserTimeZoneLabel, futureScheduleIso, minimumScheduledDateTimeInput, scheduledDateLabel, toDateTimeLocalInput } from "../utils/chapterScheduling";
import {
  isMangaWork,
  normalizeContentKind,
  normalizeReadingDirection,
  type ContentKind,
  type MangaPage,
  type ReadingDirection,
} from "../../shared/manga";

interface WriterProps {
  novels: Novel[];
  onAddNewNovel: (novel: Novel) => void | Promise<void>;
  onUpdateNovelChapters: (novelId: string, chapters: Chapter[]) => void;
  onUpdateNovel?: (novel: Novel) => void | Promise<void>;
  onUpdateNovelCover?: (novelId: string, coverUrl: string) => void | Promise<void>;
  onDeleteNovel?: (novelId: string) => void | Promise<void>;
  onBackToDashboard: () => void;
  theme: "light" | "dark";
  bookMode?: boolean;
  onBookModeChange?: (enabled: boolean) => void;
  currentUser?: any;
  initialEditNovelId?: string;
  onOpenWorldbuilding?: (novelId: string) => void;
}

const DEFAULT_COVERS = [
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80", // Nebula
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80", // Retro Painting
  "https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?w=400&auto=format&fit=crop&q=80", // Digital Sculpture
  "https://images.unsplash.com/photo-1509248961158-e54f6934749c?w=400&auto=format&fit=crop&q=80", // Noir Streets
];

const DEFAULT_FIRST_CHAPTER_TITLE = "فصل 1: تنظیم هاله";
const DEFAULT_FIRST_CHAPTER_CONTENT = "<p>جهان در برابر چشمانم از حرکت ایستاد. صفحه‌های هولوگرامی آبی و شفاف شروع به معلق زدن و چرخیدن در مقابل صورتم کردند...</p>";
const WRITER_DRAFT_STORAGE_PREFIX = "reptoc-writer-create-draft";

function sanitizePreviewHtml(html: string) {
  if (typeof window === "undefined") return "";
  const template = document.createElement("template");
  // Allowlist-based (not blacklist): anything not explicitly permitted is
  // stripped, mirroring the server-side chapter sanitizer's philosophy.
  const allowedTags = new Set([
    "p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li",
    "blockquote", "h1", "h2", "h3", "h4", "hr", "span", "div", "img"
  ]);
  const voidTags = new Set(["br", "img", "hr"]);
  template.innerHTML = html || "";
  template.content.querySelectorAll("*").forEach((node) => {
    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();
    // Capture the original src BEFORE stripping attributes.
    const originalSrc = String(element.getAttribute("src") || "");
    if (!allowedTags.has(tagName)) {
      if (voidTags.has(tagName) || !element.textContent?.trim()) {
        element.remove();
      } else {
        element.replaceWith(...Array.from(element.childNodes));
      }
      return;
    }
    // Capture the illustration layout before attributes are stripped so the
    // reader preview matches what the editor showed.
    const originalAlt = String(element.getAttribute("alt") || "");
    const originalWidth = String(element.getAttribute("data-width") || "");
    const originalAlign = String(element.getAttribute("data-align") || "");
    const originalFloat = String(element.getAttribute("data-float") || "");
    [...element.attributes].forEach((attr) => element.removeAttribute(attr.name));
    if (tagName === "img") {
      const isSafeImage = /^https:/i.test(originalSrc) || /^\/(?:uploads\/|api\/)/i.test(originalSrc);
      if (isSafeImage) {
        element.setAttribute("src", originalSrc);
        element.setAttribute("alt", originalAlt || "تصویر");
        element.setAttribute("loading", "lazy");
        if (["small", "medium", "full"].includes(originalWidth)) element.setAttribute("data-width", originalWidth);
        if (["start", "center", "end"].includes(originalAlign)) element.setAttribute("data-align", originalAlign);
        if (["start", "end"].includes(originalFloat)) element.setAttribute("data-float", originalFloat);
      } else {
        element.remove();
      }
    }
  });
  return template.innerHTML;
}

function makeChapterId(novelId: string, chapterNumber: number) {
  const safeNovelId = String(novelId || "novel").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 90);
  const safeNumber = Math.max(1, Number(chapterNumber) || 1);
  const uniquePart = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `chap-${safeNovelId}-${safeNumber}-${uniquePart}`;
}

function makeNovelId(userId?: string) {
  const safeUserId = String(userId || "user").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
  const randomPart = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `usr-${safeUserId}-${Date.now().toString(36)}-${randomPart}`;
}

function resolveChapterIdForSave(novel: Novel, chapterNumber: number, editingChapterId?: string | null) {
  if (editingChapterId) return editingChapterId;
  return makeChapterId(novel.id, chapterNumber);
}

/**
 * Tracks the phone breakpoint so the workspace can collapse secondary panels.
 *
 * Reading `matchMedia` during the initial state keeps the first paint correct
 * (no flash of an expanded storyboard) and the listener keeps it in sync when
 * the device is rotated.
 */
/**
 * Reader preview for a manga chapter.
 *
 * The pages are re-fetched from the server rather than reused from the editor's
 * local list, so the preview shows exactly what a reader would receive: if a
 * reorder has not been saved yet, that difference is visible here.
 */
function MangaChapterPreview({
  novelId,
  chapterId,
  chapterTitle,
  chapterNumber,
  novelTitle,
  readingDirection,
  theme,
}: {
  novelId: string;
  chapterId: string;
  chapterTitle: string;
  chapterNumber: number;
  novelTitle: string;
  readingDirection: ReadingDirection;
  theme: "light" | "dark";
}) {
  const [pages, setPages] = React.useState<MangaPage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.getMangaPages(novelId, chapterId)
      .then((result) => {
        if (active) setPages(result.pages);
      })
      .catch((requestError: any) => {
        if (active) setError(requestError?.message || "بارگذاری صفحه‌ها ممکن نشد.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [chapterId, novelId]);

  if (error) {
    return <p className="p-8 text-center text-xs font-bold text-rose-400">{error}</p>;
  }

  return (
    <MangaReader
      pages={pages}
      chapterTitle={chapterTitle}
      chapterNumber={chapterNumber}
      novelTitle={novelTitle}
      readingDirection={readingDirection}
      theme={theme}
      loading={loading}
    />
  );
}

function useMobileViewport(query = "(max-width: 1023px)") {
  const [isMobile, setIsMobile] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  React.useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setIsMobile(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, [query]);

  return isMobile;
}

export default function Writer({
  novels,
  onAddNewNovel,
  onUpdateNovelChapters,
  onUpdateNovel,
  onUpdateNovelCover,
  onDeleteNovel,
  onBackToDashboard,
  theme,
  bookMode = false,
  onBookModeChange,
  currentUser,
  initialEditNovelId,
  onOpenWorldbuilding,
}: WriterProps) {
  const activeTheme = CONTRAST_THEMES[theme];
  const isMobileViewport = useMobileViewport();

  const [activeWorkflow, setActiveWorkflow] = useState<"choose" | "worksheet">("choose");
  const [selectedNovelId, setSelectedNovelId] = useState<string>("");
  const initializedEditNovelIdRef = React.useRef<string | null>(null);

  // Per-novel engagement roll-up (likes / comments / reviews / views).
  type WriterNovelStat = {
    novelId: string; title: string; coverUrl: string; viewsCount: number;
    likesCount: number; commentsCount: number; reviewsCount: number;
    avgRating: number; totalEngagement: number;
  };
  const [novelStats, setNovelStats] = useState<WriterNovelStat[]>([]);
  const [novelStatsError, setNovelStatsError] = useState("");
  const statsRefreshRef = React.useRef(0);
  const novelCountKey = novels.map((novel) => novel.id).join("|");

  const loadNovelStats = React.useCallback(() => {
    const run = ++statsRefreshRef.current;
    api.getWriterNovelStats()
      .then((rows) => { if (run === statsRefreshRef.current) { setNovelStats(rows); setNovelStatsError(""); } })
      .catch((error: any) => { if (run === statsRefreshRef.current) setNovelStatsError(error?.message || "بارگذاری آمار ناموفق بود."); });
  }, []);

  React.useEffect(() => {
    loadNovelStats();
  }, [loadNovelStats, novelCountKey]);

  const statsByNovelId = new Map<string, WriterNovelStat>(novelStats.map((stat) => [stat.novelId, stat] as const));

  React.useEffect(() => {
    const targetNovel = novels.find((novel) => novel.id === initialEditNovelId);
    if (!initialEditNovelId || !targetNovel) return;
    if (initializedEditNovelIdRef.current === initialEditNovelId) return;
    initializedEditNovelIdRef.current = initialEditNovelId;
    setSelectedNovelId(initialEditNovelId);
    setActiveWorkflow("worksheet");
    setWorkspaceTab("metadata");
    setEditBookTitle(targetNovel.title);
    setEditBookAuthor(targetNovel.author);
    setEditBookGenre(targetNovel.genre);
    setEditBookDesc(targetNovel.description || "");
    setEditBookCover(targetNovel.cover || targetNovel.coverUrl || "");
    setEditBookTags(targetNovel.tags ? filterTaxonomyList(targetNovel.tags).join(", ") : "");
    const initialWarnings = normalizeContentWarnings(filterTaxonomyList(targetNovel.warnings || []), CONTENT_WARNINGS);
    setEditBookWarnings([...initialWarnings.values, ...initialWarnings.invalid]);
    setEditPremiumPresentation(sanitizePremiumPresentation(targetNovel.premiumPresentation));    setEditOriginType(targetNovel.originType === "translated" ? "translated" : "original");
    setEditOriginalAuthor(targetNovel.originalAuthor || "");
    setEditTranslators(Array.isArray(targetNovel.translators) ? targetNovel.translators.join(", ") : "");
    setEditReadingDirection(normalizeReadingDirection((targetNovel as any).readingDirection));
    setEditPreventCopy(targetNovel.preventCopy === true);
    setEditPreventScreenshot(targetNovel.preventScreenshot === true);
  }, [initialEditNovelId, novels]);

  // Create novel states
  const [bookTitle, setBookTitle] = useState("");
  const [bookAuthor, setBookAuthor] = useState("");
  const [isCoverModalOpen, setIsCoverModalOpen] = useState(false);
  const [bookGenre, setBookGenre] = useState("");
  const [novelMainCategories, setNovelMainCategories] = useState<string[]>([]);
  const [novelSubCategories, setNovelSubCategories] = useState<string[]>([]);
  const [bookDesc, setBookDesc] = useState("");
  const [bookCover, setBookCover] = useState("");
  const [subCatSearch, setSubCatSearch] = useState("");
  const [isCreatingBook, setIsCreatingBook] = useState(false);
  const [isPublishingBook, setIsPublishingBook] = useState(false);
  const [bookError, setBookError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Novel origin: original story vs translated work (requires credits).
  const [novelOriginType, setNovelOriginType] = useState<"original" | "translated">("original");
  const [novelOriginalAuthor, setNovelOriginalAuthor] = useState("");
  const [novelTranslators, setNovelTranslators] = useState("");

  // Work type. Prose chapters hold text; manga chapters hold ordered image
  // pages, so the choice is made once at creation and cannot change afterwards.
  const [novelContentKind, setNovelContentKind] = useState<ContentKind>("novel");
  const [novelReadingDirection, setNovelReadingDirection] = useState<ReadingDirection>("rtl");
  const [editReadingDirection, setEditReadingDirection] = useState<ReadingDirection>("rtl");
  const [mangaPreviewPages, setMangaPreviewPages] = useState<MangaPage[] | null>(null);

  // Cover upload helpers
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const [isEditingCoverForExistingBook, setIsEditingCoverForExistingBook] = useState(false);

  const closeCoverModal = () => {
    setIsCoverModalOpen(false);
    setIsEditingCoverForExistingBook(false);
  };

  const openCreateCoverModal = () => {
    setIsEditingCoverForExistingBook(false);
    setIsCoverModalOpen(true);
  };

  const openEditCoverModal = () => {
    setIsEditingCoverForExistingBook(true);
    setIsCoverModalOpen(true);
  };

  // Edit Chapter states
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [chNumber, setChNumber] = useState<number>(1);
  const [isAuxiliaryChapter, setIsAuxiliaryChapter] = useState(false);
  const [chTitle, setChTitle] = useState("");
  const [chContent, setChContent] = useState("");
  const [authNotesTop, setAuthNotesTop] = useState("");
  const [authNotesBottom, setAuthNotesBottom] = useState("");
  const [targetWordCount, setTargetWordCount] = useState<number>(1000);
  const [chStatus, setChStatus] = useState<"Draft" | "Published" | "Scheduled">("Published");
  const [chScheduledAt, setChScheduledAt] = useState<string>("");
  const [chPreventCopy, setChPreventCopy] = useState(false);
  const [chPreventScreenshot, setChPreventScreenshot] = useState(false);

  // Series metadata edit states
  const [editBookTitle, setEditBookTitle] = useState("");
  const [editBookAuthor, setEditBookAuthor] = useState("");
  const [editBookGenre, setEditBookGenre] = useState("LitRPG & Fantasy");
  const [editBookDesc, setEditBookDesc] = useState("");
  const [editBookCover, setEditBookCover] = useState("");
  const [editBookTags, setEditBookTags] = useState("");
  const [editBookWarnings, setEditBookWarnings] = useState<string[]>([]);
  const [editOriginType, setEditOriginType] = useState<"original" | "translated">("original");
  const [editOriginalAuthor, setEditOriginalAuthor] = useState("");
  const [editTranslators, setEditTranslators] = useState("");
  const [editPremiumPresentation, setEditPremiumPresentation] = useState(sanitizePremiumPresentation(undefined));
  const [editPreventCopy, setEditPreventCopy] = useState(false);
  const [editPreventScreenshot, setEditPreventScreenshot] = useState(false);
  const [isBookMetaDataSaved, setIsBookMetaDataSaved] = useState(false);
  const [isDeletingNovel, setIsDeletingNovel] = useState(false);

  // Additional settings
  const [novelTags, setNovelTags] = useState("");
  const [novelWarnings, setNovelWarnings] = useState<string[]>([]);
  const [novelAgeRating, setNovelAgeRating] = useState("PG-13");
  const [firstChapterTitle, setFirstChapterTitle] = useState(DEFAULT_FIRST_CHAPTER_TITLE);
  const [firstChapterContent, setFirstChapterContent] = useState(DEFAULT_FIRST_CHAPTER_CONTENT);
  const [firstChapterStatus, setFirstChapterStatus] = useState<"Draft" | "Published" | "Scheduled">("Published");
  const [firstChapterScheduledAt, setFirstChapterScheduledAt] = useState("");

  const [isSavedNotify, setIsSavedNotify] = useState(false);
  const [isSavingChapter, setIsSavingChapter] = useState(false);
  const [chError, setChError] = useState("");
  const [workspaceTab, setWorkspaceTab] = useState<"write" | "security" | "preview" | "characters" | "metadata" | "analytics" | "comments" | "monetize" | "editor-chat" | "posts">("write");
  const [protectionSavingId, setProtectionSavingId] = useState("");
  const [protectionMessage, setProtectionMessage] = useState("");

  const activeNovel = novels.find((n) => n.id === selectedNovelId);
  // Chapter bodies are stripped from the catalogue feed. Until the full novel
  // arrives, the workspace must not autosave: writing an empty canvas back
  // would erase the real chapter text.
  const activeNovelChaptersHydrated = !!activeNovel && (activeNovel as any).catalogueOnly !== true;
  // Manga works are edited page by page instead of in the prose editor.
  const isMangaNovel = isMangaWork(activeNovel);
  const activeReadingDirection = normalizeReadingDirection((activeNovel as any)?.readingDirection);
  // Page totals per chapter. A manga chapter may only be published once it has
  // at least one page, so the count gates the publish button and autosave.
  const [mangaPageCounts, setMangaPageCounts] = useState<Record<string, number>>({});
  const [mangaPageCountsLoaded, setMangaPageCountsLoaded] = useState(false);
  const mangaPageCount = editingChapterId ? Number(mangaPageCounts[editingChapterId] || 0) : 0;
  const token = api.getToken();
  const draftStorageKey = `${WRITER_DRAFT_STORAGE_PREFIX}:${currentUser?.id || currentUser?.username || "guest"}`;
  const hasRestoredDraftRef = React.useRef(false);

  /**
   * Page totals for a manga's chapters.
   *
   * Loaded once per work (and refreshed by the page editor through
   * `onPageCountChange`) so the chapter list and the publish gate can show and
   * enforce page counts without fetching every chapter's pages.
   */
  React.useEffect(() => {
    if (!activeNovel || !isMangaNovel) {
      setMangaPageCounts({});
      setMangaPageCountsLoaded(false);
      return;
    }
    let active = true;
    setMangaPageCountsLoaded(false);
    api.getMangaPageCounts(activeNovel.id)
      .then((counts) => {
        if (!active) return;
        setMangaPageCounts(counts);
      })
      .catch(() => {
        if (active) setMangaPageCounts({});
      })
      .finally(() => {
        if (active) setMangaPageCountsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [activeNovel?.id, isMangaNovel]);

  const handleMangaPageCountChange = React.useCallback((chapterId: string, pageCount: number) => {
    setMangaPageCounts((current) => (
      Number(current[chapterId] || 0) === pageCount ? current : { ...current, [chapterId]: pageCount }
    ));
    if (!activeNovel) return;
    // Keep the in-memory chapter in step so the chapter list and the reader
    // preview do not need a refetch.
    const chapters = (activeNovel.chapters || []).map((chapter) => (
      chapter.id === chapterId ? { ...chapter, pageCount } : chapter
    ));
    onUpdateNovelChapters(activeNovel.id, chapters);
  }, [activeNovel, onUpdateNovelChapters]);

  const resetCreateNovelDraft = React.useCallback(() => {
    setBookTitle("");
    setBookAuthor("");
    setBookGenre("");
    setNovelMainCategories([]);
    setNovelSubCategories([]);
    setBookDesc("");
    setBookCover("");
    setSubCatSearch("");
    setIsCreatingBook(false);
    setBookError("");
    setNovelTags("");
    setNovelWarnings([]);
    setNovelAgeRating("PG-13");
    setFirstChapterTitle(DEFAULT_FIRST_CHAPTER_TITLE);
    setFirstChapterContent(DEFAULT_FIRST_CHAPTER_CONTENT);
    setFirstChapterStatus("Published");
    setFirstChapterScheduledAt("");
    try {
      localStorage.removeItem(draftStorageKey);
    } catch {}
  }, [draftStorageKey]);

  React.useEffect(() => {
    hasRestoredDraftRef.current = false;
    try {
      const saved = JSON.parse(localStorage.getItem(draftStorageKey) || "null");
      if (saved) {
        // Restore draft fields, but never skip the user's novel picker.
        setActiveWorkflow("choose");
        setSelectedNovelId("");
        setWorkspaceTab(saved.workspaceTab || "write");
        setIsCreatingBook(false);
        setBookTitle(saved.bookTitle || "");
        setBookAuthor(saved.bookAuthor || "");
        setBookGenre(normalizeMainGenre(saved.bookGenre));
        setNovelMainCategories(filterTaxonomyList(Array.isArray(saved.novelMainCategories) ? saved.novelMainCategories : []));
        setNovelSubCategories(filterTaxonomyList(Array.isArray(saved.novelSubCategories) ? saved.novelSubCategories : []));
        setBookDesc(saved.bookDesc || "");
        setBookCover(saved.bookCover || "");
        setSubCatSearch(saved.subCatSearch || "");
        setNovelTags(saved.novelTags || "");
        setNovelWarnings(filterTaxonomyList(Array.isArray(saved.novelWarnings) ? saved.novelWarnings : []));
        setNovelAgeRating(saved.novelAgeRating || "PG-13");
        setFirstChapterTitle(saved.firstChapterTitle || DEFAULT_FIRST_CHAPTER_TITLE);
        setFirstChapterContent(saved.firstChapterContent || DEFAULT_FIRST_CHAPTER_CONTENT);
        setFirstChapterStatus(["Draft", "Published", "Scheduled"].includes(saved.firstChapterStatus) ? saved.firstChapterStatus : "Published");
        setFirstChapterScheduledAt(saved.firstChapterScheduledAt || "");
      }
    } catch {}
    if (initialEditNovelId) {
      setSelectedNovelId(initialEditNovelId);
      setActiveWorkflow("worksheet");
      setWorkspaceTab("metadata");
    }
    hasRestoredDraftRef.current = true;
  }, [draftStorageKey, initialEditNovelId]);

  React.useEffect(() => {
    if (!hasRestoredDraftRef.current) return;
    const timeoutId = window.setTimeout(() => {
      const hasCreateDraft =
        bookTitle.trim() ||
        bookAuthor.trim() ||
        bookDesc.trim() ||
        bookCover ||
        novelTags.trim() ||
        novelMainCategories.length > 0 ||
        novelSubCategories.length > 0 ||
        novelWarnings.length > 0 ||
        firstChapterTitle !== DEFAULT_FIRST_CHAPTER_TITLE ||
        firstChapterContent !== DEFAULT_FIRST_CHAPTER_CONTENT;

      try {
        if (!hasCreateDraft && !isCreatingBook && activeWorkflow === "choose" && !selectedNovelId) {
          localStorage.removeItem(draftStorageKey);
          return;
        }
        localStorage.setItem(draftStorageKey, JSON.stringify({
          activeWorkflow,
          selectedNovelId,
          workspaceTab,
          isCreatingBook,
          bookTitle,
          bookAuthor,
          bookGenre,
          novelMainCategories,
          novelSubCategories,
          bookDesc,
          bookCover,
          subCatSearch,
          novelTags,
          novelWarnings,
          novelAgeRating,
          firstChapterTitle,
          firstChapterContent,
          firstChapterStatus,
          firstChapterScheduledAt
        }));
      } catch {}
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [activeWorkflow, selectedNovelId, workspaceTab, isCreatingBook, bookTitle, bookAuthor, bookGenre, novelMainCategories, novelSubCategories, bookDesc, bookCover, subCatSearch, novelTags, novelWarnings, novelAgeRating, firstChapterTitle, firstChapterContent, firstChapterStatus, firstChapterScheduledAt, draftStorageKey]);

  // Track last saved state for autosave
  const lastSavedRef = React.useRef({
    title: "",
    content: "",
    top: "",
    bottom: "",
    isAuxiliary: false,
    preventCopy: false,
    preventScreenshot: false,
  });
  const autosaveInFlightRef = React.useRef<Promise<any> | null>(null);
  // Surfaced in the workspace header so the author always knows whether their
  // words are on the server. "unsaved" also arms the navigation guard below.
  const [saveState, setSaveState] = useState<"idle" | "unsaved" | "saving" | "saved" | "failed">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const hasUnsavedChanges =
    !!activeNovel
    && activeNovelChaptersHydrated
    && (!!chTitle || !!chContent)
    && (lastSavedRef.current.title !== chTitle
      || lastSavedRef.current.content !== chContent
      || lastSavedRef.current.top !== authNotesTop
      || lastSavedRef.current.bottom !== authNotesBottom
      || lastSavedRef.current.isAuxiliary !== isAuxiliaryChapter
      || lastSavedRef.current.preventCopy !== chPreventCopy
      || lastSavedRef.current.preventScreenshot !== chPreventScreenshot);

  React.useEffect(() => {
    if (!hasUnsavedChanges) return;
    setSaveState((current) => (current === "saving" ? current : "unsaved"));
  }, [hasUnsavedChanges]);

  // Autosave. This runs for drafts, published chapters and scheduled chapters
  // alike: losing a tab used to discard every edit to an already-published
  // chapter, because autosave only covered drafts.
  React.useEffect(() => {
    if (!activeNovel) return;
    if (!activeNovelChaptersHydrated) return;
    if (!chTitle && !chContent) return;

    // Check if anything actually changed since last save
    if (
      lastSavedRef.current.title === chTitle &&
      lastSavedRef.current.content === chContent &&
      lastSavedRef.current.top === authNotesTop &&
      lastSavedRef.current.bottom === authNotesBottom &&
      lastSavedRef.current.isAuxiliary === isAuxiliaryChapter &&
      lastSavedRef.current.preventCopy === chPreventCopy &&
      lastSavedRef.current.preventScreenshot === chPreventScreenshot
    ) {
      return;
    }

    const timeoutId = setTimeout(async () => {
      lastSavedRef.current = {
        title: chTitle,
        content: chContent,
        top: authNotesTop,
        bottom: authNotesBottom,
        isAuxiliary: isAuxiliaryChapter,
        preventCopy: chPreventCopy,
        preventScreenshot: chPreventScreenshot,
      };

      const currentWordCount = chContent.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
      let chaptersCopy = activeNovel.chapters ? [...activeNovel.chapters] : [];
      const duplicateChapterNumber = chaptersCopy.find((chapter) =>
        Number(chapter.chapterNumber) === Number(chNumber) &&
        Boolean(chapter.isAuxiliary) === isAuxiliaryChapter &&
        (!editingChapterId || chapter.id !== editingChapterId)
      );
      if (duplicateChapterNumber) return;

      let nextEditingChapterId = resolveChapterIdForSave(activeNovel, chNumber, editingChapterId);
      // A manga chapter cannot go public before it has pages (the server rejects
      // it), so autosave keeps a page-less manga chapter as a draft instead of
      // repeatedly failing. Publishing happens explicitly once pages exist.
      const requestedAutosaveStatus = isMangaNovel && Number(mangaPageCounts[nextEditingChapterId] || 0) < 1
        ? "Draft"
        : chStatus;
      const autosaveScheduledAt = requestedAutosaveStatus === "Scheduled" ? futureScheduleIso(chScheduledAt) : null;
      const autosaveStatus = requestedAutosaveStatus === "Scheduled" && !autosaveScheduledAt
        ? "Draft"
        : requestedAutosaveStatus;
      let chapterFound = false;
      
      chaptersCopy = chaptersCopy.map((ch) => {
          if (ch.id === nextEditingChapterId) {
            chapterFound = true;
            return {
              ...ch,
              title: chTitle.trim() || `${isAuxiliaryChapter ? "پیوست" : "فصل"} ${chNumber}`,
              content: isMangaNovel ? "" : chContent,
              wordCount: isMangaNovel ? 0 : currentWordCount,
              authorNotesTop: authNotesTop,
              authorNotesBottom: authNotesBottom,
              // Preserve the real publication status: autosaving "Draft" over a
              // live chapter would silently unpublish it.
              status: autosaveStatus,
              scheduledAt: autosaveStatus === "Scheduled" ? autosaveScheduledAt || ch.scheduledAt : ch.scheduledAt,
              isAuxiliary: isAuxiliaryChapter,
              preventCopy: chPreventCopy,
              preventScreenshot: chPreventScreenshot,
            };
          }
          return ch;
        });
      if (!chapterFound) {
        const nextCh: Chapter = {
          id: nextEditingChapterId,
          novelId: activeNovel.id,
          chapterNumber: chNumber,
          title: chTitle.trim() || `${isAuxiliaryChapter ? "پیوست" : "فصل"} ${chNumber}`,
          content: isMangaNovel ? "" : chContent,
          wordCount: isMangaNovel ? 0 : currentWordCount,
          createdAt: new Date().toISOString().split("T")[0],
          authorNotesTop: authNotesTop,
          authorNotesBottom: authNotesBottom,
          status: autosaveStatus,
          ...(autosaveStatus === "Scheduled" && autosaveScheduledAt ? { scheduledAt: autosaveScheduledAt } : {}),
          isAuxiliary: isAuxiliaryChapter,
          preventCopy: chPreventCopy,
          preventScreenshot: chPreventScreenshot,
        };
        chaptersCopy.push(nextCh);
      }
      if (editingChapterId !== nextEditingChapterId) setEditingChapterId(nextEditingChapterId);

      onUpdateNovelChapters(activeNovel.id, chaptersCopy);

      if (!token) return;
      setSaveState("saving");
      try {
        const autosaveRequest = api.saveChapter(token, activeNovel.id, {
          id: nextEditingChapterId,
          chapterNumber: chNumber,
          title: chTitle.trim() || `${isAuxiliaryChapter ? "پیوست" : "فصل"} ${chNumber}`,
          content: isMangaNovel ? "" : chContent,
          wordCount: isMangaNovel ? 0 : currentWordCount,
          authorNotesTop: authNotesTop,
          authorNotesBottom: authNotesBottom,
          status: autosaveStatus,
          ...(autosaveStatus === "Scheduled" && autosaveScheduledAt ? { scheduledAt: autosaveScheduledAt } : {}),
          isAuxiliary: isAuxiliaryChapter,
          preventCopy: chPreventCopy,
          preventScreenshot: chPreventScreenshot,
          reason: "autosave"
        });
        autosaveInFlightRef.current = autosaveRequest;
        const saved = await autosaveRequest;
        if (autosaveInFlightRef.current === autosaveRequest) autosaveInFlightRef.current = null;

        if (saved?.success && saved.chapter) {
          setEditingChapterId(saved.chapter.id);
          const mergedChapters = chaptersCopy.map((chapter) =>
            chapter.id === nextEditingChapterId ? { ...chapter, ...saved.chapter } : chapter
          );
          onUpdateNovelChapters(activeNovel.id, mergedChapters);
          setSaveState("saved");
          setLastSavedAt(new Date());
          setChError("");
        } else {
          // The server rejected the write; treat the local copy as unsaved so
          // the indicator and the navigation guard keep warning the author.
          setSaveState("failed");
          lastSavedRef.current = { title: "", content: "", top: "", bottom: "", isAuxiliary: isAuxiliaryChapter, preventCopy: chPreventCopy, preventScreenshot: chPreventScreenshot };
          setChError(saved?.error || "ذخیره خودکار انجام نشد. تغییرات شما فقط در این مرورگر است.");
        }
      } catch {
        setSaveState("failed");
        lastSavedRef.current = { title: "", content: "", top: "", bottom: "", isAuxiliary: isAuxiliaryChapter, preventCopy: chPreventCopy, preventScreenshot: chPreventScreenshot };
        setChError("ذخیره خودکار به سرور دسترسی نداشت. پیش‌نویس محلی شما همچنان اینجا قابل مشاهده است.");
      }
    }, 2000); // 2 seconds debounce

    return () => clearTimeout(timeoutId);
  }, [chContent, chTitle, authNotesTop, authNotesBottom, chStatus, chScheduledAt, chPreventCopy, chPreventScreenshot, activeNovel?.id, activeNovelChaptersHydrated, editingChapterId, token, chNumber, isAuxiliaryChapter, isMangaNovel, mangaPageCounts, onUpdateNovelChapters]);

  // Ctrl/Cmd+S saves immediately instead of letting the browser open its own
  // "save page" dialog, which is what writers expect from an editor.
  const publishChapterRef = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      if (activeWorkflow !== "worksheet" || workspaceTab !== "write") return;
      event.preventDefault();
      publishChapterRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeWorkflow, workspaceTab]);

  // Warn before losing unsaved work. The 2-second autosave debounce means a
  // fast tab close can still outrun the write.
  React.useEffect(() => {
    if (!hasUnsavedChanges && saveState !== "failed") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges, saveState]);

  // Post states
  const [newPostContent, setNewPostContent] = useState("");

  // Notification Config States
  const [notifyComments, setNotifyComments] = useState(true);
  const [notifyRatings, setNotifyRatings] = useState(true);
  const [notifyDefaults, setNotifyDefaults] = useState(true);
  const [notifyFollowers, setNotifyFollowers] = useState(true);
  const [notifyLikes, setNotifyLikes] = useState(true);
  const [notifyBookmarks, setNotifyBookmarks] = useState(true);
  const [notifyReplies, setNotifyReplies] = useState(true);
  const [notifyLogins, setNotifyLogins] = useState(true);
  
  // Analytics State

  const [newPostTitle, setNewPostTitle] = useState("");
  const [postType, setPostType] = useState<"novel" | "general">("novel");
  const [authorPosts, setAuthorPosts] = useState<any[]>([]);

  // Analytics Comments State
  const [analyticsComments, setAnalyticsComments] = useState<any[]>([]);
  const [analyticsSummary, setAnalyticsSummary] = useState<any>({ totals: {}, chapterDropoff: [] });
  const [commentReplyDrafts, setCommentReplyDrafts] = useState<Record<string, string>>({});
  const [novelAnalytics, setNovelAnalytics] = useState<any>(null);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);

  // Per-novel comment hub (all comments of one novel in one place)
  const [novelComments, setNovelComments] = useState<any[]>([]);
  const [novelCommentsLoading, setNovelCommentsLoading] = useState(false);
  const [novelCommentsFilter, setNovelCommentsFilter] = useState<"all" | "review" | "chapter_comment">("all");
  const [novelCommentsSearch, setNovelCommentsSearch] = useState("");
  const [novelCommentsChapter, setNovelCommentsChapter] = useState<string>("all");

  // Character codex reference sheets
  const [characters, setCharacters] = useState<{ id: string; name: string; role: string; bio: string; imageUrl?: string }[]>([]);

  const [newCharName, setNewCharName] = useState("");
  const [newCharRole, setNewCharRole] = useState("");
  const [newCharBio, setNewCharBio] = useState("");
  const [newCharImageUrl, setNewCharImageUrl] = useState("");
  const [isCharacterCropOpen, setIsCharacterCropOpen] = useState(false);
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [isSavingCharacter, setIsSavingCharacter] = useState(false);
  const [characterError, setCharacterError] = useState("");

  const resetCharacterForm = () => {
    setEditingCharacterId(null);
    setNewCharName("");
    setNewCharRole("");
    setNewCharBio("");
    setNewCharImageUrl("");
    setCharacterError("");
  };

  const [editorMessages, setEditorMessages] = useState<any[]>([]);
  const [editorMsgDraft, setEditorMsgDraft] = useState("");
  const [chapterVersions, setChapterVersions] = useState<any[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [versionStatus, setVersionStatus] = useState("");
  const notificationPrefsLoadedRef = useRef(false);

  React.useEffect(() => {
    if (activeNovel && workspaceTab === "editor-chat" && token) {
      api.authorGetEditorMessages(token, activeNovel.id).then(setEditorMessages);
    }
  }, [activeNovel?.id, workspaceTab, token]);

  const handleSendEditorMessage = async () => {
    if (!editorMsgDraft.trim() || !activeNovel || !token) return;
    const success = await api.authorSendEditorMessage(token, activeNovel.id, editorMsgDraft);
    if (success) {
      setEditorMsgDraft("");
      api.authorGetEditorMessages(token, activeNovel.id).then(setEditorMessages);
    }
  };

  React.useEffect(() => {
    if (activeNovel && activeNovel.characters) {
      setCharacters(activeNovel.characters);
    } else {
      setCharacters([]);
    }
    setEditingCharacterId(null);
    setNewCharName("");
    setNewCharRole("");
    setNewCharBio("");
    setNewCharImageUrl("");
    setCharacterError("");
  }, [activeNovel?.id]);

  React.useEffect(() => {
    if (workspaceTab === "posts" && token) {
      api.getAuthorPosts(token, activeNovel?.id).then(setAuthorPosts);
    }
  }, [workspaceTab, activeNovel, token]);

  const [performanceData, setPerformanceData] = useState<any[]>([]);

  React.useEffect(() => {
    if (token) {
       // Load notification preferences
        notificationPrefsLoadedRef.current = false;
        api.getNotificationPrefs(token).then(prefs => {
          if (prefs) {
             setNotifyComments(prefs.notify_comments ?? true);
             setNotifyRatings(prefs.notify_ratings ?? true);
             setNotifyDefaults(prefs.notify_defaults ?? true);
             setNotifyFollowers(prefs.notify_followers ?? true);
             setNotifyLikes(prefs.notify_likes ?? true);
             setNotifyBookmarks(prefs.notify_bookmarks ?? true);
             setNotifyReplies(prefs.notify_replies ?? true);
             setNotifyLogins(prefs.notify_logins ?? true);
          }
          window.setTimeout(() => {
            notificationPrefsLoadedRef.current = true;
          }, 0);
        });

       // Load performance stats
       api.getAuthorStats(token).then((stats) => {
         setPerformanceData(stats.performance || []);
         setAnalyticsSummary(stats);
       });
    }
  }, [token]);

  // Update notification prefs when they change
  React.useEffect(() => {
    if (token && notificationPrefsLoadedRef.current) {
       const timeoutId = window.setTimeout(() => {
        api.updateNotificationPrefs(token, {
           notify_comments: notifyComments,
           notify_ratings: notifyRatings,
           notify_defaults: notifyDefaults,
           notify_followers: notifyFollowers,
           notify_likes: notifyLikes,
           notify_bookmarks: notifyBookmarks,
           notify_replies: notifyReplies,
           notify_logins: notifyLogins
        });
       }, 500);
       return () => window.clearTimeout(timeoutId);
    }
  }, [notifyComments, notifyRatings, notifyDefaults, notifyFollowers, notifyLikes, notifyBookmarks, notifyReplies, notifyLogins, token]);

  React.useEffect(() => {
    if (workspaceTab === "analytics" && token && activeNovel) {
       setIsAnalyticsLoading(true);
       // Fetch real analytics comments
       fetch('/api/analytics/comments', {
          headers: {
            'X-CSRF-Token': token
          },
          credentials: "same-origin"
       }).then(res => res.json()).then(data => {
          if (data.comments) setAnalyticsComments(data.comments);
       });
       api.getNovelAnalytics(token, activeNovel.id).then((stats) => {
         setNovelAnalytics(stats);
         setAnalyticsSummary(stats || { totals: {}, chapterDropoff: [] });
         setPerformanceData((stats?.daily || []).map((day: any) => ({
           name: new Date(day.date).toLocaleDateString("fa-IR", { weekday: "short" }),
           views: day.views || 0,
           engagements: day.engagements || 0
         })));
       }).finally(() => setIsAnalyticsLoading(false));
    }
  }, [workspaceTab, token, activeNovel?.id]);

  const refreshAnalyticsComments = async () => {
    if (!token) return;
    const res = await fetch('/api/analytics/comments', {
      headers: { 'X-CSRF-Token': token },
      credentials: "same-origin"
    });
    const data = await res.json();
    setAnalyticsComments(data.comments || []);
  };

  const loadNovelComments = React.useCallback(async () => {
    if (!token || !activeNovel) return;
    setNovelCommentsLoading(true);
    try {
      const res = await fetch(`/api/analytics/comments?novelId=${encodeURIComponent(activeNovel.id)}`, {
        headers: { 'X-CSRF-Token': token },
        credentials: "same-origin"
      });
      const data = await res.json();
      setNovelComments(data.comments || []);
    } catch {
      setNovelComments([]);
    } finally {
      setNovelCommentsLoading(false);
    }
  }, [token, activeNovel?.id]);

  React.useEffect(() => {
    if (workspaceTab === "comments" && activeNovel) {
      loadNovelComments();
    }
  }, [workspaceTab, activeNovel?.id, loadNovelComments]);

  const deleteAnalyticsComment = async (comment: any) => {
    if (!token) return;
    const type = comment.targetType || comment.type || "review";
    const id = comment.targetId || comment.id;
    if (!id || !window.confirm("این دیدگاه خواننده برای همیشه حذف شود؟")) return;
    const ok = await api.deleteAnalyticsComment(token, type, id);
    if (ok) {
      await refreshAnalyticsComments();
      await loadNovelComments();
    }
  };

  const replyAnalyticsComment = async (comment: any) => {
    if (!token) return;
    const type = comment.targetType || comment.type || "review";
    const id = comment.targetId || comment.id;
    const key = `${type}:${id}`;
    const content = (commentReplyDrafts[key] || "").trim();
    if (!content) return;
    const ok = await api.replyAnalyticsComment(token, type, id, content);
    if (ok) {
      setCommentReplyDrafts((drafts) => ({ ...drafts, [key]: "" }));
      await refreshAnalyticsComments();
      await loadNovelComments();
    }
  };

  const handlePostSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPostTitle.trim() || !newPostContent.trim() || !token) return;
    
    // Create payload
    const payload = {
      title: newPostTitle,
      content: newPostContent,
      novel_id: postType === "novel" ? activeNovel?.id : undefined // optional linking
    };
    
    const res = await api.createAuthorPost(token, payload);
    if (res.success) {
      setNewPostTitle("");
      setNewPostContent("");
      api.getAuthorPosts(token, activeNovel?.id).then(setAuthorPosts);
    } else {
      alert("ارسال پست ناموفق بود.");
    }
  };

  // Handle Cover Art File Conversion
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, isEdit: boolean = false) => {
    const file = e.target.files?.[0];
    processImageFile(file, isEdit);
  };

  const processImageFile = (file: File | undefined, isEdit: boolean) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("لطفاً یک فایل تصویر معتبر انتخاب کنید.");
      return;
    }

    setUploadProgress(10);
    const reader = new FileReader();
    
    reader.onprogress = (data) => {
      if (data.lengthComputable) {
        const percent = Math.round((data.loaded / data.total) * 100);
        setUploadProgress(percent);
      }
    };

    reader.onloadend = () => {
      const base64String = reader.result as string;
      if (isEdit) {
        setEditBookCover(base64String);
      } else {
        setBookCover(base64String);
      }
      setUploadProgress(null);
    };

    reader.onerror = () => {
      alert("خطا در پردازش فایل تصویر.");
      setUploadProgress(null);
    };

    reader.readAsDataURL(file);
  };

  // Drag and Drop Cover Functions
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent, isEdit: boolean = false) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    processImageFile(file, isEdit);
  };

  // Create novel sequence
  const handleCreateNovel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPublishingBook) return;
    if (!bookTitle.trim()) {
      setBookError("عنوان رمان الزامی است.");
      return;
    }
    if (!bookAuthor.trim()) {
      setBookError("نام مستعار نویسنده الزامی است.");
      return;
    }
    if (!bookGenre || normalizeMainGenre(bookGenre) !== bookGenre) {
      setBookError("لطفاً یک ژانر اصلی معتبر انتخاب کنید.");
      return;
    }
    if (novelMainCategories.length < 1 || novelMainCategories.length > 4) {
      setBookError("باید بین 1 تا 4 دسته اصلی انتخاب کنید.");
      return;
    }
    if (novelSubCategories.length < 1 || novelSubCategories.length > 25) {
      setBookError("باید بین 1 تا 25 زیردسته انتخاب کنید.");
      return;
    }
    if (bookDesc.trim().length < 15) {
      setBookError("لطفاً خلاصه‌ای جذاب (حداقل 15 نویسه) بنویسید تا خوانندگان را مجذوب کنید.");
      return;
    }
    // A manga's first chapter is a page list, and pages can only be uploaded once
    // the chapter row exists. The work therefore starts with an empty draft
    // chapter that the page editor fills in the workspace.
    const isCreatingManga = novelContentKind === "manga";
    if (!isCreatingManga && firstChapterStatus === "Scheduled") {
      if (!futureScheduleIso(firstChapterScheduledAt)) {
        setBookError("زمان‌بندی فصل آغازین: تاریخ و زمان معتبری در آینده انتخاب کنید.");
        return;
      }
    }
    const cleanedTranslators = novelTranslators.split(/[,،]/).map((t) => t.trim()).filter(Boolean);
    if (novelOriginType === "translated" && !novelOriginalAuthor.trim()) {
      setBookError("برای رمان ترجمه‌شده، نام نویسندهٔ اثر اصلی الزامی است.");
      return;
    }
    if (novelOriginType === "translated" && cleanedTranslators.length === 0) {
      setBookError("برای رمان ترجمه‌شده، حداقل یک مترجم وارد کنید (با ویرگول جدا کنید).");
      return;
    }

    setIsPublishingBook(true);
    setBookError("");

    const newNovelId = makeNovelId(currentUser?.id);
    const plainText = firstChapterContent.replace(/<[^>]*>/g, " ");
    const cleanWordCount = plainText.split(/\s+/).filter(Boolean).length;
    const selectedCover = bookCover || DEFAULT_COVERS[Math.floor(Math.random() * DEFAULT_COVERS.length)];

    const firstChapter: Chapter = isCreatingManga
      ? {
        id: makeChapterId(newNovelId, 1),
        novelId: newNovelId,
        chapterNumber: 1,
        title: firstChapterTitle.trim() || "فصل ۱",
        content: "",
        wordCount: 0,
        createdAt: new Date().toISOString().split("T")[0],
        // Draft until pages exist: publishing an empty manga chapter would show
        // readers a blank viewer, and the server rejects it as well.
        status: "Draft",
      }
      : {
        id: makeChapterId(newNovelId, 1),
        novelId: newNovelId,
        chapterNumber: 1,
        title: firstChapterTitle.trim() || DEFAULT_FIRST_CHAPTER_TITLE,
        content: firstChapterContent,
        wordCount: cleanWordCount || 150,
        createdAt: new Date().toISOString().split("T")[0],
        status: firstChapterStatus,
        scheduledAt: firstChapterStatus === "Scheduled" ? futureScheduleIso(firstChapterScheduledAt) || undefined : undefined,
      };

    const newNovel: Novel = {
      id: newNovelId,
      title: bookTitle,
      author: bookAuthor,
      author_id: currentUser?.id,
      genre: bookGenre,
      cover: selectedCover,
      coverUrl: selectedCover,
      description: bookDesc,
      rating: 0,
      viewsCount: 0,
      bookmarksCount: 0,
      createdAt: new Date().toISOString().split("T")[0],
      chapters: [firstChapter],
      reviews: [],
      isUserCreated: true,
      tags: filterTaxonomyList(novelTags.split(",").map((t) => t.trim()).filter(Boolean)),
      warnings: filterTaxonomyList(novelWarnings),
      mainCategories: filterTaxonomyList(novelMainCategories),
      subCategories: filterTaxonomyList(novelSubCategories),
      status: "Ongoing",
      ageRating: novelAgeRating,
      originType: novelOriginType,
      originalAuthor: novelOriginType === "translated" ? novelOriginalAuthor.trim() : "",
      translators: novelOriginType === "translated" ? cleanedTranslators : [],
      contentKind: novelContentKind,
      readingDirection: novelContentKind === "manga" ? novelReadingDirection : "rtl",
    };

    try {
      await onAddNewNovel(newNovel);
      setSelectedNovelId(newNovel.id);
      setActiveWorkflow("worksheet");
      setBookTitle("");
      setBookAuthor("");
      setBookGenre("");
      setBookDesc("");
      setBookCover("");
      setNovelTags("");
      setNovelWarnings([]);
      setNovelMainCategories([]);
      setNovelSubCategories([]);
      setNovelAgeRating("PG-13");
      setNovelOriginType("original");
      setNovelOriginalAuthor("");
      setNovelTranslators("");
      setNovelContentKind("novel");
      setNovelReadingDirection("rtl");
      setFirstChapterTitle(DEFAULT_FIRST_CHAPTER_TITLE);
      setFirstChapterContent(DEFAULT_FIRST_CHAPTER_CONTENT);
      setFirstChapterStatus("Published");
      setFirstChapterScheduledAt("");
      try {
        localStorage.removeItem(draftStorageKey);
      } catch {}

      setEditingChapterId(null);
      setChTitle("");
      setChContent("");
      setChNumber(2);
    } catch (err: any) {
      console.error("Failed to create novel:", err);
      setBookError(err?.message || "در حال حاضر امکان انتشار این رمان وجود ندارد. لطفاً دوباره تلاش کنید.");
    } finally {
      setIsPublishingBook(false);
    }
  };

  // Launch workspace for existing novel
  const handleLaunchWorkspace = (novelId: string) => {
    setSelectedNovelId(novelId);
    setActiveWorkflow("worksheet");
    
    const targetNovel = novels.find(n => n.id === novelId);
    if (targetNovel) {
      setEditBookTitle(targetNovel.title);
      setEditBookAuthor(targetNovel.author);
      setEditBookGenre(targetNovel.genre);
      setEditBookDesc(targetNovel.description || "");
      setEditBookCover(targetNovel.cover || targetNovel.coverUrl || "");
      setEditBookTags(targetNovel.tags ? filterTaxonomyList(targetNovel.tags).join(", ") : "");
      const loadedWarnings = normalizeContentWarnings(filterTaxonomyList(targetNovel.warnings || []), CONTENT_WARNINGS);
      setEditBookWarnings([...loadedWarnings.values, ...loadedWarnings.invalid]);
      setEditPremiumPresentation(sanitizePremiumPresentation(targetNovel.premiumPresentation));    setEditOriginType(targetNovel.originType === "translated" ? "translated" : "original");
    setEditOriginalAuthor(targetNovel.originalAuthor || "");
      setEditTranslators(Array.isArray(targetNovel.translators) ? targetNovel.translators.join(", ") : "");
      setEditReadingDirection(normalizeReadingDirection((targetNovel as any).readingDirection));
      setEditPreventCopy(targetNovel.preventCopy === true);
      setEditPreventScreenshot(targetNovel.preventScreenshot === true);
    }

    if (targetNovel && targetNovel.chapters && targetNovel.chapters.length > 0) {
      const sorted = [...targetNovel.chapters].filter((chapter) => !chapter.isAuxiliary).sort((a,b) => b.chapterNumber - a.chapterNumber);
      const nextNum = sorted[0].chapterNumber + 1;
      setEditingChapterId(null);
      setIsAuxiliaryChapter(false);
      setChNumber(nextNum);
      setChTitle("");
      setChContent("");
    } else {
      setEditingChapterId(null);
      setIsAuxiliaryChapter(false);
      setChNumber(1);
      setChTitle("");
      setChContent("");
    }
  };

  const handleBackToNovelList = () => {
    setActiveWorkflow("choose");
    setSelectedNovelId("");
    setIsCreatingBook(false);
    setWorkspaceTab("write");
    setEditingChapterId(null);
    setChError("");
  };

  const handleEditChapter = (chapter: Chapter) => {
    setEditingChapterId(chapter.id);
    setChNumber(chapter.chapterNumber);
    setIsAuxiliaryChapter(chapter.isAuxiliary === true);
    setChTitle(chapter.title);
    setChContent(chapter.content);
    setAuthNotesTop(chapter.authorNotesTop || "");
    setAuthNotesBottom(chapter.authorNotesBottom || "");
    setChStatus(chapter.status || "Published");
    setChScheduledAt(toDateTimeLocalInput(chapter.scheduledAt));
    setChPreventCopy(chapter.preventCopy === true);
    setChPreventScreenshot(chapter.preventScreenshot === true);
    setWorkspaceTab("write");

    lastSavedRef.current = {
      title: chapter.title,
      content: chapter.content,
      top: chapter.authorNotesTop || "",
      bottom: chapter.authorNotesBottom || "",
      isAuxiliary: chapter.isAuxiliary === true,
      preventCopy: chapter.preventCopy === true,
      preventScreenshot: chapter.preventScreenshot === true,
    };
    loadChapterVersions(chapter.id);
  };

  const loadChapterVersions = async (chapterId = editingChapterId || "") => {
    if (!token || !activeNovel || !chapterId) return;
    setIsLoadingVersions(true);
    const versions = await api.getChapterVersions(token, activeNovel.id, chapterId);
    setChapterVersions(versions || []);
    setIsLoadingVersions(false);
  };

  const handleRestoreVersion = async (version: any) => {
    if (!token || !activeNovel || !editingChapterId) return;
    const ok = await api.restoreChapterVersion(token, activeNovel.id, editingChapterId, version.id);
    if (!ok) {
      setVersionStatus("بازگردانی ناموفق بود.");
      return;
    }
    const restored: Chapter = {
      id: editingChapterId,
      novelId: activeNovel.id,
      title: version.title,
      content: version.content || "",
      chapterNumber: version.chapter_number || chNumber,
      createdAt: new Date().toISOString(),
      wordCount: version.word_count || 0,
      authorNotesTop: version.author_notes_top || "",
      authorNotesBottom: version.author_notes_bottom || "",
      status: version.status || "Draft",
      scheduledAt: version.scheduled_at || undefined
    };
    const nextChapters = (activeNovel.chapters || []).map((chapter) => chapter.id === editingChapterId ? restored : chapter);
    onUpdateNovelChapters(activeNovel.id, nextChapters);
    setChTitle(restored.title);
    setChContent(restored.content);
    setChNumber(restored.chapterNumber);
    setAuthNotesTop(restored.authorNotesTop || "");
    setAuthNotesBottom(restored.authorNotesBottom || "");
    setChStatus(restored.status || "Draft");
    setChScheduledAt(restored.scheduledAt || "");
    setVersionStatus("نسخه بازگردانی شد.");
    loadChapterVersions(editingChapterId);
  };

  const handleDeleteVersion = async (versionId: string) => {
    if (!token || !activeNovel || !editingChapterId) return;
    const ok = await api.deleteChapterVersion(token, activeNovel.id, editingChapterId, versionId);
    if (!ok) {
      setVersionStatus("نسخه حذف نشد.");
      return;
    }
    setChapterVersions((versions) => versions.filter((version) => version.id !== versionId));
    setVersionStatus("نسخه حذف شد.");
  };

  // Save/Publish Chapter
  const handlePublishChapter = async () => {
    if (!activeNovel) return;
    if (isSavingChapter) return;

    const plainContent = chContent.replace(/<[^>]*>/g, " ").trim();
    const isDraft = chStatus === "Draft";

    if (isDraft && !chTitle.trim() && !plainContent && !isMangaNovel) {
      setChError("پیش از ذخیره پیش‌نویس، عنوان یا محتوایی برای فصل اضافه کنید.");
      return;
    }
    if (isMangaNovel && isDraft && !chTitle.trim()) {
      setChError("برای ساخت فصل مانگا، عنوان فصل را وارد کنید.");
      return;
    }
    if (!isDraft && !chTitle.trim()) {
      setChError("هر فصل پیش از انتشار به عنوان نیاز دارد.");
      return;
    }
    // A manga chapter's body is its page list, so the prose minimum is replaced
    // by a page requirement. The server enforces the same rule.
    if (!isDraft && isMangaNovel && mangaPageCount < 1) {
      setChError("برای انتشار یک فصل مانگا، حداقل یک صفحه بارگذاری کنید.");
      return;
    }
    if (!isDraft && !isMangaNovel && plainContent.length < 20) {
      setChError("داستان گران‌بهاست! لطفاً روایتی غنی (حداقل 20 نویسه) بنویسید.");
      return;
    }
    const scheduledAtIso = chStatus === "Scheduled" ? futureScheduleIso(chScheduledAt) : null;
    if (chStatus === "Scheduled" && !scheduledAtIso) {
      setChError("لطفاً تاریخ و زمان معتبری در آینده، به وقت دستگاه خود، انتخاب کنید.");
      return;
    }
    if (!token) {
      setChError("لطفاً پیش از ذخیره این فصل دوباره وارد شوید.");
      return;
    }
    const duplicateChapterNumber = (activeNovel.chapters || []).find((chapter) =>
      Number(chapter.chapterNumber) === Number(chNumber) &&
      Boolean(chapter.isAuxiliary) === isAuxiliaryChapter &&
      (!editingChapterId || chapter.id !== editingChapterId)
    );
    if (duplicateChapterNumber) {
      setChError(`${isAuxiliaryChapter ? "پیوست" : "فصل"} ${chNumber} از قبل در این رمان وجود دارد. آن را از فهرست باز کنید و روی همان کار کنید، به جای بازنویسی.`);
      return;
    }

    setIsSavingChapter(true);
    setSaveState("saving");
    setChError("");

    const currentWordCount = plainContent.split(/\s+/).filter(Boolean).length;
    const chapterId = resolveChapterIdForSave(activeNovel, chNumber, editingChapterId);
    const nextChapter: Chapter = {
      id: chapterId,
      novelId: activeNovel.id,
      chapterNumber: chNumber,
      isAuxiliary: isAuxiliaryChapter,
      title: chTitle.trim() || `${isAuxiliaryChapter ? "پیوست" : "فصل"} ${chNumber}`,
      // Manga chapters have no prose body; their pages are stored separately.
      content: isMangaNovel ? "" : chContent,
      wordCount: isMangaNovel ? 0 : currentWordCount,
      createdAt: new Date().toISOString().split("T")[0],
      authorNotesTop: authNotesTop,
      authorNotesBottom: authNotesBottom,
      status: chStatus,
      scheduledAt: scheduledAtIso || undefined,
      preventCopy: chPreventCopy,
      preventScreenshot: chPreventScreenshot,
    };

    try {
      // A draft autosave may already be in flight when the author clicks
      // Publish. Let it finish first so the explicit publication is always
      // the final database write.
      if (autosaveInFlightRef.current) await autosaveInFlightRef.current.catch(() => null);
      const saved = await api.saveChapter(token, activeNovel.id, {
        ...nextChapter,
        reason: isDraft ? "draft-save" : "chapter-save"
      });

      if (!saved?.success) {
        setSaveState("failed");
        setChError(saved?.error || "فصل ذخیره نشد. لطفاً دوباره تلاش کنید.");
        return;
      }

      const savedChapter: Chapter = saved.chapter
        ? {
            ...nextChapter,
            ...saved.chapter,
            id: saved.chapter.id || nextChapter.id,
            novelId: saved.chapter.novelId || activeNovel.id,
            chapterNumber: saved.chapter.chapterNumber || nextChapter.chapterNumber,
            createdAt: saved.chapter.createdAt || nextChapter.createdAt,
            wordCount: saved.chapter.wordCount ?? nextChapter.wordCount,
            status: saved.chapter.status || nextChapter.status,
            scheduledAt: saved.chapter.scheduledAt || nextChapter.scheduledAt
          }
        : nextChapter;

      let chapterFound = false;
      let chaptersCopy = activeNovel.chapters ? [...activeNovel.chapters] : [];
      chaptersCopy = chaptersCopy.map((ch) => {
        if (ch.id === chapterId || ch.id === savedChapter.id || (Number(ch.chapterNumber) === Number(savedChapter.chapterNumber) && Boolean(ch.isAuxiliary) === Boolean(savedChapter.isAuxiliary))) {
          chapterFound = true;
          return {
            ...ch,
            ...savedChapter
          };
        }
        return ch;
      });

      if (!chapterFound) chaptersCopy.push(savedChapter);

      lastSavedRef.current = {
        title: chTitle,
        content: chContent,
        top: authNotesTop,
        bottom: authNotesBottom,
        isAuxiliary: isAuxiliaryChapter,
        preventCopy: chPreventCopy,
        preventScreenshot: chPreventScreenshot,
      };

      onUpdateNovelChapters(activeNovel.id, chaptersCopy);
      setIsSavedNotify(true);
      setSaveState("saved");
      setLastSavedAt(new Date());
      setTimeout(() => setIsSavedNotify(false), 3500);

      // A manga chapter stays open after saving: its pages are edited in place,
      // and clearing the form would detach the page editor from the chapter that
      // was just created.
      if (isMangaNovel) {
        setEditingChapterId(savedChapter.id);
        setChNumber(savedChapter.chapterNumber || chNumber);
        setChTitle(savedChapter.title || chTitle);
        setChStatus((savedChapter.status as any) || chStatus);
        return;
      }

      const nextNumber = Math.max(...chaptersCopy.filter(c => Boolean(c.isAuxiliary) === isAuxiliaryChapter).map(c => c.chapterNumber), 0) + 1;
      setEditingChapterId(null);
      setChNumber(nextNumber);
      setChTitle("");
      setChContent("");
      setAuthNotesTop("");
      setAuthNotesBottom("");
      setChStatus("Published");
      setChScheduledAt("");
      setChPreventCopy(false);
      setChPreventScreenshot(false);
    } catch {
      setSaveState("failed");
      setChError("فصل ذخیره نشد چون سرور در دسترس نبود.");
    } finally {
      setIsSavingChapter(false);
    }
  };

  publishChapterRef.current = () => { void handlePublishChapter(); };

  /**
   * Make sure the manga chapter being edited exists, and return its id.
   *
   * Page rows reference a chapter, so the first upload into a brand-new chapter
   * has to create it. The chapter is created as a draft: it becomes publishable
   * only once it has pages, which is exactly what the page editor is about to
   * add.
   */
  const ensureMangaChapter = React.useCallback(async (): Promise<string | null> => {
    if (!activeNovel) return null;
    if (editingChapterId) return editingChapterId;
    if (!token) {
      setChError("برای ساخت فصل مانگا دوباره وارد شوید.");
      return null;
    }

    const title = chTitle.trim() || `فصل ${chNumber}`;
    const duplicate = (activeNovel.chapters || []).find((chapter) =>
      Number(chapter.chapterNumber) === Number(chNumber) && Boolean(chapter.isAuxiliary) === isAuxiliaryChapter
    );
    if (duplicate) {
      // Reuse the existing chapter rather than failing on the unique index.
      setEditingChapterId(duplicate.id);
      return duplicate.id;
    }

    const chapterId = resolveChapterIdForSave(activeNovel, chNumber, null);
    const saved = await api.saveChapter(token, activeNovel.id, {
      id: chapterId,
      chapterNumber: chNumber,
      title,
      content: "",
      wordCount: 0,
      authorNotesTop: authNotesTop,
      authorNotesBottom: authNotesBottom,
      isAuxiliary: isAuxiliaryChapter,
      preventCopy: chPreventCopy,
      preventScreenshot: chPreventScreenshot,
      // Deliberately a draft: a manga chapter has no pages yet, and the server
      // refuses to publish an empty one. Autosave never forces this status —
      // see `autosaveStatus`, which preserves the chapter's real state.
      status: "Draft",
      reason: "manga-chapter-create",
    });

    if (!saved?.success || !saved.chapter?.id) {
      setChError(saved?.error || "ساخت فصل مانگا انجام نشد.");
      return null;
    }

    const created: Chapter = {
      id: saved.chapter.id,
      novelId: activeNovel.id,
      chapterNumber: saved.chapter.chapterNumber || chNumber,
      isAuxiliary: isAuxiliaryChapter,
      title: saved.chapter.title || title,
      content: "",
      wordCount: 0,
      createdAt: saved.chapter.createdAt || new Date().toISOString().split("T")[0],
      status: (saved.chapter.status as any) || "Draft",
      pageCount: 0,
      preventCopy: chPreventCopy,
      preventScreenshot: chPreventScreenshot,
    };
    onUpdateNovelChapters(activeNovel.id, [...(activeNovel.chapters || []), created]);
    setEditingChapterId(created.id);
    setChTitle(created.title);
    setChStatus("Draft");
    setChError("");
    lastSavedRef.current = {
      title: created.title,
      content: "",
      top: authNotesTop,
      bottom: authNotesBottom,
      isAuxiliary: isAuxiliaryChapter,
      preventCopy: chPreventCopy,
      preventScreenshot: chPreventScreenshot,
    };
    return created.id;
  }, [activeNovel, authNotesBottom, authNotesTop, chNumber, chTitle, chPreventCopy, chPreventScreenshot, editingChapterId, isAuxiliaryChapter, onUpdateNovelChapters, token]);

  const handleCreateNewChapterReset = (auxiliary = false) => {
    if (!activeNovel) return;
    const sorted = [...(activeNovel.chapters || [])].filter((chapter) => Boolean(chapter.isAuxiliary) === auxiliary).sort((a,b) => b.chapterNumber - a.chapterNumber);
    const nextNum = sorted.length > 0 ? sorted[0].chapterNumber + 1 : 1;
    
    setEditingChapterId(null);
    setIsAuxiliaryChapter(auxiliary);
    setChNumber(nextNum);
    setChTitle("");
    setChContent("");
    setAuthNotesTop("");
    setAuthNotesBottom("");
    setChStatus("Published");
    setChScheduledAt("");
    setChPreventCopy(false);
    setChPreventScreenshot(false);
    setChError("");
    setChapterVersions([]);
    setVersionStatus("");
  };

  const handleDeleteChapter = async (chId: string) => {
    if (!window.confirm("از حذف دائمی این پیش‌نویس فصل مطمئن هستید؟ این عمل قابل بازگشت نیست.")) return;
    if (!activeNovel) return;
    if (token) {
      const ok = await api.deleteChapter(token, activeNovel.id, chId);
      if (!ok) {
        setChError("حذف فصل از سرور انجام نشد. لطفاً دوباره تلاش کنید.");
        return;
      }
    }
    const deletedChapter = (activeNovel.chapters || []).find(c => c.id === chId);
    const filtered = (activeNovel.chapters || []).filter(c => c.id !== chId);
    onUpdateNovelChapters(activeNovel.id, filtered);
    if (editingChapterId === chId) {
      handleCreateNewChapterReset(deletedChapter?.isAuxiliary === true);
    }
  };

  const saveStoryProtection = async () => {
    if (!activeNovel || !onUpdateNovel || protectionSavingId) return;
    setProtectionSavingId("story");
    setProtectionMessage("");
    try {
      await onUpdateNovel({ ...activeNovel, preventCopy: editPreventCopy, preventScreenshot: editPreventScreenshot });
      setProtectionMessage("تنظیمات محافظت کل داستان ذخیره شد.");
    } catch (error: any) {
      setProtectionMessage(error?.message || "ذخیره تنظیمات محافظت داستان انجام نشد.");
    } finally {
      setProtectionSavingId("");
    }
  };

  const saveChapterProtection = async (chapter: Chapter, changes: Pick<Chapter, "preventCopy" | "preventScreenshot">) => {
    if (!activeNovel || !token || protectionSavingId) return;
    setProtectionSavingId(chapter.id);
    setProtectionMessage("");
    const updated = { ...chapter, ...changes };
    try {
      const result = await api.saveChapter(token, activeNovel.id, { ...updated, reason: "content-protection" });
      if (!result?.success) throw new Error(result?.error || "ذخیره قفل فصل انجام نشد.");
      const savedChapter = { ...updated, ...(result.chapter || {}) } as Chapter;
      onUpdateNovelChapters(activeNovel.id, (activeNovel.chapters || []).map((item) => item.id === chapter.id ? savedChapter : item));
      if (editingChapterId === chapter.id) {
        setChPreventCopy(savedChapter.preventCopy === true);
        setChPreventScreenshot(savedChapter.preventScreenshot === true);
      }
      setProtectionMessage(`تنظیمات «${chapter.title}» ذخیره شد.`);
    } catch (error: any) {
      setProtectionMessage(error?.message || "ذخیره تنظیمات محافظت فصل انجام نشد.");
    } finally {
      setProtectionSavingId("");
    }
  };

  const handleDeleteActiveNovel = async () => {
    if (!activeNovel || !onDeleteNovel || isDeletingNovel) return;
    if (!window.confirm(`«${activeNovel.title}» و همه فصل‌ها، پیش‌نویس‌ها، دیدگاه‌ها، ذخیره‌ها و داده‌های پیشنهادی آن برای همیشه حذف شود؟ این عمل قابل بازگشت نیست.`)) return;

    setIsDeletingNovel(true);
    setBookError("");
    try {
      await onDeleteNovel(activeNovel.id);
      setSelectedNovelId("");
      setActiveWorkflow("choose");
      setWorkspaceTab("write");
      setEditingChapterId(null);
      setChNumber(1);
      setChTitle("");
      setChContent("");
      setAuthNotesTop("");
      setAuthNotesBottom("");
      setChError("");
      setChapterVersions([]);
      setVersionStatus("");
    } catch (error: any) {
      const message = error?.message || "حذف رمان انجام نشد. لطفاً دوباره تلاش کنید.";
      setBookError(message);
      window.alert(message);
    } finally {
      setIsDeletingNovel(false);
    }
  };

  // --- RECHARTS DYNAMIC PIPELINES ---
  // Funnel chart dropoff data
  const getFunnelData = () => {
    if (novelAnalytics?.chapterRetention?.length) {
      return novelAnalytics.chapterRetention.map((ch: any) => ({
        name: `Ch ${ch.chapterNumber}`,
        Pageviews: ch.views || 0,
        Retention: ch.retentionPercent || 0
      }));
    }
    if (!activeNovel || !activeNovel.chapters || activeNovel.chapters.length === 0) {
      return [];
    }
    return [...activeNovel.chapters]
      .sort((a,b) => a.chapterNumber - b.chapterNumber)
      .slice(0, 6)
      .map((ch) => {
        return {
          name: `فصل ${ch.chapterNumber}`,
          Pageviews: ch.viewsCount || 0,
        };
      });
  };

  // Words timeline data
  const getWordsData = () => {
    if (!activeNovel || !activeNovel.chapters || activeNovel.chapters.length === 0) {
      return [];
    }
    return [...activeNovel.chapters]
      .sort((a,b) => a.chapterNumber - b.chapterNumber)
      .slice(0, 8)
      .map((ch) => ({
        name: `فصل ${ch.chapterNumber}`,
        Words: ch.wordCount || 500,
      }));
  };

  // Weekly reach (Traffic simulations)
  const getTrafficData = () => {
    if (novelAnalytics?.daily?.length) {
      return novelAnalytics.daily.map((d: any) => ({
        day: new Date(d.date).toLocaleDateString("fa-IR", { month: "short", day: "numeric" }),
        Readers: d.views || 0,
        Engagements: d.engagements || 0
      }));
    }
    if (performanceData && performanceData.length > 0) {
      return performanceData.map(d => ({
         day: d.name,
         Readers: d.views, // actual views
         Engagements: d.engagements // actual engagements
      }));
    }
    
    // Fallback if no real data retrieved yet
    return [
      { day: "دوشنبه", Readers: 0, Engagements: 0 },
      { day: "سه‌شنبه", Readers: 0, Engagements: 0 },
      { day: "چهارشنبه", Readers: 0, Engagements: 0 },
      { day: "پنج‌شنبه", Readers: 0, Engagements: 0 },
      { day: "جمعه", Readers: 0, Engagements: 0 },
      { day: "شنبه", Readers: 0, Engagements: 0 },
      { day: "یکشنبه", Readers: 0, Engagements: 0 },
    ];
  };

  const getConversionFunnelData = () => {
    return (analyticsSummary?.funnel || []).map((step: any) => ({
      name: step.label,
      Count: step.count || 0,
      Conversion: step.conversionFromPrevious || 0
    }));
  };

  const getCohortData = () => {
    return (analyticsSummary?.cohorts || []).slice(-8).map((row: any) => ({
      day: new Date(row.date).toLocaleDateString("fa-IR", { month: "short", day: "numeric" }),
      Readers: row.readers || 0,
      ReturnRate: row.returnRate || 0
    }));
  };

  const getSourceData = () => analyticsSummary?.sourceAttribution || [];

  const formatDuration = (seconds: number = 0) => {
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours} ساعت و ${minutes % 60} دقیقه`;
    return `${minutes} دقیقه`;
  };

  const percentLabel = (value: number | undefined) => `${Number(value || 0).toFixed(1)}%`;
  const activeNovelApprovalStatus = activeNovel
    ? activeNovel.approvalStatus || (activeNovel as any).approval_status
    : undefined;
  const activeNovelEditorNote = activeNovel
    ? activeNovel.editorNote || (activeNovel as any).editor_note
    : undefined;
  const shouldShowEditorChat = Boolean(activeNovelApprovalStatus && activeNovelApprovalStatus !== "pending");

  return (
    // The platform is Persian and right-to-left. The workspace previously forced
    // `dir="ltr"`, which mirrored every toolbar, list and quote away from the
    // author's reading direction.
    <div className={`space-y-8 pb-16 ${bookMode ? "writer-book-mode" : ""}`} data-book-mode={bookMode ? "true" : "false"} dir="rtl">
      {/* Header with fluid controls */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-4">
        <button
          onClick={
            activeWorkflow === "worksheet"
              ? handleBackToNovelList
              : onBackToDashboard
          }
          className={`flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold rounded-xl border transition-all ${activeTheme.border} ${activeTheme.card} hover:text-violet-500 cursor-pointer ${activeTheme.shadow}`}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{activeWorkflow === "worksheet" ? "بازگشت به فهرست رمان‌ها" : "بازگشت به داشبورد"}</span>
        </button>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <div className="inline-flex items-center justify-center gap-2 text-xs font-mono font-bold bg-violet-500/15 text-violet-400 border border-violet-500/20 px-4 py-1.5 rounded-xl max-w-full min-w-0 text-center">
            <PenTool className="w-4 h-4" />
            <span>استودیو نویسندگان رپتوک و میز کار خلاق</span>
          </div>
          <button type="button" onClick={() => onBookModeChange?.(!bookMode)} aria-pressed={bookMode} className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition-all ${bookMode ? "border-amber-500 bg-amber-500/15 text-amber-500" : `${activeTheme.border} ${activeTheme.card} hover:border-amber-500/50`}`}>
            <BookOpen className="h-4 w-4" /> حالت کتابی: {bookMode ? "فعال" : "غیرفعال"}
          </button>
        </div>
      </div>

      {currentUser?.username && (
        <AuthorSocialLinksPanel username={currentUser.username} theme={theme} compact />
      )}

      {/* Main workspace container with AnimatePresence */}
      <AnimatePresence mode="wait">
        {activeWorkflow === "choose" ? (
          <motion.section 
            key="choose-screen"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
            className="space-y-8"
          >
            {!isCreatingBook ? (
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1 text-start">
                    <h1 className="text-3xl font-extrabold tracking-tight">استودیوی نویسندگی و کنسول رمان‌ها</h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">هر یک از رمان‌های خود را انتخاب کنید تا فصل‌ها را مدیریت کنید، آمار خوانندگان را ببینید، متادیتای مجموعه را ویرایش کنید یا حماسه‌ای تازه بنویسید.</p>
                  </div>
                  <button
                    onClick={() => setIsCreatingBook(true)}
                    className="px-5 py-3 bg-violet-600 hover:bg-violet-500 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-violet-600/20 transition-all font-mono self-start md:self-auto"
                  >
                    <Plus className="w-4 h-4" />
                    <span>ساخت رمان جدید</span>
                  </button>
                </div>

                {/* Engagement overview: combined per-novel statistics */}
                {novelStatsError && (
                  <div className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-rose-500/20 bg-rose-500/5 text-rose-400 text-xs font-semibold">
                    <span>{novelStatsError}</span>
                    <button type="button" onClick={loadNovelStats} className="px-3 py-1.5 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 transition-colors flex items-center gap-1.5">
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>تلاش دوباره</span>
                    </button>
                  </div>
                )}
                {!novelStatsError && novelStats.length > 0 && (
                  <section className={`rounded-3xl border p-5 md:p-6 ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`} aria-label="نمای کلی تعامل خوانندگان">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                      <div>
                        <h2 className="text-base font-black tracking-tight flex items-center gap-2">
                          <BarChart3 className="w-4.5 h-4.5 text-violet-500" />
                          <span>نمای کلی تعامل هر رمان</span>
                        </h2>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">پسندیدن‌ها، دیدگاه‌ها و نقدهای هر رمان در یک نگاه — با هر بازدید به‌روز می‌شود.</p>
                      </div>
                      <button type="button" onClick={loadNovelStats} className="self-start px-3 py-1.5 rounded-xl border text-[11px] font-bold text-slate-500 hover:text-violet-400 hover:border-violet-500/40 transition-colors flex items-center gap-1.5 cursor-pointer">
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>به‌روزرسانی آمار</span>
                      </button>
                    </div>
                    <div className="overflow-x-auto -mx-1 px-1">
                      <table className="w-full min-w-[640px] text-right border-collapse">
                        <thead>
                          <tr className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 border-b border-slate-900/10 dark:border-slate-700/40">
                            <th scope="col" className="py-2.5 pl-2 font-bold">رمان</th>
                            <th scope="col" className="py-2.5 px-2 font-bold">لایک‌ها</th>
                            <th scope="col" className="py-2.5 px-2 font-bold">دیدگاه‌ها</th>
                            <th scope="col" className="py-2.5 px-2 font-bold">نقدها</th>
                            <th scope="col" className="py-2.5 px-2 font-bold">امتیاز</th>
                            <th scope="col" className="py-2.5 px-2 font-bold">بازدیدها</th>
                            <th scope="col" className="py-2.5 px-2 pr-2 font-bold">تعامل کل</th>
                          </tr>
                        </thead>
                        <tbody>
                          {novels.map((novel) => {
                            const stat = statsByNovelId.get(novel.id);
                            if (!stat) return null;
                            return (
                              <tr key={novel.id} className="border-b border-slate-900/5 dark:border-slate-800/40 last:border-0 text-xs">
                                <td className="py-3 pl-2 max-w-[220px]">
                                  <span className="block font-extrabold truncate" title={stat.title}>{stat.title}</span>
                                  <span className="block text-[10px] text-slate-500 font-mono">{novel.genre}</span>
                                </td>
                                <td className="py-3 px-2"><span className="inline-flex items-center gap-1.5 font-bold text-rose-400"><Heart className="w-3.5 h-3.5" />{stat.likesCount.toLocaleString('fa-IR')}</span></td>
                                <td className="py-3 px-2"><span className="inline-flex items-center gap-1.5 font-bold text-fuchsia-500 dark:text-fuchsia-400"><MessageSquare className="w-3.5 h-3.5" />{stat.commentsCount.toLocaleString('fa-IR')}</span></td>
                                <td className="py-3 px-2"><span className="inline-flex items-center gap-1.5 font-bold text-emerald-500 dark:text-emerald-400"><FileText className="w-3.5 h-3.5" />{stat.reviewsCount.toLocaleString('fa-IR')}</span></td>
                                <td className="py-3 px-2"><span className="inline-flex items-center gap-1.5 font-bold text-amber-500"><Star className="w-3.5 h-3.5" />{stat.avgRating > 0 ? stat.avgRating.toLocaleString('fa-IR', { maximumFractionDigits: 1 }) : '—'}</span></td>
                                <td className="py-3 px-2"><span className="inline-flex items-center gap-1.5 font-bold text-slate-500"><Eye className="w-3.5 h-3.5" />{formatAverageViews(stat.viewsCount)}</span></td>
                                <td className="py-3 px-2 pr-2"><span className="inline-flex items-center rounded-full bg-violet-500/10 border border-violet-500/25 text-violet-500 dark:text-violet-300 px-2.5 py-1 text-[11px] font-black">{stat.totalEngagement.toLocaleString('fa-IR')}</span></td>
                              </tr>
                            );
                          })}
                          {!novels.length && (
                            <tr><td colSpan={7} className="py-6 text-center text-xs text-slate-500">هنوز رمانی برای نمایش آمار وجود ندارد.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {/* Main grid table */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Interactive Creator Starter Card */}
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    onClick={() => setIsCreatingBook(true)}
                    className={`p-6 rounded-3xl border-2 border-dashed border-slate-700/25 cursor-pointer hover:border-violet-500 hover:bg-violet-500/5 flex flex-col items-center justify-center text-center gap-4 min-h-[240px] group transition-all ${activeTheme.card} ${activeTheme.shadow}`}
                  >
                    <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Plus className="w-7 h-7 text-violet-400" />
                    </div>
                    <div>
                      <h4 className="font-extrabold text-sm text-slate-800 dark:text-slate-100/90">آغاز یک سریال یا رمان فانتزی تازه</h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 max-w-[210px] mx-auto leading-relaxed">ساخت یک رمان جدید</p>
                    </div>
                  </motion.div>

                  {novels.map((novel) => (
                    <motion.div
                      key={novel.id}
                      whileHover={{ scale: 1.02 }}
                      className={`p-4 rounded-3xl border flex gap-4 items-start hover:border-violet-500/50 transition-all ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}
                    >
                      <SafeImage
                        src={novel.cover}
                        alt={novel.title}
                        referrerPolicy="no-referrer"
                        className="w-20 h-28 rounded-2xl object-cover flex-shrink-0 bg-slate-900 border border-slate-700/15"
                      />

                      <div className="flex-1 min-w-0 space-y-2 flex flex-col justify-between h-full">
                        <div>
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-[10px] font-mono font-bold text-violet-500 uppercase tracking-wide truncate">
                              {novel.genre}
                            </span>
                            {novel.ageRating && (
                              <span className="text-[9px] font-mono bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded-md font-bold shrink-0">
                                {novel.ageRating}
                              </span>
                            )}
                          </div>
                          <h3 className="font-black text-sm text-slate-900 dark:text-slate-100/90 truncate leading-tight mt-1" title={novel.title}>
                            {novel.title}
                          </h3>
                          <p className="text-[11px] text-slate-500">به قلم {novel.author}</p>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] pt-3 border-t border-slate-900/10 dark:border-violet-950/20">
                          <span className="font-mono text-slate-500 flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5" />
                            <span>{novel.chapters?.length || 0} فصل</span>
                          </span>

                          <div className="flex items-center gap-2"><button type="button" onClick={() => onOpenWorldbuilding?.(novel.id)} className="text-xs font-bold text-violet-400 hover:text-violet-300">جهان‌سازی</button><button
                            onClick={() => handleLaunchWorkspace(novel.id)}
                            className="text-xs font-bold text-violet-400 hover:text-violet-300 transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <span>مدیریت رمان</span>
                            <span>→</span>
                          </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            ) : (
              <motion.div 
                key="create-book-form"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                {/* Immersive Novel Launch Form Plan Header */}
                <div className="space-y-2 border-b border-slate-800/20 pb-4 text-start">
                  <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
                    <Sparkles className="w-8 h-8 text-violet-500" />
                    <span>ساخت رمان جدید</span>
                  </h1>
                </div>

                {bookError && (
                  <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl font-semibold">
                    {bookError}
                  </div>
                )}

                <form onSubmit={handleCreateNovel} className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8 items-start">
                  {/* Column 1: Novel details and Real Image Uploader (5/12) */}
                  <div className={`p-4 sm:p-6 rounded-3xl border ${activeTheme.border} ${activeTheme.card} lg:col-span-5 space-y-5 ${activeTheme.shadow}`}>
                    <h3 className="font-mono text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800/10 pb-2">
                      پروفایل مجموعه و طراحی هنر بصری
                    </h3>

                    <div className="space-y-4">
                      {/* Interactive Drag & Drop Cover Art Uploader */}
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                          جلد رمان (بارگذاری یا ساخت)
                        </label>
                        
                        <div 
                          className={`border-2 border-dashed rounded-2xl p-5 text-center flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${
                            isDragOver 
                              ? "border-violet-500 bg-violet-500/5 text-violet-400" 
                              : "border-slate-800 bg-black/10 text-slate-400 hover:border-slate-700 hover:bg-slate-900/10"
                          }`}
                          onClick={openCreateCoverModal}
                        >
                          {bookCover ? (
                            <div className="space-y-3">
                              <SafeImage
                                src={bookCover} 
                                alt="پیش‌نمایش جلد"
                                className="w-18 h-26 object-cover rounded-xl mx-auto shadow-md border border-slate-800"
                              />
                              <div className="text-[10px] font-bold text-violet-400 flex items-center justify-center gap-1">
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>جلد با موفقیت پردازش شد! برای تغییر ضربه بزنید</span>
                              </div>
                            </div>
                          ) : (
                            <>
                              <Cloud className="w-8 h-8 text-slate-500" />
                              <div className="text-xs font-extrabold text-slate-700 dark:text-slate-300">باز کردن ویرایشگر جلد</div>
                              <p className="text-[10px] text-slate-500 leading-normal">برای بارگذاری، برش یا ساخت جلد سفارشی کلیک کنید</p>
                            </>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                          عنوان رمان یا مجموعه
                        </label>
                        <input
                          type="text"
                          required
                          value={bookTitle}
                          onChange={(e) => setBookTitle(e.target.value)}
                          className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                            theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                          }`}
                        />
                      </div>

                      {/* A manga's first chapter has no pages yet, so its release
                          state is decided in the page studio rather than here. The
                          block is unmounted (not merely hidden) so its required
                          datetime field cannot block the form. */}
                      {novelContentKind !== "manga" && (
                        <div className={`p-4 rounded-2xl border ${activeTheme.border} ${theme === "dark" ? "bg-slate-900/40" : "bg-slate-50"} space-y-3`}>
                          <div>
                            <h4 className="text-[11px] font-mono font-bold text-slate-400 tracking-wider">انتشار فصل آغازین</h4>
                            <p className="text-[10px] text-slate-500">هنگام ساخت رمان، آن را منتشر کنید، خصوصی نگه دارید یا زمان‌بندی کنید.</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {(["Published", "Draft", "Scheduled"] as const).map((status) => (
                              <button
                                type="button"
                                key={status}
                                onClick={() => { setFirstChapterStatus(status); if (status !== "Scheduled") setFirstChapterScheduledAt(""); }}
                                className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${firstChapterStatus === status ? "border-violet-500/50 bg-violet-500/15 text-violet-400" : "border-slate-700/30 text-slate-500"}`}
                              >
                                {status === "Published" ? "انتشار پس از تأیید" : status === "Draft" ? "پیش‌نویس" : "زمان‌بندی‌شده"}
                              </button>
                            ))}
                          </div>
                          {firstChapterStatus === "Scheduled" && (
                            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-slate-500">
                              تاریخ و زمان انتشار
                              <input type="datetime-local" required min={minimumScheduledDateTimeInput()} value={firstChapterScheduledAt} onChange={(e) => setFirstChapterScheduledAt(e.target.value)} className={`p-2.5 text-xs rounded-xl border ${theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-violet-300" : "bg-white border-stone-200 text-stone-900"}`} />
                              <span className="normal-case font-normal text-slate-500">به وقت دستگاه شما: {browserTimeZoneLabel()}</span>
                            </label>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div className="min-w-0">
                          <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                            Author Pen Name
                          </label>
                          <input
                            type="text"
                            required
                            value={bookAuthor}
                            onChange={(e) => setBookAuthor(e.target.value)}
                            placeholder="مثلاً، زیک ونس"
                            className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                              theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                            }`}
                          />
                        </div>

                        <div className="min-w-0">
                          <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                            رده سنی هدف
                          </label>
                          <select
                            value={novelAgeRating}
                            onChange={(e) => setNovelAgeRating(e.target.value)}
                            className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                              theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                            }`}
                          >
                            <option value="G">G (همه سنین)</option>
                            <option value="PG-13">PG-13 (نوجوانان و جوانان)</option>
                            <option value="R-17">R-17 (ممنوع زیر 17 سال)</option>
                            <option value="18+">18+ (بزرگسالان)</option>
                          </select>
                        </div>
                      </div>

                      {/* Work type. Prose chapters hold text; manga chapters hold
                          ordered image pages, so this choice is permanent. */}
                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                            قالب اثر (پس از ساخت قابل تغییر نیست)
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { id: "novel", label: "رمان متنی", desc: "فصل‌ها با ویرایشگر متن نوشته می‌شوند" },
                              { id: "manga", label: "مانگا / کمیک", desc: "فصل‌ها از صفحه‌های تصویری ساخته می‌شوند" }
                            ].map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => setNovelContentKind(option.id as ContentKind)}
                                className={`p-2.5 rounded-xl border text-right transition-all cursor-pointer ${
                                  novelContentKind === option.id
                                    ? "border-violet-500 bg-violet-500/10"
                                    : theme === "dark" ? "border-violet-950 bg-[#0e0a1c] hover:border-violet-700" : "border-stone-200 bg-stone-50 hover:border-violet-300"
                                }`}
                                aria-pressed={novelContentKind === option.id}
                              >
                                <span className={`block text-xs font-black ${novelContentKind === option.id ? "text-violet-400" : ""}`}>{option.label}</span>
                                <span className="block text-[9px] text-slate-500 mt-0.5">{option.desc}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {novelContentKind === "manga" && (
                          <div>
                            <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                              ترتیب خواندن صفحه‌ها
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                { id: "rtl", label: "راست به چپ", desc: "مانگای ژاپنی و فارسی" },
                                { id: "ltr", label: "چپ به راست", desc: "کمیک غربی و وب‌تون" }
                              ].map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => setNovelReadingDirection(option.id as ReadingDirection)}
                                  className={`p-2.5 rounded-xl border text-right transition-all cursor-pointer ${
                                    novelReadingDirection === option.id
                                      ? "border-violet-500 bg-violet-500/10"
                                      : theme === "dark" ? "border-violet-950 bg-[#0e0a1c] hover:border-violet-700" : "border-stone-200 bg-stone-50 hover:border-violet-300"
                                  }`}
                                  aria-pressed={novelReadingDirection === option.id}
                                >
                                  <span className={`block text-xs font-black ${novelReadingDirection === option.id ? "text-violet-400" : ""}`}>{option.label}</span>
                                  <span className="block text-[9px] text-slate-500 mt-0.5">{option.desc}</span>
                                </button>
                              ))}
                            </div>
                            <p className="mt-1 text-[9px] text-slate-500">این تنظیم بعداً از تب «پروفایل رمان» قابل تغییر است.</p>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                            نوع اثر
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { id: "original", label: "اورجینال", desc: "داستان اصیل خودت" },
                              { id: "translated", label: "ترجمه‌شده", desc: "اقتباس/ترجمه از نویسندهٔ دیگر" }
                            ].map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => setNovelOriginType(option.id as any)}
                                className={`p-2.5 rounded-xl border text-right transition-all cursor-pointer ${
                                  novelOriginType === option.id
                                    ? "border-violet-500 bg-violet-500/10"
                                    : theme === "dark" ? "border-violet-950 bg-[#0e0a1c] hover:border-violet-700" : "border-stone-200 bg-stone-50 hover:border-violet-300"
                                }`}
                              >
                                <span className={`block text-xs font-black ${novelOriginType === option.id ? "text-violet-400" : ""}`}>{option.label}</span>
                                <span className="block text-[9px] text-slate-500 mt-0.5">{option.desc}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {novelOriginType === "translated" && (
                          <>
                            <div>
                              <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                                نام نویسندهٔ اثر اصلی *
                              </label>
                              <input
                                type="text"
                                value={novelOriginalAuthor}
                                onChange={(e) => setNovelOriginalAuthor(e.target.value)}
                                placeholder="مثلاً، Brandon Sanderson"
                                maxLength={80}
                                className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                                  theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                                }`}
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                                مترجم / مترجمان * (با ویرگول جدا کنید)
                              </label>
                              <input
                                type="text"
                                value={novelTranslators}
                                onChange={(e) => setNovelTranslators(e.target.value)}
                                placeholder="مثلاً، سارا محمدی، رضا کریمی"
                                className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                                  theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                                }`}
                              />
                              <p className="mt-1 text-[9px] text-slate-500">این اطلاعات با نشان «ترجمه‌شده» روی صفحهٔ رمان نمایش داده می‌شود.</p>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                            ژانر اصلی (فیلتر صفحه اصلی)
                          </label>
                          <select
                            value={bookGenre}
                            onChange={(e) => setBookGenre(e.target.value)}
                            className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                              theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                            }`}
                          >
                            <option value="" disabled>ژانر اصلی را انتخاب کنید</option>
                            {MAIN_CATEGORIES.map((genre) => (
                              <option key={genre} value={genre}>
                                {genre}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                          خلاصه پشت جلد رمان (قابلی برای جلب توجه خوانندگان)
                        </label>
                        <textarea
                          rows={3}
                          required
                          value={bookDesc}
                          onChange={(e) => setBookDesc(e.target.value)}
                          placeholder="در دنیایی که به دست دروازه‌های عظیم بین‌بعدی ویران شده، بشریت ناچار به اتحاد است..."
                          className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all resize-none leading-relaxed ${
                            theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                          }`}
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                          دسته‌های اصلی (حداکثر 4)
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {MAIN_CATEGORIES.map((cat) => {
                            const isSelected = novelMainCategories.includes(cat);
                            return (
                              <button
                                type="button"
                                key={cat}
                                onClick={() => {
                                  if (isSelected) {
                                    setNovelMainCategories(novelMainCategories.filter(c => c !== cat));
                                  } else if (novelMainCategories.length < 4) {
                                    setNovelMainCategories([...novelMainCategories, cat]);
                                  }
                                }}
                                className={`px-3 py-1.5 text-[10px] rounded-lg font-bold border transition-colors ${
                                  isSelected
                                    ? "bg-violet-600 border-violet-500 text-white"
                                    : "bg-transparent border-slate-700/40 text-slate-400 hover:border-slate-500 hover:text-slate-200"
                                }`}
                              >
                                {cat}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-2">
                          <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono">
                            زیردسته‌ها (حداکثر 25)
                          </label>
                          <input
                            type="text"
                            value={subCatSearch}
                            onChange={(e) => setSubCatSearch(e.target.value)}
                            placeholder="جستجوی زیرژانرها..."
                            className={`px-3 py-1 text-[10px] rounded focus:outline-none border w-44 max-w-full font-medium ${
                              theme === "dark" 
                                ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" 
                                : "bg-white border-stone-200 text-stone-700 focus:border-amber-500"
                            }`}
                          />
                        </div>
                        <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                          {SUB_CATEGORIES.filter(cat => cat.toLowerCase().includes(subCatSearch.toLowerCase())).map((cat) => {
                            const isSelected = novelSubCategories.includes(cat);
                            return (
                              <button
                                type="button"
                                key={cat}
                                onClick={() => {
                                  if (isSelected) {
                                    setNovelSubCategories(novelSubCategories.filter(c => c !== cat));
                                  } else if (novelSubCategories.length < 25) {
                                    setNovelSubCategories([...novelSubCategories, cat]);
                                  }
                                }}
                                className={`px-2.5 py-1 text-[10px] rounded font-medium border transition-colors ${
                                  isSelected
                                    ? "bg-violet-500/20 border-violet-500/50 text-violet-400"
                                    : "bg-transparent border-slate-800/60 text-slate-500 hover:border-slate-600 hover:text-slate-300"
                                }`}
                              >
                                {cat}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-stone-500 tracking-wider uppercase font-mono mb-1.5">
                          هشدارهای محتوا
                        </label>
                        <div className="grid grid-cols-1 gap-2 text-[11px]">
                          {CONTENT_WARNINGS.map((warning) => {
                            const exists = novelWarnings.includes(warning.id);
                            return (
                              <label
                                key={warning.id}
                                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer select-none transition-all ${
                                  exists
                                    ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                                    : "border-slate-850 dark:border-violet-950/20 bg-transparent text-slate-400 hover:bg-slate-800/30"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={exists}
                                  onChange={() => {
                                    if (exists) {
                                      setNovelWarnings(novelWarnings.filter((w) => w !== warning.id));
                                    } else {
                                      setNovelWarnings([...novelWarnings, warning.id]);
                                    }
                                  }}
                                  className="mt-1 h-4 w-4 min-h-4 min-w-4 shrink-0 rounded border-slate-600"
                                />
                                <div>
                                  <div className="font-bold">{warning.label}</div>
                                  <div className={`text-[10px] mt-0.5 leading-relaxed ${exists ? "text-amber-500/80" : "text-slate-500"}`}>
                                    {warning.desc}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Column 2: First Chapter editor workspace (7/12) */}
                  <div className={`p-4 sm:p-6 rounded-3xl border ${activeTheme.border} ${activeTheme.card} lg:col-span-7 space-y-5 ${activeTheme.shadow}`}>
                    <div className="flex items-center justify-between border-b border-slate-800/10 pb-2">
                      <h3 className="font-mono text-xs font-bold text-slate-400 uppercase tracking-widest">
                        آفرینش رمان و پیش‌نویس فصل آغازین
                      </h3>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                          عنوان فصل / اپیزود آغازین
                        </label>
                        <input
                          type="text"
                          required
                          value={firstChapterTitle}
                          onChange={(e) => setFirstChapterTitle(e.target.value)}
                          className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                            theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                          }`}
                        />
                      </div>

                      {/* Manga pages reference a chapter row, so they can only be
                          uploaded after the work exists. The first chapter is
                          therefore created empty and its pages are added in the
                          workspace that opens right after. */}
                      {novelContentKind === "manga" ? (
                        <div className={`rounded-2xl border p-4 space-y-2 ${activeTheme.border} ${theme === "dark" ? "bg-slate-900/40" : "bg-slate-50"}`}>
                          <p className="text-[11px] font-mono font-black uppercase tracking-wider text-violet-400">صفحه‌های فصل نخست</p>
                          <p className="text-[11px] leading-relaxed text-slate-500">
                            پس از ساخت مانگا، بلافاصله استودیوی صفحه‌ها باز می‌شود و می‌توانید چند صفحه را همزمان بارگذاری کنید،
                            ترتیب‌شان را با کشیدن تغییر دهید و صفحه‌های گسترده را علامت بزنید.
                          </p>
                          <p className="text-[11px] font-bold text-amber-500">
                            فصل نخست به‌صورت پیش‌نویس ساخته می‌شود و پس از افزودن صفحه‌ها قابل انتشار است.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                            محتوای پیش‌نویس اپیزود (ویرایشگر غنی)
                          </label>
                          <TiptapEditor
                            content={firstChapterContent}
                            onChange={setFirstChapterContent}
                            theme={theme}
                            targetWordCount={targetWordCount}
                            bookMode={bookMode}
                          />
                        </div>
                      )}
                    </div>

                    {/* Submit Actions */}
                    <div className="flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-slate-800/10">
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreatingBook(false);
                          setBookError("");
                          setActiveWorkflow("choose");
                        }}
                        className="px-5 py-2.5 text-xs font-bold rounded-xl border border-slate-700/20 hover:text-rose-400 hover:border-rose-400/30 transition-colors cursor-pointer"
                      >
                        انصراف
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm("این پیش‌نویس منتشرنشده رمان بازنشانی شود؟")) {
                            resetCreateNovelDraft();
                          }
                        }}
                        className="px-5 py-2.5 text-xs font-bold rounded-xl border border-rose-500/25 text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                      >
                        بازنشانی پیش‌نویس
                      </button>
                      <button
                        type="submit"
                        disabled={isPublishingBook}
                        className="px-6 py-2.5 bg-gradient-to-l from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-lg shadow-violet-600/20 flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <PenTool className="w-4 h-4" />
                        <span>{isPublishingBook
                          ? "در حال ذخیره..."
                          : novelContentKind === "manga"
                            ? "ساخت مانگا و رفتن به استودیوی صفحه‌ها"
                            : firstChapterStatus === "Scheduled"
                              ? "راه‌اندازی رمان و زمان‌بندی فصل"
                              : firstChapterStatus === "Draft"
                                ? "راه‌اندازی رمان با پیش‌نویس"
                                : "راه‌اندازی رمان و انتشار در رپتوک"}</span>
                      </button>
                    </div>
                  </div>
                </form>
              </motion.div>
            )}
          </motion.section>
        ) : (
          <motion.section 
            key="worksheet-screen"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
            className="space-y-6 text-start"
          >
            {/* Active Webnovel details banner */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4.5 border border-violet-900/15 dark:border-violet-950/25 bg-violet-500/5 rounded-3xl">
              <div className="flex items-center gap-4">
                <SafeImage
                  src={activeNovel?.cover}
                  alt={activeNovel?.title}
                  referrerPolicy="no-referrer"
                  className="w-12 h-18 object-cover rounded-xl shadow-lg border border-slate-700/15 shrink-0"
                />
                <div>
                  <span className="text-[9px] font-mono font-bold text-violet-400 uppercase tracking-widest block">
                    کنسول کارگاه فعال
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <h2 className="text-xl font-black tracking-tight leading-snug break-words min-w-0">{activeNovel?.title}</h2>
                    {activeNovelApprovalStatus === "pending_approval" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 uppercase font-black">در انتظار بررسی</span>
                    )}
                    {activeNovelApprovalStatus === "rejected" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500 border border-rose-500/20 uppercase font-black">رد شده</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">قلم نویسنده: {activeNovel?.author} • فصل‌ها: {activeNovel?.chapters?.length || 0} • وضعیت: در حال انتشار</p>
                  {activeNovelApprovalStatus === "rejected" && activeNovelEditorNote && (
                    <div className="mt-2 p-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
                       <p className="text-[10px] text-rose-400 font-mono font-bold uppercase tracking-widest mb-0.5">یادداشت سردبیر:</p>
                       <p className="text-[11px] text-rose-300 font-medium">{activeNovelEditorNote}</p>
                    </div>
                  )}
                  {activeNovelApprovalStatus === "pending_approval" && (
                     <p className="text-[10px] text-amber-500/70 font-mono mt-1">این رمان در حال حاضر در فهرست عمومی نیست و پیش از انتشار منتظر تأیید سردبیر است.</p>
                  )}
                </div>
              </div>

              <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2 md:flex md:flex-wrap md:self-auto">
                {onDeleteNovel && (
                  <button
                    onClick={handleDeleteActiveNovel}
                    disabled={isDeletingNovel}
                    className="text-xs font-bold text-rose-400 border border-rose-500/25 bg-rose-500/10 hover:bg-rose-600 hover:text-white px-5 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer font-mono disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>{isDeletingNovel ? "در حال حذف..." : "حذف رمان"}</span>
                  </button>
                )}
                <button
                  onClick={() => handleCreateNewChapterReset(false)}
                  className="text-xs font-bold text-violet-400 border border-violet-500/20 bg-violet-500/10 hover:bg-violet-600 hover:text-white px-5 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer font-mono"
                >
                  <Plus className="w-4 h-4" />
                  <span>پیش‌نویس اپیزود جدید</span>
                </button>
                <button
                  onClick={() => handleCreateNewChapterReset(true)}
                  className="text-xs font-bold text-violet-400 border border-violet-500/20 bg-violet-500/10 hover:bg-violet-600 hover:text-white px-5 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer font-mono"
                >
                  <Plus className="w-4 h-4" />
                  <span>افزودن اطلاعات پیوست</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 lg:gap-8 items-start">
              {/* Column 1: Storyboard index (1/4).
                  On phones the list is collapsed behind a summary so the
                  editor is the first thing an author reaches. */}
              <details className="lg:col-span-1 min-w-0 space-y-4 group" open={!isMobileViewport}>
                <summary className="flex cursor-pointer items-center justify-between gap-2 font-extrabold text-xs uppercase tracking-wider text-stone-500 font-mono lg:cursor-default lg:list-none">
                  <span>پیش‌نویس‌های رمان و فهرست استوری‌برد</span>
                  <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-400 lg:hidden">
                    {(activeNovel?.chapters?.length || 0).toLocaleString("fa-IR")}
                  </span>
                </summary>

                <div className="space-y-2 max-h-[55vh] lg:max-h-[75vh] overflow-y-auto scrollbar-none">
                  {activeNovel?.chapters && activeNovel.chapters.length > 0 ? (
                    [...activeNovel.chapters]
                      .sort((a,b) => Number(a.isAuxiliary) - Number(b.isAuxiliary) || b.chapterNumber - a.chapterNumber)
                      .map((chapter) => {
                        const isSelected = editingChapterId === chapter.id;
                        return (
                          <div
                            key={chapter.id}
                            className={`p-3.5 rounded-2xl border text-start text-xs font-semibold flex items-center justify-between transition-all ${
                              isSelected
                                ? "bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-600/15"
                                : theme === "dark"
                                  ? "bg-slate-900/40 border-slate-800/10 hover:border-slate-800 hover:text-white text-slate-400 dark:text-slate-350"
                                  : "bg-white border-stone-200 hover:border-orange-300 text-stone-700 hover:text-stone-950 shadow-sm"
                            }`}
                          >
                            <div 
                              className="flex-1 min-w-0 flex flex-col cursor-pointer"
                              onClick={() => handleEditChapter(chapter)}
                            >
                              <div className="flex items-center gap-2 min-w-0 w-full">
                                <span className="font-mono text-[11px] text-violet-400 font-black shrink-0">
                                  {chapter.isAuxiliary ? `پیوست ${chapter.chapterNumber}:` : `فصل ${chapter.chapterNumber}:`}
                                </span>
                                <span className={`truncate flex-1 font-black ${isSelected ? "text-white" : theme === "dark" ? "text-slate-100 dark:text-slate-105" : "text-stone-950"}`}>{chapter.title}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                {(!chapter.status || chapter.status === "Published") && (
                                  <span className={`text-[8px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded-sm shrink-0 ${isSelected ? "bg-white/20 text-white" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"}`}>
                                    {activeNovelApprovalStatus === "approved" ? "منتشر شده" : "آماده پس از تأیید"}
                                  </span>
                                )}
                                {chapter.status === "Draft" && (
                                  <span className={`text-[8px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded-sm shrink-0 ${isSelected ? "bg-white/20 text-white" : "bg-orange-500/10 text-orange-400 border border-orange-500/20"}`}>
                                    پیش‌نویس
                                  </span>
                                )}
                                {chapter.status === "Scheduled" && (
                                  <span className={`text-[8px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded-sm shrink-0 max-w-[130px] truncate ${isSelected ? "bg-white/20 text-white" : "bg-violet-500/10 text-violet-400 border border-violet-500/20"}`}>
                                    زمان‌بندی‌شده{chapter.scheduledAt ? ` · ${scheduledDateLabel(chapter.scheduledAt)}` : ""}
                                  </span>
                                )}
                                {(chapter as any).approval_status === 'approved' && (
                                  <span className="text-[8px] font-mono text-emerald-400">تأیید سردبیر</span>
                                )}
                                {(chapter as any).approval_status === 'rejected' && (
                                  <span className="text-[8px] font-mono text-rose-400">نیاز به اصلاح</span>
                                )}
                                {/* Manga chapters are measured in pages, prose in words. */}
                                <span className={`text-[9px] ${isSelected ? "text-white/60" : "text-slate-500"}`}>
                                  {isMangaNovel
                                    ? `${Number(mangaPageCounts[chapter.id] ?? chapter.pageCount ?? 0).toLocaleString("fa-IR")} صفحه`
                                    : `${chapter.wordCount} کلمه`}
                                </span>
                                {isMangaNovel && Number(mangaPageCounts[chapter.id] ?? chapter.pageCount ?? 0) === 0 && (
                                  <span className={`text-[8px] font-mono ${isSelected ? "text-white/70" : "text-amber-500"}`}>بدون صفحه</span>
                                )}
                              </div>
                            </div>

                            <button
                              onClick={() => handleDeleteChapter(chapter.id)}
                              className="p-1 px-1.5 rounded-lg hover:bg-rose-500 hover:text-white text-slate-500 transition-colors ml-1 cursor-pointer shrink-0"
                              title="حذف دائمی فصل"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })
                  ) : (
                    <div className="p-5 border border-dashed border-slate-700/15 rounded-2xl text-xs text-slate-500 text-center">
                      هنوز فصلی نوشته نشده است. با دکمه پیش‌نویس بالا شروع کنید!
                    </div>
                  )}
                </div>
              </details>

              {/* Column 2: Central rich workspace editor (3/4) */}
              <div className={`lg:col-span-3 min-w-0 p-4 sm:p-6 rounded-3xl border space-y-5 sm:space-y-6 ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-900/10 dark:border-violet-950/20 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-violet-400 flex items-center justify-center font-mono text-base font-black shrink-0">
                      {chNumber}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-extrabold text-sm">
                        {editingChapterId ? "بازبینی و ویرایش اپیزود" : "نگارش اپیزود جدید"}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        {editingChapterId ? "به‌روزرسانی‌ها را ذخیره کنید یا تنظیمات انتشار را در پایین تغییر دهید." : "یک نقطهٔ طرح کاملاً تازه به جهان داستانی خود اضافه کنید."}
                      </p>
                      {/* Persistent save state: a transient toast is not enough
                          for an author to trust that their words are stored. */}
                      <p
                        role="status"
                        aria-live="polite"
                        className={`mt-1 inline-flex items-center gap-1.5 text-[10px] font-black ${
                          saveState === "failed"
                            ? "text-rose-400"
                            : saveState === "unsaved"
                              ? "text-amber-400"
                              : saveState === "saving"
                                ? "text-violet-400"
                                : saveState === "saved"
                                  ? "text-emerald-400"
                                  : "text-slate-500"
                        }`}
                      >
                        {saveState === "saving" && <RotateCw className="h-3 w-3 animate-spin" />}
                        {saveState === "saved" && <Check className="h-3 w-3" />}
                        {saveState === "failed" && <ShieldAlert className="h-3 w-3" />}
                        <span>
                          {saveState === "saving"
                            ? "در حال ذخیره…"
                            : saveState === "failed"
                              ? "ذخیره نشد — تغییرات فقط در این مرورگر است"
                              : saveState === "unsaved"
                                ? "تغییرات ذخیره‌نشده"
                                : saveState === "saved"
                                  ? `ذخیره شد${lastSavedAt ? ` · ${lastSavedAt.toLocaleTimeString("fa-IR")}` : ""}`
                                  : "آماده نگارش"}
                        </span>
                        <span className={`ms-1 font-mono ${isMobileViewport ? "hidden" : ""} text-slate-500`}>Ctrl+S</span>
                      </p>
                    </div>
                  </div>

                  {/* Horizontal tab switcher.
                      On phones the tabs scroll on a single row: wrapping them
                      pushed the editor far below the fold. */}
                  <div
                    className="-mx-1 flex snap-x gap-1.5 overflow-x-auto rounded-2xl border border-slate-700/10 bg-slate-800/15 p-1 dark:bg-violet-950/25 md:mx-0 md:flex-wrap md:overflow-visible md:shrink-0"
                    style={{ scrollbarWidth: "none" }}
                    role="tablist"
                    aria-label="بخش‌های کارگاه نویسنده"
                  >
                    {[
                      { id: "write", label: "نگارش", icon: PenTool },
                      { id: "security", label: "ضد کپی", icon: ShieldAlert },
                      { id: "preview", label: "نمای خواننده", icon: BookOpen },
                      { id: "characters", label: "گروه شخصیت‌ها", icon: Users },
                      { id: "metadata", label: "پروفایل رمان", icon: Settings },
                      { id: "analytics", label: "آمار خوانندگان", icon: BarChart3 },
                      { id: "comments", label: "کامنت‌ها", icon: MessagesSquare },
                      ...(currentUser && novels.length >= 1 ? [{ id: "monetize", label: "درآمدزایی", icon: Wallet }] : []),
                      { id: "posts", label: "پست‌های نویسنده", icon: MessageSquare },
                      ...(shouldShowEditorChat ? [{ id: "editor-chat", label: "گفتگو با سردبیر", icon: Flame }] : [])
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => {
                          if ((tab.id === "metadata" || tab.id === "security") && activeNovel) {
                            setEditBookTitle(activeNovel.title);
                            setEditBookAuthor(activeNovel.author);
                            setEditBookGenre(activeNovel.genre);
                            setEditBookDesc(activeNovel.description || "");
                            setEditBookCover(activeNovel.cover || activeNovel.coverUrl || "");
                            setEditBookTags(activeNovel.tags ? filterTaxonomyList(activeNovel.tags).join(", ") : "");
                            const loadedWarnings = normalizeContentWarnings(filterTaxonomyList(activeNovel.warnings || []), CONTENT_WARNINGS);
                            setEditBookWarnings([...loadedWarnings.values, ...loadedWarnings.invalid]);
                            setEditPremiumPresentation(sanitizePremiumPresentation(activeNovel.premiumPresentation));
                            setEditOriginType(activeNovel.originType === "translated" ? "translated" : "original");
                            setEditOriginalAuthor(activeNovel.originalAuthor || "");
                            setEditTranslators(Array.isArray(activeNovel.translators) ? activeNovel.translators.join(", ") : "");
                            setEditReadingDirection(normalizeReadingDirection((activeNovel as any).readingDirection));
                            setEditPreventCopy(activeNovel.preventCopy === true);
                            setEditPreventScreenshot(activeNovel.preventScreenshot === true);
                            setProtectionMessage("");
                          }
                          setWorkspaceTab(tab.id as any);
                        }}
                        role="tab"
                        aria-selected={workspaceTab === tab.id}
                        className={`flex shrink-0 snap-start items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold shadow-sm transition-all cursor-pointer min-h-10 ${
                          workspaceTab === tab.id
                            ? "bg-violet-600 text-white font-black"
                            : "text-slate-550 dark:text-slate-400 hover:text-white"
                        }`}
                      >
                        <tab.icon className="w-3.5 h-3.5 shrink-0" />
                        <span>{tab.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {chError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl font-semibold">
                    {chError}
                  </div>
                )}

                {/* ANIMATED CHANNELS OF TAB VIEWING */}
                <AnimatePresence mode="wait">
                  {workspaceTab === "write" && (
                    <motion.div 
                       key="tab-write"
                       initial={{ opacity: 0, y: 10 }}
                       animate={{ opacity: 1, y: 0 }}
                       exit={{ opacity: 0, y: -10 }}
                       transition={{ duration: 0.2 }}
                       className="space-y-5"
                    >
                      {editingChapterId && (activeNovel?.chapters?.find(c => c.id === editingChapterId) as any)?.editor_note && (
                        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-500 text-[11px] font-mono text-start">
                          <strong className="text-amber-400 font-black">بازخورد سردبیر برای این فصل:</strong> {(activeNovel?.chapters?.find(c => c.id === editingChapterId) as any)?.editor_note}
                        </div>
                      )}

                      {editingChapterId && (
                        <div className={`p-4 rounded-2xl border ${activeTheme.border} ${theme === "dark" ? "bg-slate-950/40" : "bg-stone-50"} space-y-3`}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <History className="w-4 h-4 text-violet-400" />
                              <h4 className="text-[11px] font-mono font-black uppercase text-slate-400">تاریخچه نسخه‌های فصل</h4>
                            </div>
                            <button
                              type="button"
                              onClick={() => loadChapterVersions()}
                              className="px-3 py-1.5 rounded-lg border border-violet-500/20 text-[10px] font-bold text-violet-400 hover:bg-violet-500/10 cursor-pointer"
                            >
                              {isLoadingVersions ? "در حال بارگذاری..." : "به‌روزرسانی"}
                            </button>
                          </div>
                          {versionStatus && <p className="text-[10px] text-emerald-400 font-mono">{versionStatus}</p>}
                          <div className="space-y-2 max-h-44 overflow-y-auto custom-scrollbar">
                            {chapterVersions.length ? chapterVersions.map((version) => (
                              <div key={version.id} className="flex items-center justify-between gap-3 p-2 rounded-xl bg-black/20 border border-slate-700/10">
                                <div className="min-w-0">
                                  <p className="text-xs font-bold truncate">{version.title}</p>
                                  <p className="text-[10px] text-slate-500 font-mono">{new Date(version.created_at).toLocaleString("fa-IR")} · {version.reason || "chapter-save"}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleRestoreVersion(version)}
                                    className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[10px] font-bold hover:bg-violet-500 cursor-pointer"
                                  >
                                    بازگردانی
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteVersion(version.id)}
                                    className="p-1.5 rounded-lg border border-rose-500/20 text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                                    title="حذف این پیش‌نویس ذخیره‌شده"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            )) : (
                              <p className="text-[10px] text-slate-500 font-mono">هنوز نسخه ذخیره‌شده‌ای وجود ندارد. با به‌روزرسانی یا حذف یک فصل موجود، نسخه جدید ساخته می‌شود.</p>
                            )}
                          </div>
                        </div>
                      )}

                      <div className={`rounded-2xl border p-4 ${activeTheme.border} ${theme === "dark" ? "bg-slate-950/30" : "bg-stone-50"}`}>
                        <p className="mb-3 text-[10px] font-mono font-black uppercase tracking-wider text-slate-400">نوع محتوا</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => setIsAuxiliaryChapter(false)}
                            className={`rounded-xl border p-3 text-start transition-all ${!isAuxiliaryChapter ? "border-violet-500 bg-violet-500/10 text-violet-400" : `${activeTheme.border} text-slate-500`}`}
                          >
                            <span className="block text-xs font-black">فصل معمولی</span>
                            <span className="mt-1 block text-[10px] opacity-75">بخشی از داستان اصلی، ترتیب خواندن و شمارش فصل‌ها.</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsAuxiliaryChapter(true)}
                            className={`rounded-xl border p-3 text-start transition-all ${isAuxiliaryChapter ? "border-violet-500 bg-violet-500/10 text-violet-400" : `${activeTheme.border} text-slate-500`}`}
                          >
                            <span className="block text-xs font-black">اطلاعات پیوست</span>
                            <span className="mt-1 block text-[10px] opacity-75">دانش تکمیلی، واژه‌نامه‌ها، نقشه‌ها، یادداشت‌های شخصیت‌ها یا سایر اطلاعات اختیاری.</span>
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="col-span-1">
                          <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                            {isAuxiliaryChapter ? "شماره پیوست" : "شماره اپیزود / فصل"}
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={chNumber}
                            onChange={(e) => setChNumber(parseInt(e.target.value) || 1)}
                            className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                              theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                            }`}
                          />
                        </div>

                        <div className="col-span-2">
                          <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                            عنوان فصل
                          </label>
                          <input
                            type="text"
                            required
                            value={chTitle}
                            onChange={(e) => setChTitle(e.target.value)}
                            className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                              theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900"
                            }`}
                          />
                        </div>
                      </div>

                      {/* Release pathway controls */}
                      <div className={`p-4 rounded-2xl border ${activeTheme.border} ${theme === "dark" ? "bg-slate-900/40" : "bg-slate-50"} space-y-4`}>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <h4 className="text-[11px] font-mono font-bold text-slate-400 tracking-wider">
                              وضعیت انتشار فصل
                            </h4>
                            <p className="text-[10px] text-slate-500">انتخاب کنید این فصل هنگام انتشار چگونه رفتار کند</p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {[
                              { id: "Published", label: activeNovelApprovalStatus === "approved" ? "انتشار فوری" : "انتشار پس از تأیید رمان", color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" },
                              { id: "Draft", label: "ذخیره به عنوان پیش‌نویس خصوصی", color: "border-amber-500/30 bg-amber-500/10 text-amber-500" },
                              { id: "Scheduled", label: "زمان‌بندی انتشار خودکار", color: "border-violet-500/30 bg-violet-500/10 text-violet-400" }
                            ].map((choice) => {
                              const isSel = chStatus === choice.id;
                              return (
                                <button
                                  type="button"
                                  key={choice.id}
                                  onClick={() => {
                                    setChStatus(choice.id as any);
                                    if (choice.id !== "Scheduled") setChScheduledAt("");
                                  }}
                                  className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer ${
                                    isSel ? choice.color : "border-slate-800/10 dark:border-violet-900/10 text-slate-400 hover:text-slate-200"
                                  }`}
                                >
                                  {choice.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {chStatus === "Scheduled" && (
                          <div className="p-3.5 rounded-xl bg-black/40 border border-violet-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-2 text-xs font-mono text-violet-400">
                               <Calendar className="w-4 h-4 text-violet-400 shrink-0" />
                               <span>تاریخ/زمان هدف برای انتشار زمان‌بندی‌شده:</span>
                            </div>
                            <input
                              type="datetime-local"
                              required
                              min={minimumScheduledDateTimeInput()}
                              value={chScheduledAt}
                              onChange={(e) => setChScheduledAt(e.target.value)}
                              className={`p-2 text-xs font-mono rounded-lg border focus:outline-none focus:border-violet-500 ${
                                theme === "dark" 
                                  ? "bg-black border-violet-950 text-violet-300"
                                  : "bg-white border-stone-200 text-stone-900"
                              }`}
                            />
                            <span className="text-[9px] text-slate-500">زمان محلی دستگاه: {browserTimeZoneLabel()}؛ سرور آن را با منطقهٔ زمانی صحیح ذخیره می‌کند.</span>
                          </div>
                        )}
                      </div>

                      <section className={`space-y-3 rounded-2xl border p-4 ${activeTheme.border} ${theme === "dark" ? "bg-slate-950/35" : "bg-stone-50"}`}>
                        <div className="flex items-start gap-3">
                          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                          <div>
                            <h4 className="text-xs font-black">محافظت اختصاصی این فصل</h4>
                            <p className="mt-1 text-[10px] leading-5 text-slate-500">این گزینه‌ها علاوه بر سیاست کلی داستان اعمال می‌شوند و همراه همین فصل ذخیره خواهند شد.</p>
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${chPreventCopy ? "border-rose-500/50 bg-rose-500/10" : activeTheme.border}`}>
                            <input type="checkbox" checked={chPreventCopy} onChange={(event) => setChPreventCopy(event.target.checked)} className="mt-0.5 h-4 w-4 accent-rose-500" />
                            <span><strong className="block text-xs">قفل کپی این فصل</strong><span className="mt-1 block text-[10px] leading-5 text-slate-500">انتخاب متن، میان‌بر کپی، منوی راست‌کلیک، Drag و چاپ محتوا محدود می‌شود.</span></span>
                          </label>
                          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${chPreventScreenshot ? "border-amber-500/50 bg-amber-500/10" : activeTheme.border}`}>
                            <input type="checkbox" checked={chPreventScreenshot} onChange={(event) => setChPreventScreenshot(event.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-500" />
                            <span><strong className="block text-xs">محافظت تصویری این فصل</strong><span className="mt-1 block text-[10px] leading-5 text-slate-500">واترمارک خواننده و پوشش امنیتی هنگام خروج فوکوس فعال می‌شود؛ مرورگر اجازهٔ قفل سخت اسکرین‌شات سیستم را نمی‌دهد.</span></span>
                          </label>
                        </div>
                      </section>

                      {/* Manga chapters are built from ordered image pages, so the
                          prose canvas and its word goal are replaced by the page
                          editor. Everything else about the chapter (number, title,
                          release status, notes) is shared with prose. */}
                      {isMangaNovel ? (
                        <div className="space-y-4">
                          <div className={`rounded-2xl border p-4 ${activeTheme.border} ${theme === "dark" ? "bg-slate-900/40" : "bg-slate-50"} space-y-2`}>
                            <p className="text-[11px] font-mono font-black uppercase tracking-wider text-violet-400">استودیوی مانگا</p>
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                              صفحه‌های این فصل را بارگذاری کنید، با کشیدن ترتیب‌شان را تغییر دهید، صفحه‌های گسترده را علامت بزنید و برای هر صفحه متن جانشین بنویسید.
                              {" "}
                              فصل تا زمانی که حداقل یک صفحه نداشته باشد منتشر نمی‌شود.
                            </p>
                            {!editingChapterId && (
                              <p className="text-[11px] font-bold text-amber-500">
                                با افزودن نخستین صفحه، این فصل به‌صورت پیش‌نویس ساخته می‌شود.
                              </p>
                            )}
                          </div>

                          <MangaPageEditor
                            novelId={activeNovel!.id}
                            chapterId={editingChapterId}
                            chapterTitle={chTitle.trim() || `فصل ${chNumber}`}
                            theme={theme}
                            readingDirection={activeReadingDirection}
                            readOnly={!activeNovelChaptersHydrated}
                            ensureChapter={ensureMangaChapter}
                            onPageCountChange={handleMangaPageCountChange}
                            onPreview={(pages) => setMangaPreviewPages(pages)}
                          />
                        </div>
                      ) : (() => {
                        const plainChContentText = chContent.replace(/<[^>]*>/g, " ");
                        const activeWords = plainChContentText.split(/\s+/).filter(Boolean).length;
                        const completionPercent = Math.min(100, Math.round((activeWords / targetWordCount) * 100));

                        return (
                          <>
                            <div className={`p-4 rounded-xl border ${activeTheme.border} ${theme === "dark" ? "bg-slate-900/40" : "bg-slate-50"} flex flex-col md:flex-row md:flex-wrap md:items-center justify-between gap-4 text-xs font-mono`}>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-slate-400 font-bold uppercase">هدف تعداد کلمات:</span>
                                <select 
                                  value={targetWordCount}
                                  onChange={(e) => setTargetWordCount(Number(e.target.value))}
                                  className="p-1.5 dark:bg-black dark:border-violet-950 rounded-lg font-bold cursor-pointer font-mono max-w-full"
                                >
                                  <option value={200}>200 کلمه (اپیزود مینی)</option>
                                  <option value={500}>500 کلمه (فصل کوتاه)</option>
                                  <option value={1000}>1,000 کلمه (فصل استاندارد)</option>
                                  <option value={2000}>2,000 کلمه (فصل کامل حماسی)</option>
                                </select>
                              </div>
                              
                              <div className="flex-1 max-w-sm space-y-1 w-full">
                                <div className="flex justify-between font-bold text-slate-500 scale-95">
                                  <span>پیشرفت هدف کلمات پیش‌نویس:</span>
                                  <span>{completionPercent}% ({activeWords} از {targetWordCount} کلمه)</span>
                                </div>
                                <div className="w-full bg-slate-800/20 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                  <div 
                                    className="bg-violet-500 h-full rounded-full transition-all duration-300" 
                                    style={{ width: `${completionPercent}%` }}
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Tiptap custom workspace */}
                            <div className="space-y-1.5">
                              <label className="block text-[11px] font-black text-slate-500 font-mono">
                                بوم خلاق (بهینه برای رمان‌های وبی)
                              </label>
                              <TiptapEditor
                                content={chContent}
                                onChange={setChContent}
                                theme={theme}
                                readOnly={!activeNovelChaptersHydrated}
                                targetWordCount={targetWordCount}
                                bookMode={bookMode}
                              />
                            </div>
                          </>
                        );
                      })()}

                      {/* Author Top/Bottom notes */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                        <div>
                          <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                             یادداشت ابتدای فصل (خوش‌آمدگویی به خوانندگان در آغاز فصل)
                          </label>
                          <textarea
                            rows={2}
                            value={authNotesTop}
                            onChange={(e) => setAuthNotesTop(e.target.value)}
                            placeholder="مثلاً: ممنون که همراه شدید. نظرتان را در دیدگاه‌های پایین بنویسید!"
                            className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all resize-none leading-relaxed ${
                              theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900"
                            }`}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                            یادداشت پایانی نویسنده (سخن آخر و درخواست دیدگاه)
                          </label>
                          <textarea
                            rows={2}
                            value={authNotesBottom}
                            onChange={(e) => setAuthNotesBottom(e.target.value)}
                            placeholder="مثلاً: ذخیره کردن و امتیاز دادن را فراموش نکنید! از داستان لذت ببرید!"
                            className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all resize-none leading-relaxed ${
                              theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900"
                            }`}
                          />
                        </div>
                      </div>

                      {/* Syndicate Submit button */}
                      <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-slate-900/10 dark:border-violet-950/20">
                        {isSavedNotify && (
                          <div className="text-emerald-500 font-mono text-xs font-black animate-pulse flex items-center gap-1">
                            <Check className="w-4 h-4 text-emerald-400" />
                            <span>فصل با موفقیت ذخیره شد.</span>
                          </div>
                        )}
                        
                        {isMangaNovel && chStatus !== "Draft" && mangaPageCount < 1 && mangaPageCountsLoaded && (
                          <span className="self-center text-[11px] font-bold text-amber-500">
                            برای انتشار، حداقل یک صفحه بارگذاری کنید.
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={handlePublishChapter}
                          disabled={isSavingChapter || (isMangaNovel && chStatus !== "Draft" && mangaPageCount < 1)}
                          className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-extrabold text-xs rounded-xl transition-all shadow-md cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isSavingChapter ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                          <span>
                            {isSavingChapter
                              ? "در حال ذخیره..."
                              : chStatus === "Draft"
                                ? editingChapterId ? "به‌روزرسانی پیش‌نویس" : "ذخیره پیش‌نویس"
                                : chStatus === "Scheduled"
                                  ? editingChapterId ? "به‌روزرسانی زمان‌بندی" : "ذخیره زمان‌بندی"
                                  : isMangaNovel
                                    ? editingChapterId ? "انتشار این فصل مانگا" : "ذخیره و انتشار فصل مانگا"
                                    : editingChapterId ? "به‌روزرسانی اپیزود" : "ذخیره و انتشار اپیزود"}
                          </span>
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {workspaceTab === "security" && activeNovel && (
                    <motion.div
                      key="tab-security"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-5"
                    >
                      <div className={`rounded-2xl border p-4 sm:p-5 ${activeTheme.border} ${theme === "dark" ? "bg-slate-950/35" : "bg-stone-50"}`}>
                        <div className="flex items-start gap-3">
                          <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-amber-500" />
                          <div>
                            <h3 className="text-sm font-black">قفل و محافظت محتوای داستان</h3>
                            <p className="mt-1 text-[11px] leading-6 text-slate-500">قفل کلی روی تمام فصل‌ها اعمال می‌شود. تنظیم هر فصل در بخش پایین مستقل است و می‌تواند محافظت بیشتری اضافه کند.</p>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${editPreventCopy ? "border-rose-500/50 bg-rose-500/10" : activeTheme.border}`}>
                            <input type="checkbox" checked={editPreventCopy} onChange={(event) => setEditPreventCopy(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-rose-500" />
                            <span><strong className="block text-xs">فعال‌کردن ضد کپی برای کل داستان</strong><span className="mt-1 block text-[10px] leading-5 text-slate-500">انتخاب متن، Copy/Cut، راست‌کلیک، Drag و چاپ متن همهٔ فصل‌ها بسته می‌شود.</span></span>
                          </label>
                          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${editPreventScreenshot ? "border-amber-500/50 bg-amber-500/10" : activeTheme.border}`}>
                            <input type="checkbox" checked={editPreventScreenshot} onChange={(event) => setEditPreventScreenshot(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-amber-500" />
                            <span><strong className="block text-xs">فعال‌کردن محافظت تصویری برای کل داستان</strong><span className="mt-1 block text-[10px] leading-5 text-slate-500">واترمارک خواننده و پوشش امنیتی فعال می‌شود. مسدودسازی کامل اسکرین‌شات سیستم‌عامل در وب ممکن نیست.</span></span>
                          </label>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <button type="button" onClick={() => void saveStoryProtection()} disabled={!!protectionSavingId} className="rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-black text-white transition-colors hover:bg-violet-500 disabled:cursor-wait disabled:opacity-50">
                            {protectionSavingId === "story" ? "در حال ذخیره…" : "ذخیره قفل کل داستان"}
                          </button>
                          <span className="text-[10px] leading-5 text-amber-500">تغییر کل داستان فقط پس از زدن این دکمه اعمال می‌شود.</span>
                        </div>
                      </div>

                      <section className={`rounded-2xl border p-4 sm:p-5 ${activeTheme.border}`}>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                          <div><h3 className="text-xs font-black">قفل جداگانهٔ فصل‌ها</h3><p className="mt-1 text-[10px] text-slate-500">هر تغییر فصل همان لحظه در دیتابیس ذخیره می‌شود.</p></div>
                          <span className="rounded-full bg-violet-500/10 px-3 py-1 text-[10px] font-black text-violet-400">{(activeNovel.chapters || []).length.toLocaleString("fa-IR")} فصل</span>
                        </div>
                        <div className="space-y-2">
                          {(activeNovel.chapters || []).length ? [...activeNovel.chapters].sort((a, b) => a.chapterNumber - b.chapterNumber).map((chapter) => (
                            <article key={chapter.id} className={`grid gap-3 rounded-xl border p-3 ${activeTheme.border} sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center`}>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-black">فصل {chapter.chapterNumber.toLocaleString("fa-IR")} · {chapter.title}</p>
                                {(activeNovel.preventCopy || activeNovel.preventScreenshot) && <p className="mt-1 text-[9px] font-bold text-amber-500">محافظت کلی داستان نیز روی این فصل فعال است.</p>}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <button type="button" disabled={!!protectionSavingId} aria-pressed={chapter.preventCopy === true} onClick={() => void saveChapterProtection(chapter, { preventCopy: chapter.preventCopy !== true, preventScreenshot: chapter.preventScreenshot === true })} className={`min-h-10 rounded-lg border px-3 text-[10px] font-black transition-colors disabled:opacity-50 ${chapter.preventCopy ? "border-rose-500 bg-rose-500/15 text-rose-400" : `${activeTheme.border} text-slate-500`}`}>
                                  {protectionSavingId === chapter.id ? "ذخیره…" : chapter.preventCopy ? "کپی: قفل" : "کپی: آزاد"}
                                </button>
                                <button type="button" disabled={!!protectionSavingId} aria-pressed={chapter.preventScreenshot === true} onClick={() => void saveChapterProtection(chapter, { preventCopy: chapter.preventCopy === true, preventScreenshot: chapter.preventScreenshot !== true })} className={`min-h-10 rounded-lg border px-3 text-[10px] font-black transition-colors disabled:opacity-50 ${chapter.preventScreenshot ? "border-amber-500 bg-amber-500/15 text-amber-500" : `${activeTheme.border} text-slate-500`}`}>
                                  {protectionSavingId === chapter.id ? "ذخیره…" : chapter.preventScreenshot ? "تصویر: محافظت" : "تصویر: آزاد"}
                                </button>
                              </div>
                            </article>
                          )) : <p className="rounded-xl border border-dashed border-slate-500/20 p-8 text-center text-xs text-slate-500">هنوز فصلی برای تنظیم محافظت وجود ندارد.</p>}
                        </div>
                      </section>

                      {protectionMessage && <p role="status" className={`rounded-xl border p-3 text-xs font-bold ${/نشد|ناموفق/.test(protectionMessage) ? "border-rose-500/30 bg-rose-500/10 text-rose-400" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"}`}>{protectionMessage}</p>}
                    </motion.div>
                  )}

                  {workspaceTab === "preview" && (
                    <motion.div 
                      key="tab-preview"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className={`p-6 rounded-2xl border max-h-[65vh] overflow-y-auto space-y-6 bg-gradient-to-br ${
                        theme === "dark" ? "from-[#060409] to-[#0b0716] text-violet-105/90 border-violet-950/40" : "from-white to-stone-50 text-stone-900 border-stone-200"
                      }`}
                    >
                      <div className="text-center pb-4 border-b border-dashed border-slate-700/20">
                        <span className="text-[10px] font-mono font-bold text-violet-500 uppercase tracking-widest block">
                          پیش‌نمایش زنده برای خواننده • اپیزود {chNumber}
                        </span>
                        <h2 className="text-2xl font-black tracking-tight mt-1">
                          {chTitle || `${isAuxiliaryChapter ? "پیوست" : "فصل"} ${chNumber}`}
                        </h2>
                      </div>

                      <div className="leading-relaxed text-justify space-y-4 px-1 md:px-4">
                        {authNotesTop.trim().length > 0 && (
                          <div className="p-4 rounded-xl border border-violet-500/10 bg-violet-500/5 text-slate-400 text-xs italic space-y-1 mb-4">
                            <span className="font-mono font-bold text-violet-400 not-italic block uppercase text-[10px]">یادداشت آغازین نویسنده:</span>
                            <p>{authNotesTop}</p>
                          </div>
                        )}

                        {/* A manga chapter is previewed in the reader that will
                            actually present it, so the author checks the page
                            order and the turn direction exactly as readers see
                            them. */}
                        {isMangaNovel ? (
                          editingChapterId ? (
                            <MangaChapterPreview
                              novelId={activeNovel!.id}
                              chapterId={editingChapterId}
                              chapterTitle={chTitle.trim() || `فصل ${chNumber}`}
                              chapterNumber={chNumber}
                              novelTitle={activeNovel!.title}
                              readingDirection={activeReadingDirection}
                              theme={theme}
                            />
                          ) : (
                            <div className="p-12 text-center text-slate-550 text-xs italic">
                              پس از ساخت فصل و افزودن صفحه‌ها، پیش‌نمایش خواننده اینجا نمایش داده می‌شود.
                            </div>
                          )
                        ) : chContent.trim().length > 0 ? (
                          <div
                            className="chapter-story-body prose dark:prose-invert text-slate-350 max-w-none break-words font-sans leading-loose space-y-3 text-justify"
                            dir="rtl"
                            dangerouslySetInnerHTML={{ __html: sanitizePreviewHtml(chContent) }}
                          />
                        ) : (
                          <div className="p-12 text-center text-slate-550 text-xs italic">
                            بوم محتوا خالی است. به تب «نگارش» برگردید و شروع به نوشتن کنید!
                          </div>
                        )}

                        {authNotesBottom.trim().length > 0 && (
                          <div className="p-4 rounded-xl border border-violet-500/10 bg-violet-500/5 text-slate-400 text-xs italic space-y-1 mt-6">
                            <span className="font-mono font-bold text-violet-400 not-italic block uppercase text-[10px]">سخن پایانی نویسنده:</span>
                            <p>{authNotesBottom}</p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {workspaceTab === "characters" && (
                    <motion.div 
                      key="tab-characters"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-6"
                    >
                      <div className="flex items-center justify-between border-b border-slate-900/10 dark:border-violet-950/20 pb-2">
                        <h4 className="text-xs font-mono font-bold uppercase text-slate-400">گروه شخصیت‌ها و آرشیو جهان داستانی رمان</h4>
                        <span className="text-[10px] text-violet-400 font-mono">({characters.length} شخصیت ثبت شده)</span>
                      </div>

                      {/* Character Cards list */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {characters.map((char) => (
                          <div key={char.id} className={`p-4 rounded-2xl border ${activeTheme.border} ${theme === "dark" ? "bg-slate-900/35" : "bg-stone-50"} space-y-1.5 relative group text-start`}>
                            <div className="flex gap-3 pr-16">
                              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-violet-500/10 flex items-center justify-center">
                                {char.imageUrl ? <SafeImage src={char.imageUrl} alt={char.name} className="h-full w-full object-cover" /> : <Users className="h-7 w-7 text-violet-400" />}
                              </div>
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <div className="flex flex-wrap justify-between gap-2"><h5 className="font-extrabold text-sm text-slate-900 dark:text-violet-100">{char.name}</h5><span className="text-[9px] font-mono font-bold text-amber-500 bg-amber-500/10 px-2 py-1 rounded-md uppercase">{char.role}</span></div>
                                <p className="text-xs text-slate-450 leading-relaxed font-sans">{char.bio}</p>
                              </div>
                            </div>
                            <div className="absolute bottom-2 right-2 flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCharacterId(char.id);
                                setNewCharName(char.name || "");
                                setNewCharRole(char.role || "");
                                setNewCharBio(char.bio || "");
                                setNewCharImageUrl(char.imageUrl || "");
                                setCharacterError("");
                              }}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-violet-400 transition-colors hover:bg-violet-500/10 hover:text-violet-300"
                              title="ویرایش شخصیت"
                              aria-label={`ویرایش ${char.name}`}
                            >
                              <Pencil className="h-3 w-3" /> ویرایش
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const newChars = characters.filter((c) => c.id !== char.id);
                                setCharacters(newChars);
                                if (editingCharacterId === char.id) resetCharacterForm();
                                if (activeNovel && onUpdateNovel) {
                                  onUpdateNovel({ ...activeNovel, characters: newChars });
                                }
                              }}
                              className="p-1 text-[10px] text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                              title="حذف پروفایل"
                              aria-label={`حذف ${char.name}`}
                            >
                              ✕
                            </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Register characters */}
                      <div className={`p-4 rounded-2xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#090b16]/80" : "bg-white"} space-y-4 text-start`}>
                        <h5 className="font-black text-xs uppercase tracking-wider text-slate-800 dark:text-slate-300 font-mono flex items-center gap-1.5">
                          <Plus className="w-4 h-4" />
                          <span>{editingCharacterId ? "ویرایش پروفایل شخصیت" : "افزودن پروفایل شخصیت جدید"}</span>
                        </h5>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <input
                            type="text"
                            value={newCharName}
                            onChange={(e) => setNewCharName(e.target.value)}
                            placeholder="نام کامل شخصیت (مثلاً اتان ونس)"
                            className={`p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                              theme === "dark" ? "bg-black border-violet-950 text-white" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-violet-500"
                            }`}
                          />
                          <input
                            type="text"
                            value={newCharRole}
                            onChange={(e) => setNewCharRole(e.target.value)}
                            placeholder="نقش / کلاس در داستان (مثلاً فرمانروای سایه‌ها)"
                            className={`p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                              theme === "dark" ? "bg-black border-violet-950 text-white" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-violet-500"
                            }`}
                          />
                        </div>

                        <textarea
                          rows={2}
                          value={newCharBio}
                          onChange={(e) => setNewCharBio(e.target.value)}
                          placeholder="جزئیات بیوگرافی، ویژگی‌های جادویی، گنج‌ها یا پیوندها با قهرمان اصلی..."
                          className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all resize-none leading-relaxed ${
                            theme === "dark" ? "bg-black border-violet-950 text-white" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-violet-500"
                          }`}
                        />

                        <div className="flex flex-wrap items-center gap-3">
                          {newCharImageUrl && <SafeImage src={newCharImageUrl} alt="شخصیت جدید" className="h-20 w-20 rounded-xl object-cover" />}
                          <button type="button" onClick={() => setIsCharacterCropOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-violet-500/30 px-4 py-2 text-xs font-bold text-violet-400 hover:bg-violet-500/10"><Upload className="h-4 w-4" />{newCharImageUrl ? "تغییر تصویر" : "افزودن تصویر (اختیاری)"}</button>
                          {newCharImageUrl && <button type="button" onClick={() => setNewCharImageUrl("")} className="text-xs font-bold text-rose-400">حذف</button>}
                        </div>

                        {characterError && <p className="text-xs font-bold text-rose-400" role="alert">{characterError}</p>}

                        <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isSavingCharacter}
                          onClick={async () => {
                            if (!newCharName.trim()) {
                              setCharacterError("نام شخصیت الزامی است.");
                              return;
                            }
                            const savedCharacter = {
                              id: editingCharacterId || Date.now().toString(),
                              name: newCharName.trim(),
                              role: newCharRole || "شخصیت مکمل",
                              bio: newCharBio || "هنوز جزئیاتی ثبت نشده است.",
                              imageUrl: newCharImageUrl || undefined
                            };
                            const newChars = editingCharacterId
                              ? characters.map((character) => character.id === editingCharacterId ? savedCharacter : character)
                              : [...characters, savedCharacter];
                            setIsSavingCharacter(true);
                            setCharacterError("");
                            try {
                              if (activeNovel && onUpdateNovel) {
                                await onUpdateNovel({ ...activeNovel, characters: newChars });
                              }
                              setCharacters(newChars);
                              resetCharacterForm();
                            } catch (error) {
                              setCharacterError(error instanceof Error ? error.message : "ذخیره این شخصیت ممکن نشد.");
                            } finally {
                              setIsSavingCharacter(false);
                            }
                          }}
                          className="px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white font-bold font-mono text-xs uppercase rounded-xl cursor-pointer transition-all disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSavingCharacter ? "در حال ذخیره…" : editingCharacterId ? "ذخیره شخصیت" : "ثبت در گروه"}
                        </button>
                        {editingCharacterId && (
                          <button type="button" disabled={isSavingCharacter} onClick={resetCharacterForm} className="rounded-xl border border-slate-500/30 px-5 py-2 text-xs font-bold text-slate-400 hover:bg-slate-500/10">
                            لغو ویرایش
                          </button>
                        )}
                        </div>
                      </div>
                      <CharacterImageCropModal isOpen={isCharacterCropOpen} onClose={() => setIsCharacterCropOpen(false)} onSave={setNewCharImageUrl} />
                    </motion.div>
                  )}

                  {workspaceTab === "metadata" && activeNovel && (
                    <motion.div 
                      key="tab-metadata"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-6 text-start"
                    >
                      <div className="flex items-center justify-between border-b border-slate-900/10 dark:border-violet-950/20 pb-2">
                        <h4 className="text-xs font-mono font-bold uppercase text-slate-400 font-black">ویرایش مشخصات و متادیتای رمان</h4>
                        <span className="text-[10px] text-violet-400 font-mono">شناسه سیستمی: #{activeNovel.id.slice(0, 8).toUpperCase()}</span>
                      </div>

                      <form 
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!editBookTitle.trim() || !editBookAuthor.trim() || editBookDesc.trim().length < 15) return;
                          const nextCover = editBookCover || activeNovel.cover || activeNovel.coverUrl || "";
                          
                          const updatedNovel: Novel = {
                            ...activeNovel,
                            title: editBookTitle,
                            author: editBookAuthor,
                            genre: editBookGenre,
                            description: editBookDesc,
                            cover: nextCover,
                            coverUrl: nextCover,
                            tags: filterTaxonomyList(editBookTags.split(",").map(t => t.trim()).filter(Boolean)),
                            warnings: filterTaxonomyList(editBookWarnings),
                            originType: editOriginType,
                            originalAuthor: editOriginType === "translated" ? editOriginalAuthor.trim() : "",
                            translators: editOriginType === "translated" ? editTranslators.split(/[,،]/).map(t => t.trim()).filter(Boolean) : [],
                            // The work's format is immutable; only the page-turn
                            // direction of a manga stays editable.
                            readingDirection: isMangaNovel ? editReadingDirection : activeNovel.readingDirection,
                            premiumPresentation: editPremiumPresentation,
                            preventCopy: editPreventCopy,
                            preventScreenshot: editPreventScreenshot,
                          };
                          try {
                            await onUpdateNovel?.(updatedNovel);
                            setIsBookMetaDataSaved(true);
                            setTimeout(() => setIsBookMetaDataSaved(false), 3000);
                          } catch (error) {
                            window.alert(error instanceof Error ? error.message : "به‌روزرسانی جزئیات داستان ناموفق بود.");
                          }
                        }}
                        className="space-y-4"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">عنوان رمان</label>
                            <input
                              type="text"
                              required
                              value={editBookTitle}
                              onChange={(e) => setEditBookTitle(e.target.value)}
                              className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                                theme === "dark" ? "bg-black border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                              }`}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">نام مستعار نویسنده</label>
                            <input
                              type="text"
                              required
                              value={editBookAuthor}
                              onChange={(e) => setEditBookAuthor(e.target.value)}
                              className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                                theme === "dark" ? "bg-black border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                              }`}
                            />
                          </div>
                        </div>

                        {isMangaNovel && (
                          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-violet-950/30 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">قالب اثر</label>
                              <span className="rounded-lg bg-violet-500/10 px-2 py-1 text-[10px] font-black text-violet-400">مانگا / کمیک — قابل تغییر نیست</span>
                            </div>
                            <div>
                              <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">ترتیب خواندن صفحه‌ها</label>
                              <div className="mt-1.5 grid grid-cols-2 gap-2">
                                {[
                                  { id: "rtl", label: "راست به چپ" },
                                  { id: "ltr", label: "چپ به راست" }
                                ].map((option) => (
                                  <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => setEditReadingDirection(option.id as ReadingDirection)}
                                    className={`p-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                                      editReadingDirection === option.id
                                        ? "border-violet-500 bg-violet-500/10 text-violet-400"
                                        : "border-stone-200 dark:border-violet-950 hover:border-violet-400"
                                    }`}
                                    aria-pressed={editReadingDirection === option.id}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 gap-4 rounded-2xl border border-violet-950/30 p-4">
                          <div>
                            <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">نوع اثر</label>
                            <div className="mt-1.5 grid grid-cols-2 gap-2">
                              {[
                                { id: "original", label: "اورجینال" },
                                { id: "translated", label: "ترجمه‌شده" }
                              ].map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => setEditOriginType(option.id as any)}
                                  className={`p-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                                    editOriginType === option.id
                                      ? "border-violet-500 bg-violet-500/10 text-violet-400"
                                      : "border-stone-200 dark:border-violet-950 hover:border-violet-400"
                                  }`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          {editOriginType === "translated" && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">نویسندهٔ اثر اصلی *</label>
                                <input
                                  type="text"
                                  value={editOriginalAuthor}
                                  onChange={(e) => setEditOriginalAuthor(e.target.value)}
                                  maxLength={80}
                                  placeholder="مثلاً، Brandon Sanderson"
                                  className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                                    theme === "dark" ? "bg-black border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                                  }`}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">مترجم / مترجمان * (با ویرگول)</label>
                                <input
                                  type="text"
                                  value={editTranslators}
                                  onChange={(e) => setEditTranslators(e.target.value)}
                                  placeholder="مثلاً، سارا محمدی، رضا کریمی"
                                  className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                                    theme === "dark" ? "bg-black border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                                  }`}
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">ژانر اصلی (فیلتر صفحه اصلی)</label>
                            <select
                              value={editBookGenre}
                              onChange={(e) => setEditBookGenre(e.target.value)}
                              className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                                theme === "dark" ? "bg-black border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900"
                              }`}
                            >
                              <option value="" disabled>ژانر اصلی را انتخاب کنید</option>
                              {MAIN_CATEGORIES.map((g) => (
                                <option key={g} value={g}>{g}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">طراحی جلد</label>
                            
                            <div className="flex gap-3 items-center">
                              {/* Inline Custom Upload Zone */}
                              <div 
                                onClick={openEditCoverModal}
                                className={`border border-dashed rounded-xl p-2.5 text-center flex-1 text-[11px] font-bold cursor-pointer transition-all flex items-center justify-center gap-1.5 border-slate-880 dark:border-violet-900/30 bg-black/5 hover:border-slate-700`}
                              >
                                <Upload className="w-3.5 h-3.5 text-slate-505" />
                                <span>ویرایش / بارگذاری جلد</span>
                              </div>

                              <SafeImage
                                src={editBookCover}
                                alt="پیش‌نمایش جلد"
                                className="w-9 h-12 object-cover rounded-lg shadow border border-slate-800 shrink-0"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">برچسب‌ها و مضمون‌های مجموعه (با کاما جدا شوند)</label>
                          <input
                            type="text"
                            placeholder="فانتزی، انتقام، ریتم آهسته"
                            value={editBookTags}
                            onChange={(e) => setEditBookTags(e.target.value)}
                            className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                              theme === "dark" ? "bg-black border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900"
                            }`}
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">خلاصه داستان</label>
                          <textarea
                            rows={4}
                            required
                            value={editBookDesc}
                            onChange={(e) => setEditBookDesc(e.target.value)}
                            className={`w-full p-3 text-xs rounded-xl border focus:outline-none transition-all leading-loose ${
                              theme === "dark" ? "bg-black border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900"
                            }`}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">برچسب‌های هشدار و محتوای حساس</label>
                          <div className="flex flex-wrap gap-2.5">
                            {CONTENT_WARNINGS.map((warning) => {
                              const isChecked = editBookWarnings.includes(warning.id);
                              return (
                                <button
                                  type="button"
                                  key={warning.id}
                                  onClick={() => {
                                    if (isChecked) {
                                      setEditBookWarnings(editBookWarnings.filter((value) => value !== warning.id));
                                    } else {
                                      setEditBookWarnings([...editBookWarnings, warning.id]);
                                    }
                                  }}
                                  title={warning.desc}
                                  className={`p-2 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                                    isChecked 
                                      ? "bg-rose-500/15 border-rose-500/30 text-rose-400" 
                                      : "bg-slate-500/5 border-slate-800/10 text-slate-400 hover:text-slate-200"
                                  }`}
                                >
                                  <span>{isChecked ? "✔" : "✦"}</span>
                                  <span>{warning.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <section className="space-y-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h5 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-amber-500"><Sparkles className="h-4 w-4" />نمایش ویژه (پریمیوم)</h5>
                              <p className="mt-1 text-[11px] text-slate-500">یک حال‌وهوای آماده انتخاب کنید. غیرفعال کردن جلوه‌ها هرگز جلد یا داده‌های داستان شما را حذف نمی‌کند.</p>
                            </div>
                            <label className="flex items-center gap-2 text-xs font-bold">
                              <input
                                type="checkbox"
                                checked={editPremiumPresentation.enabled}
                                disabled={!currentUser?.has_writer_premium && !editPremiumPresentation.enabled}
                                onChange={(event) => setEditPremiumPresentation((current) => ({ ...current, enabled: event.target.checked }))}
                                className="h-4 w-4 accent-amber-500"
                              />
                              فعال‌سازی جلوه‌ها
                            </label>
                          </div>
                          {!currentUser?.has_writer_premium && (
                            <p className="rounded-lg bg-slate-500/10 p-2 text-[10px] text-slate-500">برای فعال‌سازی قالب، اشتراک پریمیوم نویسنده لازم است. انتخاب ذخیره‌شده همچنان برای غیرفعال‌سازی در دسترس می‌ماند.</p>
                          )}
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                            {PREMIUM_TEMPLATES.map((template) => (
                              <button
                                key={template.id}
                                type="button"
                                onClick={() => setEditPremiumPresentation((current) => ({ ...current, templateId: template.id }))}
                                aria-pressed={editPremiumPresentation.templateId === template.id}
                                className={`rounded-xl border p-2 text-start transition ${editPremiumPresentation.templateId === template.id ? "border-amber-400 ring-2 ring-amber-400/20" : "border-slate-500/20"}`}
                              >
                                <span className="mb-2 block h-10 rounded-lg" style={{ background: template.background }} />
                                <strong className="block text-[10px]">{template.name}</strong>
                              </button>
                            ))}
                          </div>
                          {(() => {
                            const template = premiumTemplateById(editPremiumPresentation.templateId);
                            const palette = editPremiumPresentation.palette || template.colors;
                            return (
                              <div className="relative overflow-hidden rounded-2xl border border-white/10 p-4 text-white shadow-xl" style={{ background: `radial-gradient(circle at 80% 15%,${palette.accent}33,transparent 35%),linear-gradient(135deg,${palette.primary},${palette.secondary})` }}>
                                <span className="text-[9px] font-black uppercase tracking-[.22em]" style={{ color: palette.accent }}>پیش‌نمایش زنده · {template.name}</span>
                                <div className="mt-3 flex items-center gap-3">
                                  <SafeImage src={editBookCover} alt="" className="h-20 w-14 rounded-lg object-cover shadow-2xl" />
                                  <div><strong className="block text-base">{editBookTitle || activeNovel.title}</strong><span className="text-[10px] text-white/70">{template.description}</span></div>
                                </div>
                              </div>
                            );
                          })()}
                        </section>

                        <section className={`space-y-3 rounded-2xl border p-4 ${activeTheme.border} ${theme === "dark" ? "bg-slate-950/35" : "bg-stone-50"}`}>
                          <div className="flex items-start gap-3">
                            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                            <div>
                              <h4 className="text-xs font-black">محافظت محتوای کل داستان</h4>
                              <p className="mt-1 text-[10px] leading-5 text-slate-500">این سیاست روی همهٔ فصل‌های داستان اعمال می‌شود. محدودیت اسکرین‌شات در وب بازدارنده است و مسدودسازی صددرصدی سیستم‌عامل نیست.</p>
                            </div>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${editPreventCopy ? "border-rose-500/50 bg-rose-500/10" : activeTheme.border}`}>
                              <input type="checkbox" checked={editPreventCopy} onChange={(event) => setEditPreventCopy(event.target.checked)} className="mt-0.5 h-4 w-4 accent-rose-500" />
                              <span><strong className="block text-xs">جلوگیری از کپی داستان</strong><span className="mt-1 block text-[10px] leading-5 text-slate-500">انتخاب متن، Copy/Cut، کشیدن محتوا، منوی راست‌کلیک و چاپ متن مسدود می‌شود.</span></span>
                            </label>
                            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${editPreventScreenshot ? "border-amber-500/50 bg-amber-500/10" : activeTheme.border}`}>
                              <input type="checkbox" checked={editPreventScreenshot} onChange={(event) => setEditPreventScreenshot(event.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-500" />
                              <span><strong className="block text-xs">محافظت تصویری داستان</strong><span className="mt-1 block text-[10px] leading-5 text-slate-500">واترمارک اختصاصی و پوشش هنگام خروج از صفحه فعال و خروجی چاپی مخفی می‌شود.</span></span>
                            </label>
                          </div>
                        </section>

                        <div className="flex flex-wrap items-center gap-3 pt-2">
                          <button
                            type="submit"
                            className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all flex items-center gap-1.5 cursor-pointer"
                          >
                            <Check className="w-4 h-4" />
                            <span>به‌روزرسانی متادیتای مجموعه</span>
                          </button>

                          {isBookMetaDataSaved && (
                            <span className="text-emerald-500 font-mono text-xs font-black animate-pulse">
                              ✔                               پروفایل مجموعه با موفقیت به‌روزرسانی و ذخیره شد!
                            </span>
                          )}
                        </div>
                      </form>
                    </motion.div>
                  )}

                  {workspaceTab === "analytics" && activeNovel && (
                    <motion.div 
                      key="tab-analytics"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-6 text-start"
                    >
                      <div className="flex items-center justify-between border-b border-purple-900/15 dark:border-violet-950/20 pb-2">
                        <h4 className="text-xs font-mono font-bold uppercase text-slate-400">آمار پیشرفته مجموعه و سنجه‌های ترافیک</h4>
                        <span className="text-[10px] text-violet-400 font-mono">{isAnalyticsLoading ? "در حال بارگذاری آمار رمان..." : "موتور سنجه‌های لحظه‌ای هر رمان"}</span>
                      </div>

                      {/* KPI cards grids */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                          { label: "بازدید صفحات", val: (analyticsSummary?.novel?.views ?? activeNovel.viewsCount ?? 0).toLocaleString(), icon: Eye, color: "text-violet-400 animate-none", change: `${analyticsSummary?.insights?.viewsLast30Days ?? 0} بازدید ثبت‌شده در 30 روز گذشته` },
                          { label: "میانگین بازدید / فصل", val: formatAverageViews(activeNovel.averageViews || 0), icon: BarChart3, color: "text-violet-400", change: `${activeNovel.publishedChapterCount || 0} فصل عمومی در مخرج` },
                          { label: "خوانندگان یکتا", val: (analyticsSummary?.totals?.uniqueReaders ?? 0).toLocaleString(), icon: Users, color: "text-fuchsia-400 animate-none", change: `${percentLabel(analyticsSummary?.totals?.returningReaderRate)} نشست احراز هویت‌شده` },
                          { label: "میانگین زمان مطالعه", val: `${analyticsSummary?.totals?.averageReadMinutes ?? 0} دقیقه`, icon: Clock, color: "text-emerald-400", change: `${formatDuration(analyticsSummary?.totals?.readSeconds || 0)} مجموع زمان مطالعه` },
                          { label: "نرخ تکمیل مطالعه", val: percentLabel(analyticsSummary?.totals?.completionRate), icon: Award, color: "text-amber-400", change: `${analyticsSummary?.totals?.averageScroll ?? 0}% میانگین عمق اسکرول` },
                          { label: "کشور برتر", val: analyticsSummary?.insights?.topCountry || "بدون داده", icon: Globe2, color: "text-purple-400 animate-none", change: `${percentLabel(analyticsSummary?.audience?.countries?.[0]?.percentage)} از سیگنال‌های مخاطبان` },
                          { label: "دستگاه برتر", val: analyticsSummary?.insights?.topDevice || "بدون داده", icon: Smartphone, color: "text-rose-400 animate-none", change: `${percentLabel(analyticsSummary?.audience?.devices?.[0]?.percentage)} سهم دستگاه‌ها` },
                          { label: "VPN / پروکسی", val: percentLabel(analyticsSummary?.audience?.vpnOrProxy?.percentage ?? analyticsSummary?.totals?.vpnOrProxyRate), icon: ShieldAlert, color: "text-orange-400", change: "در صورت تشخیص، «غیرقابل ردیابی» علامت می‌خورد" },
                          { label: "امتیاز / دیدگاه‌ها", val: `${activeNovel.rating || 0} / 5.0`, icon: Star, color: "text-yellow-400", change: `${analyticsSummary?.totals?.reviews ?? activeNovel.reviews?.length ?? 0} دیدگاه نوشته‌شده ثبت شده است` },
                        ].map((m, idx) => (
                          <div key={idx} className={`p-4 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-slate-900/35" : "bg-stone-55"} space-y-2 text-right shadow-sm`}>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono font-bold uppercase text-slate-500">{m.label}</span>
                              <m.icon className={`w-4 h-4 ${m.color}`} />
                            </div>
                            <div className="text-start">
                              <h3 className="text-xl font-black text-slate-100 dark:text-violet-50">{m.val}</h3>
                              <p className="text-[9px] font-bold text-emerald-400 mt-1">{m.change}</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Overall novel analysis */}
                      {(() => {
                        const axes = analyticsSummary?.ratingAxes;
                        const ci = analyticsSummary?.commentInsights;
                        const hasAxes = axes && Number(axes.count || 0) > 0;
                        const completionRate = Number(analyticsSummary?.totals?.completionRate || 0);
                        const engagementRate = Number(ci?.engagementRate || 0);
                        const avgRating = hasAxes ? Number(axes.overall || 0) : Number(activeNovel.rating || 0);
                        const healthScore = Math.max(0, Math.min(100, Math.round(
                          Math.min(engagementRate * 4, 35) +
                          Math.min(completionRate * 0.5, 30) +
                          (avgRating / 5) * 25 +
                          Math.min(Number(ci?.totalComments || 0), 50) / 50 * 10
                        )));
                        const healthLabel = healthScore >= 80 ? "عالی" : healthScore >= 60 ? "خوب" : healthScore >= 40 ? "متوسط" : "نیازمند توجه";
                        const healthColor = healthScore >= 80 ? "#34d399" : healthScore >= 60 ? "#a78bfa" : healthScore >= 40 ? "#fbbf24" : "#fb7185";
                        const axisRows = hasAxes ? [
                          { key: "overall", label: "امتیاز کلی", value: Number(axes.overall || 0) },
                          { key: "story", label: "داستان", value: Number(axes.story || 0) },
                          { key: "character", label: "شخصیت‌پردازی", value: Number(axes.character || 0) },
                          { key: "style", label: "سبک نوشتار", value: Number(axes.style || 0) },
                          { key: "grammar", label: "ویرایش و نگارش", value: Number(axes.grammar || 0) }
                        ] : [];
                        const strongestAxis = axisRows.length ? [...axisRows].sort((a, b) => b.value - a.value)[0] : null;
                        const weakestAxis = axisRows.length ? [...axisRows].sort((a, b) => a.value - b.value)[0] : null;
                        const weekly = Array.isArray(ci?.weeklyComments) ? ci.weeklyComments : [];
                        return (
                        <div className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716]/95" : "bg-white"} space-y-5`}>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <h5 className="font-extrabold text-sm font-black">تحلیل کلی رمان</h5>
                              <p className="text-[10px] text-slate-500 font-sans mt-1">جمع‌بندی هوشمند از تعامل، کیفیت و رفتار خوانندگان این اثر</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-start">
                                <p className="text-[9px] font-mono uppercase text-slate-500">امتیاز سلامت رمان</p>
                                <p className="text-2xl font-black leading-none" style={{ color: healthColor }}>{healthScore}<span className="text-xs text-slate-500">/100</span></p>
                              </div>
                              <span className="px-3 py-1.5 rounded-full text-[10px] font-black text-white" style={{ backgroundColor: healthColor }}>{healthLabel}</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                            <div className="space-y-3">
                              <p className="text-[10px] font-mono font-bold uppercase text-slate-400">میانگین امتیاز محورها</p>
                              {hasAxes ? axisRows.map((axis) => (
                                <div key={axis.key} className="space-y-1">
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="font-bold text-slate-300">{axis.label}</span>
                                    <span className="font-mono text-amber-400">{axis.value.toFixed(1)}</span>
                                  </div>
                                  <div className="h-2 rounded-full bg-slate-800/60 overflow-hidden">
                                    <div className="h-full rounded-full bg-gradient-to-l from-amber-400 to-violet-500 transition-all" style={{ width: `${Math.min(100, (axis.value / 5) * 100)}%` }} />
                                  </div>
                                </div>
                              )) : (
                                <p className="text-[11px] text-slate-550 italic font-sans py-4">هنوز نقدی با امتیاز ثبت نشده است.</p>
                              )}
                            </div>

                            <div className="space-y-3">
                              <p className="text-[10px] font-mono font-bold uppercase text-slate-400">فعالیت دیدگاه‌ها (۸ هفته)</p>
                              {weekly.length > 0 && weekly.some((w: any) => w.count > 0) ? (
                                <div className="h-36">
                                  <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                                    <BarChart data={weekly.map((w: any, i: number) => ({ name: `${i + 1}`, count: w.count }))} margin={{ top: 6, right: 6, left: -28, bottom: 0 }}>
                                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === "dark" ? "#1e293b" : "#f1f5f9"} />
                                      <XAxis dataKey="name" stroke="#64748b" fontSize={9} tickLine={false} />
                                      <YAxis stroke="#64748b" fontSize={9} tickLine={false} allowDecimals={false} />
                                      <ReTooltip contentStyle={theme === "dark" ? { backgroundColor: "#090b16", borderColor: "#1e293b", color: "#f8fafc" } : {}} formatter={(v: any) => [`${v} دیدگاه`, null]} />
                                      <Bar dataKey="count" fill="#8b5cf6" radius={[5, 5, 0, 0]} maxBarSize={26} />
                                    </BarChart>
                                  </ResponsiveContainer>
                                </div>
                              ) : (
                                <p className="text-[11px] text-slate-550 italic font-sans py-4">در هفته‌های اخیر دیدگاهی ثبت نشده است.</p>
                              )}
                              <div className="grid grid-cols-2 gap-2 pt-1">
                                <div className="rounded-xl bg-violet-500/10 p-3">
                                  <p className="text-lg font-black text-violet-300">{Number(ci?.totalComments ?? 0).toLocaleString("fa-IR")}</p>
                                  <p className="text-[9px] text-slate-500">کل دیدگاه فصل/پاراگراف</p>
                                </div>
                                <div className="rounded-xl bg-emerald-500/10 p-3">
                                  <p className="text-lg font-black text-emerald-300">{percentLabel(engagementRate)}</p>
                                  <p className="text-[9px] text-slate-500">نرخ تعامل نسبت به بازدید</p>
                                </div>
                              </div>
                            </div>

                            <div className="space-y-3">
                              <p className="text-[10px] font-mono font-bold uppercase text-slate-400">بحث‌برانگیزترین فصل‌ها</p>
                              {(ci?.topCommentedChapters || []).length > 0 ? (
                                <div className="space-y-2">
                                  {ci.topCommentedChapters.slice(0, 5).map((chapter: any, i: number) => (
                                    <div key={chapter.chapterId || i} className="flex items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2">
                                      <span className="text-[11px] font-bold text-slate-300 truncate">
                                        فصل {chapter.chapterNumber ?? "?"} · {chapter.title}
                                      </span>
                                      <span className="shrink-0 rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-black text-violet-300">{chapter.count}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[11px] text-slate-550 italic font-sans py-4">هنوز دیدگاهی روی فصل‌ها ثبت نشده است.</p>
                              )}
                            </div>
                          </div>

                          {(strongestAxis || weekly.length > 0) && (
                            <div className="rounded-2xl border border-violet-500/15 bg-violet-500/5 p-4 space-y-2">
                              <p className="text-[10px] font-mono font-bold uppercase text-violet-300">جمع‌بندی خودکار</p>
                              <ul className="text-[11px] leading-relaxed text-slate-350 space-y-1.5 font-sans list-disc pr-4">
                                {hasAxes && strongestAxis && strongestAxis.key !== "overall" && (
                                  <li>قوت اصلی اثر شما از نظر خوانندگان «{strongestAxis.label}» است (میانگین {strongestAxis.value.toFixed(1)} از ۵).</li>
                                )}
                                {hasAxes && weakestAxis && weakestAxis.key !== strongestAxis?.key && weakestAxis.value < 4 && (
                                  <li>بیشترین ظرفیت بهبود در محور «{weakestAxis.label}» دیده می‌شود؛ بازبینی این بخش می‌تواند امتیاز کلی را بالا ببرد.</li>
                                )}
                                {engagementRate >= 5
                                  ? <li>نرخ تعامل {percentLabel(engagementRate)} وضعیت بسیار خوبی است؛ مخاطبان فعالانه واکنش نشان می‌دهند.</li>
                                  : <li>نرخ تعامل {percentLabel(engagementRate)} پایین‌تر از حد ایده‌آل است؛ پرسیدن سؤال از خوانندگان در پایان فصل‌ها معمولاً دیدگاه‌ها را افزایش می‌دهد.</li>}
                                {completionRate > 0 && (
                                  <li>{percentLabel(completionRate)} از نشست‌های مطالعه تا انتها پیش رفته‌اند؛ عدد بالاتر یعنی ریتم فصل‌ها مخاطب را حفظ می‌کند.</li>
                                )}
                                {(ci?.paragraphComments || 0) > 0 && (
                                  <li>{Number(ci.paragraphComments).toLocaleString("fa-IR")} دیدگاه روی پاراگراف‌های مشخص ثبت شده؛ این خطوط دقیقاً نشان می‌دهد کدام لحظه‌های متن بیشترین تأثیر را گذاشته‌اند.</li>
                                )}
                              </ul>
                            </div>
                          )}
                        </div>
                        );
                      })()}

                      {/* Content Analytics, Likes, Comments */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                        <div className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-purple-950/20" : "bg-purple-50/50"} space-y-2`}>
                          <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-emerald-500" />
                            <h5 className="font-extrabold text-xs font-mono uppercase text-slate-500">آمار محتوا</h5>
                          </div>
                          <p className="text-2xl font-black">{activeNovel.chapters?.length || 0} فصل</p>
                          <p className="text-[10px] text-slate-400 font-sans">شما {activeNovel.chapters?.length || 0} فصل منتشر کرده‌اید. برای افزایش ماندگاری، برنامه انتشار منظم داشته باشید.</p>
                        </div>
                        <div className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-rose-950/20" : "bg-rose-50/50"} space-y-2`}>
                          <div className="flex items-center gap-2">
                            <Bookmark className="w-4 h-4 text-rose-500" />
                            <h5 className="font-extrabold text-xs font-mono uppercase text-slate-500">مجموع لایک‌ها / ذخیره‌ها</h5>
                          </div>
                          <p className="text-2xl font-black">{(analyticsSummary?.totals?.likes || 0).toLocaleString()} / {(analyticsSummary?.totals?.bookmarks || activeNovel.bookmarksCount || 0).toLocaleString()}</p>
                          <p className="text-[10px] text-slate-400 font-sans">لایک‌ها و ذخیره‌های واقعی کتابخانه از رویدادهای پایگاه داده.</p>
                        </div>
                        <div className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-violet-950/20" : "bg-violet-50/50"} space-y-2`}>
                          <div className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-violet-500" />
                            <h5 className="font-extrabold text-xs font-mono uppercase text-slate-500">مجموع دیدگاه‌ها</h5>
                          </div>
                          <p className="text-2xl font-black">{analyticsSummary?.totals?.comments ?? activeNovel.reviews?.length ?? 0}</p>
                          <p className="text-[10px] text-slate-400 font-sans">نقد و دیدگاه‌های گردآوری‌شده از خوانندگان.</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 pt-2">
                        <div className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716]/95" : "bg-white"} space-y-4 xl:col-span-2`}>
                          <div>
                            <h5 className="font-extrabold text-xs font-mono uppercase text-slate-400">قیف تبدیل</h5>
                            <p className="text-[10px] text-slate-500 mt-1 font-sans">مسیر از نمایش تا تکمیل مطالعه بر اساس رویدادهای پیشنهاد و خواندن</p>
                          </div>
                          <div className="h-56">
                            <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                              <BarChart data={getConversionFunnelData()} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === "dark" ? "#1e293b" : "#f1f5f9"} />
                                <XAxis dataKey="name" stroke="#64748b" fontSize={9} tickLine={false} />
                                <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                                <ReTooltip contentStyle={theme === "dark" ? { backgroundColor: "#090b16", borderColor: "#1e293b", color: "#f8fafc" } : {}} />
                                <Bar dataKey="Count" fill="#a855f7" radius={[6, 6, 0, 0]} maxBarSize={48} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                            {getConversionFunnelData().map((step: any) => (
                              <div key={step.name} className="rounded-2xl border border-slate-800/40 p-3">
                                <p className="text-[9px] font-mono uppercase text-slate-500">{step.name}</p>
                                <p className="text-lg font-black">{Number(step.Count || 0).toLocaleString()}</p>
                                <p className="text-[10px] text-emerald-400">{percentLabel(step.Conversion)} تبدیل در این مرحله</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716]/95" : "bg-white"} space-y-4`}>
                          <div>
                            <h5 className="font-extrabold text-xs font-mono uppercase text-slate-400">منابع ورودی ترافیک</h5>
                            <p className="text-[10px] text-slate-500 mt-1 font-sans">منبع ترافیک بر اساس لاگ‌های سرور و نشست‌های خوانندگان گروه‌بندی شده است</p>
                          </div>
                          <div className="space-y-3">
                            {getSourceData().length > 0 ? getSourceData().slice(0, 7).map((row: any) => (
                              <div key={row.name} className="space-y-1">
                                <div className="flex items-center justify-between gap-3 text-xs">
                                  <span className="font-bold text-slate-300 truncate">{row.name}</span>
                                  <span className="font-mono text-purple-400">{row.percentage}%</span>
                                </div>
                                <div className="h-2 rounded-full bg-slate-800/50 overflow-hidden">
                                  <div className="h-full bg-purple-500 rounded-full" style={{ width: `${Math.min(100, row.percentage)}%` }} />
                                </div>
                              </div>
                            )) : (
                              <div className="py-8 text-center text-slate-500 italic text-xs">هنوز داده‌ای از منابع ترافیک ثبت نشده است.</div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716]/95" : "bg-white"} space-y-4`}>
                        <div>
                          <h5 className="font-extrabold text-xs font-mono uppercase text-slate-400">ماندگاری گروه‌های خوانندگان</h5>
                          <p className="text-[10px] text-slate-500 mt-1 font-sans">گروه‌های روزانه خوانندگان و نرخ بازگشت مشاهده‌شده</p>
                        </div>
                        <div className="h-56">
                          <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                            <LineChart data={getCohortData()} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === "dark" ? "#1e293b" : "#f1f5f9"} />
                              <XAxis dataKey="day" stroke="#64748b" fontSize={9} tickLine={false} />
                              <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                              <ReTooltip contentStyle={theme === "dark" ? { backgroundColor: "#090b16", borderColor: "#1e293b", color: "#f8fafc" } : {}} />
                              <Line type="monotone" dataKey="Readers" stroke="#06b6d4" strokeWidth={3} dot={{ strokeWidth: 2, r: 4 }} />
                              <Line type="monotone" dataKey="ReturnRate" stroke="#22c55e" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
                        <div className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716]/95" : "bg-white"} space-y-4`}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h5 className="font-extrabold text-xs font-mono uppercase text-slate-400 flex items-center gap-2"><Globe2 className="w-4 h-4"/> کشورهای برتر</h5>
                              <p className="text-[10px] text-slate-500 mt-1 font-sans">توزیع کشورها از تحلیل IP سمت سرور محاسبه می‌شود. ترافیک VPN/پروکسی به عنوان «غیرقابل ردیابی» دسته‌بندی می‌شود.</p>
                            </div>
                            <span className="text-[10px] font-mono text-orange-400 whitespace-nowrap">{percentLabel(analyticsSummary?.audience?.vpnOrProxy?.percentage)} VPN</span>
                          </div>
                          <div className="space-y-3">
                            {(analyticsSummary?.audience?.countries || []).length > 0 ? analyticsSummary.audience.countries.map((row: any) => (
                              <div key={row.name} className="space-y-1">
                                <div className="flex items-center justify-between gap-3 text-xs">
                                  <span className="font-bold text-slate-300 truncate">{row.name}</span>
                                  <span className="font-mono text-violet-400">{row.percentage}%</span>
                                </div>
                                <div className="h-2 rounded-full bg-slate-800/50 overflow-hidden">
                                  <div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.min(100, row.percentage)}%` }} />
                                </div>
                              </div>
                            )) : (
                              <div className="py-8 text-center text-slate-500 italic text-xs">هنوز داده کشوری برای این رمان گردآوری نشده است.</div>
                            )}
                          </div>
                        </div>

                        <div className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716]/95" : "bg-white"} space-y-4`}>
                          <div>
                              <h5 className="font-extrabold text-xs font-mono uppercase text-slate-400 flex items-center gap-2"><Monitor className="w-4 h-4"/> ترکیب دستگاه و مرورگر</h5>
                              <p className="text-[10px] text-slate-500 mt-1 font-sans">نوع دستگاه، سیستم‌عامل و مرورگر از User Agent درخواست استخراج می‌شود.</p>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {[
                              { title: "دستگاه‌ها", rows: analyticsSummary?.audience?.devices || [] },
                              { title: "سیستم‌عامل‌ها", rows: analyticsSummary?.audience?.operatingSystems || [] },
                              { title: "مرورگرها", rows: analyticsSummary?.audience?.browsers || [] },
                            ].map((group) => (
                              <div key={group.title} className="space-y-2">
                                <span className="text-[9px] font-mono uppercase text-slate-500 font-black">{group.title}</span>
                                {group.rows.length > 0 ? group.rows.slice(0, 5).map((row: any) => (
                                  <div key={`${group.title}-${row.name}`} className="flex items-center justify-between gap-2 text-[11px]">
                                    <span className="truncate text-slate-300">{row.name}</span>
                                    <span className="font-mono text-purple-400">{row.percentage}%</span>
                                  </div>
                                )) : (
                                  <div className="text-[11px] italic text-slate-500">بدون داده</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Recharts panels */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                        <div className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716]/95" : "bg-white"} space-y-4`}>
                          <div>
                            <h5 className="font-extrabold text-xs font-mono uppercase text-slate-400">ماندگاری و افت تعامل خوانندگان</h5>
                            <p className="text-[10px] text-slate-500 mt-1 font-sans">روند ماندگاری خوانندگان در طول فصل‌های منتشرشده</p>
                          </div>
                          
                          <div className="h-56">
                            <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                              <AreaChart data={getFunnelData()} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                                <defs>
                                  <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.25}/>
                                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === "dark" ? "#1e293b" : "#f1f5f9"} />
                                <XAxis dataKey="name" stroke="#64748b" fontSize={9} tickLine={false} />
                                <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                                <ReTooltip 
                                  contentStyle={theme === "dark" ? { backgroundColor: "#090b16", borderColor: "#1e293b", color: "#f8fafc" } : {}}
                                />
                                <Area 
                                  type="monotone" 
                                  dataKey="Pageviews" 
                                  stroke="#8b5cf6" 
                                  strokeWidth={2}
                                  fillOpacity={1} 
                                  fill="url(#viewsGrad)" 
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        <div className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716]/95" : "bg-white"} space-y-4`}>
                          <div>
                            <h5 className="font-extrabold text-xs font-mono uppercase text-slate-400">تعداد کلمات فصل‌های مجموعه</h5>
                            <p className="text-[10px] text-slate-500 mt-1 font-sans">تحلیل طول روایت به ازای هر اپیزود</p>
                          </div>

                          <div className="h-56">
                            <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                              <BarChart data={getWordsData()} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === "dark" ? "#1e293b" : "#f1f5f9"} />
                                <XAxis dataKey="name" stroke="#64748b" fontSize={9} tickLine={false} />
                                <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                                <ReTooltip 
                                  contentStyle={theme === "dark" ? { backgroundColor: "#090b16", borderColor: "#1e293b", color: "#f8fafc" } : {}}
                                />
                                <Bar 
                                  dataKey="Words" 
                                  fill="#10b981" 
                                  radius={[6, 6, 0, 0]}
                                  maxBarSize={30}
                                />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>

                      <div className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716]/95" : "bg-white"} space-y-4`}>
                        <div>
                          <h5 className="font-extrabold text-xs font-mono uppercase text-slate-400">ترافیک هفتگی و میزان دسترسی</h5>
                          <p className="text-[10px] text-slate-500 mt-1 font-sans">پیگیری خوانندگان یکتا و تعامل‌ها بر اساس روزهای هفته</p>
                        </div>

                        <div className="h-56">
                          <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                            <LineChart data={getTrafficData()} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === "dark" ? "#1e293b" : "#f1f5f9"} />
                              <XAxis dataKey="day" stroke="#64748b" fontSize={9} tickLine={false} />
                              <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                              <ReTooltip 
                                contentStyle={theme === "dark" ? { backgroundColor: "#090b16", borderColor: "#1e293b", color: "#f8fafc" } : {}}
                              />
                              <Line type="monotone" dataKey="Readers" stroke="#a855f7" strokeWidth={3} dot={{ strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} />
                              <Line type="monotone" dataKey="Engagements" stroke="#fbbf24" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Author Notifications Configuration */}
                      <div className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716]/95" : "bg-white"} space-y-4`}>
                        <div>
                          <h5 className="font-extrabold text-xs font-mono uppercase text-slate-400 flex items-center gap-2"><Settings className="w-4 h-4"/> پیکربندی اعلان‌ها</h5>
                          <p className="text-[10px] text-slate-500 font-sans mt-0.5">هشدارهای لحظه‌ای داشبورد نویسندگی خود را روشن یا خاموش کنید</p>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/10 cursor-pointer">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-300">دیدگاه‌های جدید رمان</span>
                            <input type="checkbox" className="w-4 h-4 border-slate-600 rounded" checked={notifyComments} onChange={(e) => setNotifyComments(e.target.checked)} />
                          </label>
                          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/10 cursor-pointer">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-300">امتیازدهی‌های جدید رمان</span>
                            <input type="checkbox" className="w-4 h-4" checked={notifyRatings} onChange={(e) => setNotifyRatings(e.target.checked)} />
                          </label>
                          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/10 cursor-pointer">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-300">اعلان‌های پیش‌فرض</span>
                            <input type="checkbox" className="w-4 h-4" checked={notifyDefaults} onChange={(e) => setNotifyDefaults(e.target.checked)} />
                          </label>
                          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/10 cursor-pointer">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-300">پاسخ‌های دیدگاه</span>
                            <input type="checkbox" className="w-4 h-4" checked={notifyReplies} onChange={(e) => setNotifyReplies(e.target.checked)} />
                          </label>
                          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/10 cursor-pointer">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-300">ورودهای جدید به حساب</span>
                            <input type="checkbox" className="w-4 h-4" checked={notifyLogins} onChange={(e) => setNotifyLogins(e.target.checked)} />
                          </label>
                          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/10 cursor-pointer">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-300">دنبال‌کنندگان جدید</span>
                            <input type="checkbox" className="w-4 h-4 border-slate-600 rounded" checked={notifyFollowers} onChange={(e) => setNotifyFollowers(e.target.checked)} />
                          </label>
                          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/10 cursor-pointer">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-300">لایک‌های رمان</span>
                            <input type="checkbox" className="w-4 h-4 border-slate-600 rounded" checked={notifyLikes} onChange={(e) => setNotifyLikes(e.target.checked)} />
                          </label>
                          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/10 cursor-pointer">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-300">نشان‌گذاری / ذخیره رمان</span>
                            <input type="checkbox" className="w-4 h-4 border-slate-600 rounded" checked={notifyBookmarks} onChange={(e) => setNotifyBookmarks(e.target.checked)} />
                          </label>
                        </div>
                      </div>

                      {/* Reviews Log list */}
                      <div className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716]/95" : "bg-white"} space-y-4`}>
                        <div>
                          <h5 className="font-extrabold text-xs font-mono uppercase text-slate-400">بازخورد خوانندگان و نقدهای فصل</h5>
                          <p className="text-[10px] text-slate-500 font-sans">نقدها و دیدگاه‌های اخیر پست‌ها از سوی خوانندگان</p>
                        </div>

                        {analyticsComments && analyticsComments.length > 0 ? (
                          <div className="space-y-4">
                            {analyticsComments.map((rev, idx) => {
                              const targetType = rev.targetType || rev.type || "review";
                              const targetId = rev.targetId || rev.id;
                              const replyKey = `${targetType}:${targetId}`;
                              return (
                              <div key={rev.id || idx} className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800/10 text-start space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono text-xs font-bold text-violet-400">@{rev.username || rev.user_id?.substring(0,6) || "خواننده"}</span>
                                  <div className="flex items-center gap-2">
                                    {rev.rating && (
                                      <div className="flex items-center gap-1 text-amber-400 text-xs">
                                        <Star className="w-3.5 h-3.5 fill-current" />
                                        <span>{rev.rating}</span>
                                      </div>
                                    )}
                                    {rev.type && (
                                      <span className="text-[9px] text-slate-500 uppercase tracking-wider">{rev.type === "review" ? "دیدگاه نقد" : rev.type === "post" ? "دیدگاه پست" : rev.type}</span>
                                    )}
                                    <button onClick={() => deleteAnalyticsComment(rev)} className="p-1 rounded-lg text-rose-400 hover:bg-rose-500/10" title="حذف دیدگاه">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                                <p className="text-xs text-slate-350 leading-relaxed font-sans">{rev.content || rev.comment}</p>
                                {(rev.replies || []).length > 0 && (
                                  <div className="space-y-2 border-l border-violet-500/30 pl-3">
                                    {rev.replies.map((reply: any) => (
                                      <div key={reply.id} className="rounded-xl bg-violet-500/10 p-3 text-xs text-violet-100">
                                        <div className="text-[9px] font-mono uppercase text-violet-400 mb-1">پاسخ نویسنده</div>
                                        {reply.content}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="flex gap-2">
                                  <input
                                    value={commentReplyDrafts[replyKey] || ""}
                                    onChange={(e) => setCommentReplyDrafts((drafts) => ({ ...drafts, [replyKey]: e.target.value }))}
                                    placeholder="پاسخ به عنوان نویسنده..."
                                    className="flex-1 min-w-0 rounded-xl border border-slate-800 bg-black/30 px-3 py-2 text-xs outline-none focus:border-violet-500"
                                  />
                                  <button
                                    onClick={() => replyAnalyticsComment(rev)}
                                    disabled={!(commentReplyDrafts[replyKey] || "").trim()}
                                    className="rounded-xl bg-violet-600 px-3 py-2 text-[10px] font-bold uppercase text-white disabled:opacity-40"
                                  >
                                    پاسخ
                                  </button>
                                </div>
                                <div className="text-[9px] text-slate-500 font-mono">{rev.createdAt || new Date(rev.created_at).toLocaleDateString("fa-IR")}</div>
                              </div>
                            )})}
                          </div>
                        ) : activeNovel.reviews && activeNovel.reviews.length > 0 ? (
                          <div className="space-y-4">
                            {activeNovel.reviews.map((rev) => (
                              <div key={rev.id} className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800/10 text-start space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono text-xs font-bold text-violet-400">@{rev.username}</span>
                                  <div className="flex items-center gap-1 text-amber-400 text-xs">
                                    <Star className="w-3.5 h-3.5 fill-current" />
                                    <span>{rev.rating}</span>
                                  </div>
                                </div>
                                <p className="text-xs text-slate-350 leading-relaxed font-sans">{rev.comment}</p>
                                <div className="text-[9px] text-slate-500 font-mono">{rev.createdAt}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="py-8 text-center text-slate-550 italic text-xs font-sans">هنوز نقد یا دیدگاهی ثبت نشده است.</div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {workspaceTab === "comments" && activeNovel && (() => {
                    const reviewsInNovel = novelComments.filter((c) => (c.type || "review") === "review").length;
                    const chapterCommentsInNovel = novelComments.length - reviewsInNovel;
                    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
                    const thisMonthCount = novelComments.filter((c) => new Date(c.created_at).getTime() >= monthStart.getTime()).length;
                    const chapterOptions = [...new Map(novelComments.filter((c) => c.chapter_id).map((c) => [c.chapter_id, c])).values()];
                    const visibleComments = novelComments
                      .filter((c) => novelCommentsFilter === "all" || (c.type || "review") === novelCommentsFilter)
                      .filter((c) => novelCommentsChapter === "all" || c.chapter_id === novelCommentsChapter)
                      .filter((c) => !novelCommentsSearch.trim() || `${c.content || c.comment || ""} ${c.username || ""}`.toLowerCase().includes(novelCommentsSearch.trim().toLowerCase()));
                    return (
                    <motion.div
                      key="tab-comments"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-6 text-start"
                    >
                      <div className="flex items-center justify-between border-b border-purple-900/15 dark:border-violet-950/20 pb-2">
                        <div>
                          <h4 className="text-xs font-mono font-bold uppercase text-slate-400">همه دیدگاه‌های «{activeNovel.title}» یکجا</h4>
                          <p className="text-[10px] text-slate-500 font-sans mt-1">نقدها، دیدگاه فصل‌ها و دیدگاه پاراگراف‌ها در یک نمای واحد</p>
                        </div>
                        <button onClick={loadNovelComments} className="p-2 rounded-lg text-violet-400 hover:bg-violet-500/10" title="به‌روزرسانی">
                          <RotateCw className={`w-4 h-4 ${novelCommentsLoading ? "animate-spin" : ""}`} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: "کل دیدگاه‌ها", val: novelComments.length, icon: MessagesSquare, color: "text-violet-400" },
                          { label: "نقد و بررسی", val: reviewsInNovel, icon: Star, color: "text-amber-400" },
                          { label: "دیدگاه فصل/پاراگراف", val: chapterCommentsInNovel, icon: MessageSquare, color: "text-emerald-400" },
                          { label: "این ماه", val: thisMonthCount, icon: Activity, color: "text-rose-400" }
                        ].map((s, idx) => (
                          <div key={idx} className={`p-4 rounded-2xl border ${activeTheme.border} ${theme === "dark" ? "bg-slate-900/35" : "bg-stone-50"} flex items-center gap-3`}>
                            <s.icon className={`w-5 h-5 ${s.color}`} />
                            <div>
                              <p className="text-lg font-black leading-none">{Number(s.val || 0).toLocaleString("fa-IR")}</p>
                              <p className="text-[9px] font-mono uppercase text-slate-500 mt-1">{s.label}</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className={`flex flex-wrap items-center gap-2 p-3 rounded-2xl border ${activeTheme.border} ${theme === "dark" ? "bg-slate-900/30" : "bg-white"}`}>
                        <div className="flex rounded-xl overflow-hidden border border-slate-700/20">
                          {[
                            { id: "all", label: "همه" },
                            { id: "review", label: "نقد و بررسی" },
                            { id: "chapter_comment", label: "دیدگاه فصل" }
                          ].map((f) => (
                            <button
                              key={f.id}
                              onClick={() => setNovelCommentsFilter(f.id as any)}
                              className={`px-3 py-1.5 text-[11px] font-bold transition-colors ${novelCommentsFilter === f.id ? "bg-violet-600 text-white" : "text-slate-500 hover:text-violet-300"}`}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                        <select
                          value={novelCommentsChapter}
                          onChange={(e) => setNovelCommentsChapter(e.target.value)}
                          className="rounded-xl border border-slate-700/30 bg-black/20 px-3 py-1.5 text-[11px] outline-none"
                        >
                          <option value="all">همه فصل‌ها</option>
                          {chapterOptions.map((c: any) => (
                            <option key={c.chapter_id} value={c.chapter_id}>
                              فصل {c.chapter_number ?? "?"}: {(c.chapter_title || "").slice(0, 28)}
                            </option>
                          ))}
                        </select>
                        <div className="relative flex-1 min-w-40">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                          <input
                            value={novelCommentsSearch}
                            onChange={(e) => setNovelCommentsSearch(e.target.value)}
                            placeholder="جستجو در متن دیدگاه‌ها یا نام خواننده..."
                            className="w-full rounded-xl border border-slate-700/30 bg-black/20 pl-9 pr-3 py-1.5 text-[11px] outline-none focus:border-violet-500"
                          />
                        </div>
                      </div>

                      {novelCommentsLoading ? (
                        <div className="py-12 text-center text-xs text-slate-500 italic">در حال بارگذاری دیدگاه‌ها...</div>
                      ) : visibleComments.length > 0 ? (
                        <div className="space-y-4">
                          {visibleComments.map((rev, idx) => {
                            const targetType = rev.targetType || rev.type || "review";
                            const targetId = rev.targetId || rev.id;
                            const replyKey = `${targetType}:${targetId}`;
                            const isReview = targetType === "review";
                            return (
                              <div key={`${targetId}-${idx}`} className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800/10 text-start space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-mono text-xs font-bold text-violet-400">@{rev.username || "خواننده"}</span>
                                  <div className="flex items-center gap-2">
                                    {!isReview && rev.chapter_number !== null && rev.chapter_number !== undefined && (
                                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-bold">
                                        فصل {rev.chapter_number}{rev.paragraph_id ? " · پاراگراف" : ""}
                                      </span>
                                    )}
                                    {rev.rating != null && (
                                      <div className="flex items-center gap-1 text-amber-400 text-xs">
                                        <Star className="w-3.5 h-3.5 fill-current" />
                                        <span>{rev.rating}</span>
                                      </div>
                                    )}
                                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${isReview ? "bg-amber-500/10 text-amber-400" : "bg-violet-500/10 text-violet-300"}`}>
                                      {isReview ? "نقد و بررسی" : "دیدگاه فصل"}
                                    </span>
                                    <button onClick={() => deleteAnalyticsComment(rev)} className="p-1 rounded-lg text-rose-400 hover:bg-rose-500/10" title="حذف دیدگاه">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                                {!isReview && rev.chapter_title && (
                                  <p className="text-[10px] font-mono text-slate-500">{rev.chapter_title}</p>
                                )}
                                <p className="text-xs text-slate-350 leading-relaxed font-sans">{rev.content || rev.comment}</p>
                                {(rev.replies || []).length > 0 && (
                                  <div className="space-y-2 border-l border-violet-500/30 pl-3">
                                    {rev.replies.map((reply: any) => (
                                      <div key={reply.id} className="rounded-xl bg-violet-500/10 p-3 text-xs text-violet-100">
                                        <div className="text-[9px] font-mono uppercase text-violet-400 mb-1">پاسخ نویسنده</div>
                                        {reply.content}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="flex gap-2">
                                  <input
                                    value={commentReplyDrafts[replyKey] || ""}
                                    onChange={(e) => setCommentReplyDrafts((drafts) => ({ ...drafts, [replyKey]: e.target.value }))}
                                    placeholder="پاسخ به عنوان نویسنده..."
                                    className="flex-1 min-w-0 rounded-xl border border-slate-800 bg-black/30 px-3 py-2 text-xs outline-none focus:border-violet-500"
                                  />
                                  <button
                                    onClick={() => replyAnalyticsComment(rev)}
                                    disabled={!(commentReplyDrafts[replyKey] || "").trim()}
                                    className="rounded-xl bg-violet-600 px-3 py-2 text-[10px] font-bold uppercase text-white disabled:opacity-40"
                                  >
                                    پاسخ
                                  </button>
                                </div>
                                <div className="text-[9px] text-slate-500 font-mono">{new Date(rev.created_at).toLocaleString("fa-IR")}</div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="py-12 text-center space-y-2">
                          <MessagesSquare className="w-8 h-8 mx-auto text-slate-600" />
                          <p className="text-xs text-slate-550 italic font-sans">
                            {novelComments.length > 0 ? "دیدگاهی با این فیلترها پیدا نشد." : "هنوز دیدگاهی برای این رمان ثبت نشده است."}
                          </p>
                        </div>
                      )}
                    </motion.div>
                    );
                  })()}

                  {workspaceTab === "monetize" && activeNovel && (
                    <motion.div
                      key="tab-monetize"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-6"
                    >
                      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-l from-violet-600/15 via-transparent to-amber-500/10 p-7 sm:p-10">
                        <div className="pointer-events-none absolute -left-14 -top-14 h-44 w-44 rounded-full bg-amber-500/20 blur-3xl" />
                        <div className="pointer-events-none absolute -bottom-16 -right-8 h-48 w-48 rounded-full bg-violet-600/20 blur-3xl" />
                        <div className="relative space-y-4 text-center">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-[11px] font-black text-amber-400">
                            <Wallet className="h-3.5 w-3.5" /> برنامهٔ همکاران نویسنده
                          </span>
                          <h3 className="text-2xl font-black sm:text-3xl">درآمدزایی از «{activeNovel.title}»</h3>
                          <p className="mx-auto max-w-xl text-xs leading-relaxed text-slate-400 sm:text-sm">
                            به‌زودی می‌توانید از نوشتن درآمد داشته باشید: سهم از اشتراک پریمیوم خوانندگان، حمایت‌های مستقیم خوانندگان و پاداش بر اساس بازدید واقعی فصل‌ها.
                          </p>
                          <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-5 py-2 text-xs font-black text-amber-300">
                            <Sparkles className="h-4 w-4" /> به زودی
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        {[
                          { icon: Star, title: "سهم پریمیوم", desc: "بخشی از اشتراک خوانندگانی که اثر شما را می‌خوانند، مستقیم به حساب شما تعلق می‌گیرد." },
                          { icon: Heart, title: "حمایت خوانندگان", desc: "خوانندگان می‌توانند برای ادامهٔ مسیر نویسندهٔ موردعلاقه‌شان حمایت مالی ثبت کنند." },
                          { icon: TrendingUp, title: "پاداش بازدید", desc: "بازدیدهای واقعی و زمان مطالعهٔ فصل‌ها به پاداش ماهانهٔ شفاف تبدیل می‌شود." }
                        ].map((item) => (
                          <div key={item.title} className={`rounded-3xl border p-5 space-y-2 ${theme === "dark" ? "border-violet-950/40 bg-slate-900/35" : "border-stone-200 bg-white"}`}>
                            <item.icon className="h-5 w-5 text-amber-400" />
                            <h4 className="text-sm font-black">{item.title}</h4>
                            <p className="text-[11px] leading-relaxed text-slate-500">{item.desc}</p>
                            <span className="inline-block rounded-full bg-slate-500/10 px-2.5 py-1 text-[9px] font-bold uppercase text-slate-500">به زودی</span>
                          </div>
                        ))}
                      </div>

                      <p className="text-center text-[10px] text-slate-500 font-mono">
                        آمار فعلی رمان شما ({Number(activeNovel.viewsCount || 0).toLocaleString("fa-IR")} بازدید) هنگام راه‌اندازی، مبنای محاسبهٔ اولین پاداش خواهد بود.
                      </p>
                    </motion.div>
                  )}

                  {workspaceTab === "editor-chat" && activeNovel && (
                    <motion.div 
                      key="tab-editor-chat"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-6 text-start"
                    >
                      <div className="flex items-center justify-between border-b border-purple-900/15 dark:border-violet-950/20 pb-2">
                        <h4 className="text-xs font-mono font-bold uppercase text-slate-400">ارتباط با سردبیر</h4>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-mono px-2 py-1 rounded-lg font-bold ${activeNovelApprovalStatus === "approved" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                            وضعیت: {(activeNovelApprovalStatus || "نامشخص").toUpperCase()}
                          </span>
                        </div>
                      </div>

                      {activeNovelEditorNote && (
                        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-500 text-[11px] font-mono">
                          <strong className="text-amber-400 font-black">یادداشت رسمی سردبیر:</strong> {activeNovelEditorNote}
                        </div>
                      )}

                      {/* Messages Container */}
                      <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow} space-y-4`}>
                        <div className="h-64 overflow-y-auto space-y-3 custom-scrollbar pr-2 flex flex-col">
                          {editorMessages.length === 0 ? (
                            <div className="flex-1 flex items-center justify-center text-[11px] text-slate-500 font-mono">
                              هنوز پیامی از سردبیر دریافت نشده است.
                            </div>
                          ) : (
                            editorMessages.map(msg => (
                              <div key={msg.id} className={`flex flex-col ${msg.is_editor ? 'items-start' : 'items-end'}`}>
                                <div className="text-[9px] font-mono mb-1 mx-1 text-slate-500">
                                  {msg.is_editor ? 'سردبیر' : 'شما'} • {new Date(msg.created_at).toLocaleString("fa-IR")}
                                </div>
                                <div className={`px-4 py-2 text-xs rounded-2xl max-w-[80%] ${msg.is_editor ? 'bg-slate-800/40 text-slate-300 rounded-tl-none border border-slate-700/50' : 'bg-violet-600/20 text-violet-300 rounded-tr-none border border-violet-500/30'}`}>
                                  {msg.content}
                                </div>
                              </div>
                            ))
                          )}
                        </div>

                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={editorMsgDraft}
                            onChange={(e) => setEditorMsgDraft(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendEditorMessage()}
                            placeholder="به سردبیر پیام بدهید..."
                            className={`flex-1 min-w-0 px-4 py-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                              theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                            }`}
                          />
                          <button
                            onClick={handleSendEditorMessage}
                            disabled={!editorMsgDraft.trim()}
                            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-4 rounded-xl text-xs font-bold transition-colors"
                          >
                            ارسال
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {workspaceTab === "posts" && activeNovel && (
                    <motion.div 
                      key="tab-posts"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-6 text-start"
                    >
                      <div className="flex items-center justify-between border-b border-purple-900/15 dark:border-violet-950/20 pb-2">
                        <h4 className="text-xs font-mono font-bold uppercase text-slate-400">پست‌ها و اطلاعیه‌های نویسنده</h4>
                        <span className="text-[10px] text-violet-400 font-mono">خوانندگان خود را مطلع کنید</span>
                      </div>

                      <form onSubmit={handlePostSubmit} className={`p-5 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716]/95" : "bg-white"} space-y-4`}>
                        <h5 className="font-extrabold text-xs font-mono uppercase text-slate-400 mb-2">ساخت پست جدید</h5>
                        
                        <div className="flex flex-col sm:flex-row gap-4">
                           <div className="flex-1 min-w-0">
                             <input
                               placeholder="عنوان پست..."
                               value={newPostTitle}
                               onChange={e => setNewPostTitle(e.target.value)}
                               className={`w-full px-4 py-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                                 theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                               }`}
                             />
                           </div>
                           <div className="w-1/3">
                              <select 
                                 value={postType}
                                 onChange={(e) => setPostType(e.target.value as any)}
                                 className={`w-full px-4 py-2.5 text-xs rounded-xl border focus:outline-none transition-all ${
                                   theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                                 }`}
                              >
                                 <option value="novel">برای این رمان</option>
                                 <option value="general">عمومی (پروفایل من)</option>
                              </select>
                           </div>
                        </div>
                        <textarea
                          placeholder="چه چیزی می‌خواهید با خوانندگان خود به اشتراک بگذارید؟"
                          value={newPostContent}
                          onChange={e => setNewPostContent(e.target.value)}
                          rows={4}
                          className={`w-full px-4 py-2.5 text-xs rounded-xl border focus:outline-none transition-all resize-none ${
                            theme === "dark" ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-amber-500"
                          }`}
                        />
                        <div className="flex justify-end">
                          <button
                            type="submit"
                            className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                          >
                            انتشار پست
                          </button>
                        </div>
                      </form>

                      <div className="space-y-4 pt-4">
                        <h5 className="font-extrabold text-xs font-mono uppercase text-slate-400">پست‌های پیشین</h5>
                        {authorPosts.length > 0 ? authorPosts.map(post => (
                          <div key={post.id} className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-2`}>
                            <h4 className="font-bold text-sm tracking-tight">{post.title}</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap">{post.content}</p>
                            <div className="text-[10px] text-slate-500 font-mono text-right">{new Date(post.created_at).toLocaleDateString("fa-IR")}</div>
                          </div>
                        )) : (
                          <div className="text-xs text-slate-500 italic p-4 text-center border border-dashed border-slate-700/30 rounded-2xl">
                            هنوز هیچ پستی منتشر نکرده‌اید.
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <CoverEditorModal
        isOpen={isCoverModalOpen}
        onClose={closeCoverModal}
        onSave={async (coverUrl) => {
          if (isEditingCoverForExistingBook) {
            if (!activeNovel) throw new Error("پیش از تغییر جلد، یک رمان انتخاب کنید.");
            if (onUpdateNovelCover) {
              await onUpdateNovelCover(activeNovel.id, coverUrl);
            } else if (onUpdateNovel) {
              await onUpdateNovel({
                ...activeNovel,
                cover: coverUrl,
                coverUrl,
              });
            }
            setEditBookCover(coverUrl);
            const template = premiumTemplateById(editPremiumPresentation.templateId);
            void extractAccessibleCoverPalette(coverUrl, template.colors).then((palette) => {
              setEditPremiumPresentation((current) => ({ ...current, palette }));
            });
          } else {
            setBookCover(coverUrl);
          }
        }}
        initialTitle={isEditingCoverForExistingBook ? editBookTitle : bookTitle || "رمان فوق‌العاده من"}
        initialAuthor={isEditingCoverForExistingBook ? editBookAuthor : bookAuthor || currentUser?.username || "نام نویسنده"}
      />

      {/* Full-screen manga preview, opened from the page editor. It renders the
          same viewer readers use, with the local (possibly unsaved) page order. */}
      {mangaPreviewPages && activeNovel && (
        <div
          className="fixed inset-0 z-[65] flex flex-col bg-black/85 p-2 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="پیش‌نمایش خواننده مانگا"
        >
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 pb-2">
            <span className="text-xs font-black text-white">
              پیش‌نمایش خواننده — {chTitle.trim() || `فصل ${chNumber}`}
            </span>
            <button
              type="button"
              onClick={() => setMangaPreviewPages(null)}
              className="rounded-xl border border-white/25 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/10"
            >
              بستن پیش‌نمایش
            </button>
          </div>
          <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-hidden">
            <MangaReader
              pages={mangaPreviewPages}
              chapterTitle={chTitle.trim() || `فصل ${chNumber}`}
              chapterNumber={chNumber}
              novelTitle={activeNovel.title}
              readingDirection={activeReadingDirection}
              theme={theme}
            />
          </div>
        </div>
      )}
    </div>
  );
}
