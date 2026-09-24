import React, { useState, useEffect } from "react";
import { Novel, ReadingProgress } from "../types";
import { MAIN_CATEGORIES, SUB_CATEGORIES, CONTRAST_THEMES, filterTaxonomyList } from "../data";
import { BookOpen, Search, Star, Flame, Eye, EyeOff, Bookmark, LayoutGrid, TrendingUp, Sparkles, SlidersHorizontal, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { api } from "../utils/api";
import { searchNovelsLocal } from "../utils/search";
import { isNovelApprovedForDiscovery } from "../utils/novelVisibility";
import { isMangaWork } from "../../shared/manga";
import SafeImage from "./SafeImage";
import HomepageHeroCarousel from "./HomepageHeroCarousel";

interface DashboardProps {
  novels: Novel[];
  onSelectNovel: (novel: Novel) => void;
  readingProgress: ReadingProgress[];
  onResumeReading: (progress: ReadingProgress) => void;
  onOpenWriter: () => void;
  onOpenEvent: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onBookmarkNovel: (novelId: string, event: React.MouseEvent) => void;
  bookmarkedIds: string[];
  onSelectAuthor?: (authorName: string) => void;
  systemSettings?: any;
  currentUser?: any;
  initialSection?: "rankings";
  onCloseInitialSection?: () => void;
}

function sanitizeInjectedHtml(html: string) {
  if (typeof window === "undefined") return "";
  const template = document.createElement("template");
  template.innerHTML = html || "";
  
  const blockedTags = new Set(["script", "iframe", "object", "embed", "form", "input", "button", "link", "meta", "style", "svg", "video", "audio", "source", "track"]);
  const safeTags = new Set(["div", "span", "p", "a", "img", "br", "strong", "em", "u", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li"]);
  
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
        if (href && !href.toLowerCase().startsWith('javascript:') && !href.toLowerCase().startsWith('data:')) {
          safeAttrs['href'] = href; safeAttrs['target'] = '_blank'; safeAttrs['rel'] = 'noopener noreferrer';
        }
      } else if (tagName === 'img') {
        const src = element.getAttribute('src') || '';
        if (src && src.toLowerCase().startsWith('https:')) {
          safeAttrs['src'] = src; safeAttrs['alt'] = element.getAttribute('alt') || 'تصویر';
          const width = element.getAttribute('width'), height = element.getAttribute('height');
          if (width && /^\d+$/.test(width)) safeAttrs['width'] = width;
          if (height && /^\d+$/.test(height)) safeAttrs['height'] = height;
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

export function ScrollContainer({ children, className = "" }: { children: React.ReactNode, className?: string }) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [isDown, setIsDown] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    setIsDown(true);
    setStartX(e.pageX - scrollRef.current.offsetLeft);
    setScrollLeft(scrollRef.current.scrollLeft);
  };

  const onMouseLeave = () => setIsDown(false);
  const onMouseUp = () => setIsDown(false);
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDown || !scrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollRef.current.offsetLeft;
    const walk = (x - startX) * 2;
    scrollRef.current.scrollLeft = scrollLeft - walk;
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = scrollRef.current.clientWidth * 0.8;
      // RTL layout: content advances toward the left, so the horizontal
      // scroll direction is inverted compared to an LTR shelf.
      scrollRef.current.scrollBy({ left: direction === 'left' ? scrollAmount : -scrollAmount, behavior: 'smooth' });
    }
  };

  return (
    <div className="relative group min-w-0 max-w-full overflow-hidden">
       <button onClick={() => scroll('right')} className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 bg-black/40 hover:bg-black/70 backdrop-blur text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block disabled:opacity-0 focus:outline-none">
         <ChevronLeft className="w-5 h-5" />
       </button>
       <div 
         ref={scrollRef}
         onMouseDown={onMouseDown}
         onMouseLeave={onMouseLeave}
         onMouseUp={onMouseUp}
         onMouseMove={onMouseMove}
         className={`home-shelf-scroller flex min-w-0 max-w-full overflow-x-auto overscroll-x-contain pb-4 scrollbar-none snap-x snap-proximity sm:snap-mandatory cursor-grab active:cursor-grabbing ${className}`}
         style={{ msOverflowStyle: 'none', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}
       >
         {children}
       </div>
       <button onClick={() => scroll('left')} className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 bg-black/40 hover:bg-black/70 backdrop-blur text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block disabled:opacity-0 focus:outline-none">
         <ChevronRight className="w-5 h-5" />
       </button>
    </div>
  );
}

function normalizeFacet(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getNovelGenreFacets(novel: Novel) {
  return filterTaxonomyList([
    novel.genre,
    ...(novel.mainCategories || [])
  ].filter(Boolean));
}

function getNovelSearchFacets(novel: Novel) {
  return filterTaxonomyList([
    ...getNovelGenreFacets(novel),
    ...(novel.subCategories || []),
    ...(novel.tags || [])
  ].filter(Boolean));
}

function novelMatchesGenre(novel: Novel, genre: string) {
  if (genre === "All" || genre === "All Genres" || genre === "همه ژانرها") return true;
  const target = normalizeFacet(genre);
  return getNovelGenreFacets(novel).some((value) => normalizeFacet(value) === target);
}

function novelMatchesSubCategory(novel: Novel, subCategory: string) {
  if (subCategory === "All") return true;
  const target = normalizeFacet(subCategory);
  return filterTaxonomyList([...(novel.subCategories || []), ...(novel.tags || [])]).some((value) => normalizeFacet(value) === target);
}

function novelMatchesFacet(novel: Novel, facet: string) {
  if (facet === "All" || facet === "All Genres" || facet === "همه ژانرها") return true;
  const target = normalizeFacet(facet);
  return getNovelSearchFacets(novel).some((value) => normalizeFacet(value) === target);
}

function getTime(value: unknown) {
  const time = new Date(String(value || "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function handleClientLink(event: React.MouseEvent<HTMLAnchorElement>, action: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  action();
}

function getNovelCreatedTime(novel: Novel) {
  return getTime(novel.createdAt);
}

function getNovelUpdatedTime(novel: Novel) {
  const chapterTimes = (novel.chapters || [])
    .filter((chapter) => String(chapter.status || "").toLowerCase() === "published")
    .map((chapter) => Math.max(
      getTime(chapter.publishedAt),
      getTime(chapter.updatedAt),
      getTime(chapter.createdAt)
    ));
  return Math.max(getTime(novel.updatedAt), getTime(novel.createdAt), 0, ...chapterTimes);
}

function getOrCreateRecommendationUserId(authenticatedId?: string) {
  if (authenticatedId) return authenticatedId;
  const existing = window.localStorage.getItem("reptoc-anon-id") || "";
  if (/^anon-[a-f0-9]{32}$/i.test(existing)) return existing;
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  const anonymousId = `anon-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  window.localStorage.setItem("reptoc-anon-id", anonymousId);
  return anonymousId;
}

export default function Dashboard({
  novels,
  onSelectNovel,
  readingProgress,
  onResumeReading,
  onOpenWriter,
  onOpenEvent,
  theme,
  onToggleTheme,
  onBookmarkNovel,
  bookmarkedIds,
  onSelectAuthor,
  systemSettings,
  currentUser,
  initialSection,
  onCloseInitialSection,
}: DashboardProps) {
  const [selectedGenre, setSelectedGenre] = useState<string>("همه ژانرها");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<"popular" | "newest" | "oldest" | "best-rated" | "most-comments" | "views">("newest");
  const [viewAllSection, setViewAllSection] = useState<{title: string, list: Novel[]} | null>(() => {
    if (initialSection !== "rankings") return null;

    const approvedNovels = novels.filter(isNovelApprovedForDiscovery);
    const hasRatings = approvedNovels.some((novel) => Number(novel.rating || 0) > 0);
    return {
      title: "رتبه‌بندی همه رمان‌ها",
      list: [...approvedNovels].sort((a, b) => hasRatings
        ? (b.rating || 0) - (a.rating || 0) || (b.viewsCount || 0) - (a.viewsCount || 0)
        : (b.viewsCount || 0) - (a.viewsCount || 0) || (b.rating || 0) - (a.rating || 0)),
    };
  });
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  
  // View All Filters
  const [vaMainCat, setVaMainCat] = useState("All");
  const [vaSubCat, setVaSubCat] = useState("All");
  const [vaStatus, setVaStatus] = useState("All");
  const [vaOrigin, setVaOrigin] = useState("All");
  const [vaMinChapters, setVaMinChapters] = useState(0);
  const [vaDate, setVaDate] = useState("All");
  const [vaSort, setVaSort] = useState("default");
  const [vaPage, setVaPage] = useState(1);
  const PAGE_SIZE = 16;

  const [leaderboardMode, setLeaderboardMode] = useState<"rating" | "views">("rating");

  const openViewAll = (title: string, list: Novel[]) => {
    setVaMainCat("All");
    setVaSubCat("All");
    setVaStatus("All");
    setVaMinChapters(0);
    setVaDate("All");
    setVaSort("default");
    setVaPage(1);
    setViewAllSection({title, list});
  };

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    if (typeof media.addEventListener === "function") media.addEventListener("change", update);
    else media.addListener(update);
    return () => {
      if (typeof media.removeEventListener === "function") media.removeEventListener("change", update);
      else media.removeListener(update);
    };
  }, []);

  const searchActive = searchQuery.trim().length > 0;
  const genreFilteredNovels = React.useMemo(
    () => novels.filter((novel) => isNovelApprovedForDiscovery(novel) && novelMatchesGenre(novel, selectedGenre)),
    [novels, selectedGenre]
  );
  const filteredNovels = React.useMemo(
    () => searchActive
      ? searchNovelsLocal(genreFilteredNovels, searchQuery, genreFilteredNovels.length)
      : genreFilteredNovels,
    [genreFilteredNovels, searchActive, searchQuery]
  );

  // Sort novels based on criteria (popular, newest, oldest, best-rated, most-comments, views)
  const sortedNovels = React.useMemo(() => searchActive && sortBy === "newest" ? filteredNovels : [...filteredNovels].sort((a, b) => {
    if (sortBy === "popular") {
      return (b.bookmarksCount || 0) - (a.bookmarksCount || 0);
    }
    if (sortBy === "newest") {
      return getNovelCreatedTime(b) - getNovelCreatedTime(a);
    }
    if (sortBy === "oldest") {
      return getNovelCreatedTime(a) - getNovelCreatedTime(b);
    }
    if (sortBy === "best-rated") {
      return (b.rating || 0) - (a.rating || 0);
    }
    if (sortBy === "most-comments") {
      return (b.reviewsCount ?? b.reviews?.length ?? 0) - (a.reviewsCount ?? a.reviews?.length ?? 0);
    }
    if (sortBy === "views") {
      return (b.viewsCount || 0) - (a.viewsCount || 0);
    }
    return 0;
  }), [filteredNovels, searchActive, sortBy]);

  const GENRES_LIST = React.useMemo(() => {
    const values = new Map<string, string>();
    [...MAIN_CATEGORIES, ...novels.flatMap(getNovelGenreFacets)].forEach((value) => {
      const key = normalizeFacet(value);
      if (key && !values.has(key)) values.set(key, String(value));
    });
    return ["همه ژانرها", ...values.values()];
  }, []);

  const activeTheme = CONTRAST_THEMES[theme];

  const [systemStats, setSystemStats] = useState<{ totalViews: number; totalChapters: number } | null>(null);
  const [backendLeaderboard, setBackendLeaderboard] = useState<Novel[]>([]);
  const [realBackendSuggestions, setRealBackendSuggestions] = useState<Novel[]>([]);
  const [dismissedSuggestionIds, setDismissedSuggestionIds] = useState<Set<string>>(() => new Set());
  const [suggestionFeedbackBusy, setSuggestionFeedbackBusy] = useState<string | null>(null);
  const [contestOpen, setContestOpen] = useState(false);
  const [contestNovelId, setContestNovelId] = useState("");
  const [contestTitle, setContestTitle] = useState("");
  const [contestSynopsis, setContestSynopsis] = useState("");
  const [contestStatus, setContestStatus] = useState("");

  useEffect(() => {
    let active = true;
    api.getSystemStats().then(stats => {
      if (active && stats) {
        setSystemStats(stats);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [novels]);

  useEffect(() => {
    let active = true;
    api.getLeaderboard(leaderboardMode).then(leaderboard => {
      if (active && leaderboard) {
        setBackendLeaderboard(leaderboard.slice(0, 3));
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [leaderboardMode]);

  useEffect(() => {
    let active = true;
    const resolvedUserId = getOrCreateRecommendationUserId(currentUser?.id);
    const device = window.innerWidth < 768 ? 'mobile' : 'desktop';
    api.getRecommendedNovels(resolvedUserId, device, selectedGenre === "همه ژانرها" ? "" : selectedGenre).then(recs => {
      if (active && recs && recs.length > 0) {
        setRealBackendSuggestions(recs.slice(0, 4));
      } else if (active) {
        setRealBackendSuggestions([]);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [currentUser?.id, selectedGenre]);

  useEffect(() => {
    setDismissedSuggestionIds(new Set());
  }, [currentUser?.id]);

  const dismissSuggestion = async (novelId: string) => {
    if (suggestionFeedbackBusy) return;
    const resolvedUserId = getOrCreateRecommendationUserId(currentUser?.id);
    setSuggestionFeedbackBusy(novelId);
    setDismissedSuggestionIds((current) => new Set(current).add(novelId));
    try {
      const accepted = await api.trackEvent(resolvedUserId, novelId, "not_interested");
      if (!accepted) throw new Error("suggestion feedback was not accepted");
      const device = window.innerWidth < 768 ? "mobile" : "desktop";
      const refreshed = await api.getRecommendedNovels(
        resolvedUserId,
        device,
        selectedGenre === "همه ژانرها" ? "" : selectedGenre
      );
      setRealBackendSuggestions((refreshed || []).filter((novel) => novel.id !== novelId).slice(0, 4));
    } catch {
      setDismissedSuggestionIds((current) => {
        const restored = new Set(current);
        restored.delete(novelId);
        return restored;
      });
    } finally {
      setSuggestionFeedbackBusy(null);
    }
  };

  // Use live database system stats with client fallback if API is not loaded yet
  const totalChapters = systemStats ? systemStats.totalChapters : novels.reduce((acc, n) => acc + (n.chapters?.length || 0), 0);
  const totalViews = systemStats ? systemStats.totalViews : novels.reduce((acc, n) => acc + (n.viewsCount || 0), 0);

  const sourceData = filteredNovels;
  const hasRatingData = sourceData.some((novel) => Number(novel.rating || 0) > 0);

  useEffect(() => {
    if (leaderboardMode === "rating" && !hasRatingData) {
      setLeaderboardMode("views");
    }
  }, [hasRatingData, leaderboardMode]);

  // Real-time Top Read and Newest:
  const { mustReadNovels, newestNovels, updatedNovels } = React.useMemo(() => ({
    mustReadNovels: [...sourceData].sort((a, b) => (
      (b.viewsCount || 0) - (a.viewsCount || 0) ||
      (b.rating || 0) - (a.rating || 0) ||
      getNovelUpdatedTime(b) - getNovelUpdatedTime(a)
    )).slice(0, 4),
    newestNovels: [...sourceData].sort((a, b) => getNovelCreatedTime(b) - getNovelCreatedTime(a)).slice(0, 4),
    updatedNovels: [...sourceData].sort((a, b) => getNovelUpdatedTime(b) - getNovelUpdatedTime(a)).slice(0, 4),
  }), [sourceData]);

  const hydratedSuggestions = React.useMemo(() => realBackendSuggestions.map((recommendation) => {
    const loadedNovel = novels.find((novel) => novel.id === recommendation.id);
    if (!loadedNovel) return recommendation;
    return {
      ...loadedNovel,
      ...recommendation,
      chapters: (loadedNovel.chapters?.length || 0) >= (recommendation.chapters?.length || 0)
        ? loadedNovel.chapters
        : recommendation.chapters
    };
  }), [novels, realBackendSuggestions]);
  const genreMatchedSuggestions = selectedGenre === "همه ژانرها"
    ? hydratedSuggestions
    : hydratedSuggestions.filter((novel) => novelMatchesGenre(novel, selectedGenre));
  const suggestionNovels = (genreMatchedSuggestions.length > 0
    ? genreMatchedSuggestions
    : selectedGenre === "همه ژانرها"
      ? []
      : sourceData.slice(0, 4)).filter((novel) => !dismissedSuggestionIds.has(novel.id));

  // Leaderboard is computed and returned by the database directly via API, fallback to client-side sort if DB list is loading
  const leaderboardSource = leaderboardMode === "rating"
    ? sourceData.filter((novel) => Number(novel.rating || 0) > 0)
    : sourceData;
  const validBackendLeaderboard = backendLeaderboard.filter(
    (novel) => leaderboardMode !== "rating" || Number(novel.rating || 0) > 0
  );
  const leaderboardNovels = validBackendLeaderboard.length > 0
    ? validBackendLeaderboard
    : [...leaderboardSource].sort((a, b) => {
       if (leaderboardMode === "rating") return (b.rating || 0) - (a.rating || 0);
       return (b.viewsCount || 0) - (a.viewsCount || 0);
    }).slice(0, 3);

  if (viewAllSection) {
    let finalFilteredList = [...viewAllSection.list];
    
    // Apply filters
    if (vaMainCat !== "All") finalFilteredList = finalFilteredList.filter(n => novelMatchesGenre(n, vaMainCat));
    if (vaSubCat !== "All") finalFilteredList = finalFilteredList.filter(n => novelMatchesSubCategory(n, vaSubCat));
    if (vaStatus !== "All") finalFilteredList = finalFilteredList.filter(n => n.status === vaStatus);
    if (vaOrigin !== "All") finalFilteredList = finalFilteredList.filter(n => (n.originType === "translated" ? "translated" : "original") === vaOrigin);
    if (vaMinChapters > 0) finalFilteredList = finalFilteredList.filter(n => (n.chapters?.length || 0) >= vaMinChapters);
    if (vaDate !== "All") {
      const now = new Date();
      finalFilteredList = finalFilteredList.filter(n => {
        const d = new Date(getNovelCreatedTime(n));
        if (vaDate === "This Month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        if (vaDate === "This Year") return d.getFullYear() === now.getFullYear();
        return true;
      });
    }

    // Apply sort
    if (vaSort === "Newest First") {
      finalFilteredList.sort((a, b) => getNovelCreatedTime(b) - getNovelCreatedTime(a));
    } else if (vaSort === "Oldest First") {
      finalFilteredList.sort((a, b) => getNovelCreatedTime(a) - getNovelCreatedTime(b));
    } else if (vaSort === "Most Views") {
      finalFilteredList.sort((a, b) => (b.viewsCount || 0) - (a.viewsCount || 0));
    } else if (vaSort === "Highest Rating") {
      finalFilteredList.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }

    const totalPages = Math.ceil(finalFilteredList.length / PAGE_SIZE);
    const currentViewList = finalFilteredList.slice((vaPage - 1) * PAGE_SIZE, vaPage * PAGE_SIZE);
    const isRankingView = initialSection === "rankings" || /rankings|رتبه‌بندی/i.test(viewAllSection.title);

    return (
      <motion.div 
        initial={isMobile ? false : { opacity: 0, y: 20 }}
        animate={isMobile ? undefined : { opacity: 1, y: 0 }}
        exit={isMobile ? undefined : { opacity: 0, y: -20 }}
        className="mobile-home-dashboard space-y-6 pb-16"
      >
        <div className={`p-6 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0e0a1c]" : "bg-white"} ${activeTheme.shadow}`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-violet-950/40 pb-6 mb-6">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => onCloseInitialSection ? onCloseInitialSection() : setViewAllSection(null)} 
                aria-label="بازگشت به همه رمان‌ها"
                className="p-2 rounded-xl border border-slate-200 dark:border-violet-950/40 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 hover:text-violet-500 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100">{viewAllSection.title}</h2>
            </div>
            
            {/* Active Filters Summary count */}
            <div className="text-sm font-medium text-slate-500">
              نمایش <span className="font-bold text-violet-500">{finalFilteredList.length}</span> رمان
            </div>
          </div>

          {/* Filter Bar */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
            <select value={vaMainCat} onChange={(e) => setVaMainCat(e.target.value)} className={`w-full p-2.5 rounded-xl border ${activeTheme.border} ${activeTheme.card} text-xs font-bold text-slate-600 dark:text-slate-300 focus:outline-none focus:border-violet-500 cursor-pointer`}>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="All">همه دسته‌ها</option>
              {MAIN_CATEGORIES.map(c => <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" key={c} value={c}>{c}</option>)}
            </select>
            
            <select value={vaSubCat} onChange={(e) => setVaSubCat(e.target.value)} className={`w-full p-2.5 rounded-xl border ${activeTheme.border} ${activeTheme.card} text-xs font-bold text-slate-600 dark:text-slate-300 focus:outline-none focus:border-violet-500 cursor-pointer`}>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="All">همه زیردسته‌ها</option>
              {SUB_CATEGORIES.map(c => <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" key={c} value={c}>{c}</option>)}
            </select>
            
            <select value={vaStatus} onChange={(e) => setVaStatus(e.target.value)} className={`w-full p-2.5 rounded-xl border ${activeTheme.border} ${activeTheme.card} text-xs font-bold text-slate-600 dark:text-slate-300 focus:outline-none focus:border-violet-500 cursor-pointer`}>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="All">همه وضعیت‌ها</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="Ongoing">در حال انتشار</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="Completed">تکمیل‌شده</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="Hiatus">متوقف‌شده</option>
            </select>

            <select value={vaOrigin} onChange={(e) => setVaOrigin(e.target.value)} className={`w-full p-2.5 rounded-xl border ${activeTheme.border} ${activeTheme.card} text-xs font-bold text-slate-600 dark:text-slate-300 focus:outline-none focus:border-violet-500 cursor-pointer`}>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="All">همه آثار (اصلی/ترجمه)</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="original">اورجینال</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="translated">ترجمه‌شده</option>
            </select>

            <select value={vaMinChapters} onChange={(e) => setVaMinChapters(Number(e.target.value))} className={`w-full p-2.5 rounded-xl border ${activeTheme.border} ${activeTheme.card} text-xs font-bold text-slate-600 dark:text-slate-300 focus:outline-none focus:border-violet-500 cursor-pointer`}>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value={0}>هر تعداد فصل</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value={10}>بیش از 10 فصل</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value={50}>بیش از 50 فصل</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value={100}>بیش از 100 فصل</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value={300}>بیش از 300 فصل</option>
            </select>

            <select value={vaDate} onChange={(e) => setVaDate(e.target.value)} className={`w-full p-2.5 rounded-xl border ${activeTheme.border} ${activeTheme.card} text-xs font-bold text-slate-600 dark:text-slate-300 focus:outline-none focus:border-violet-500 cursor-pointer`}>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="All">هر زمان انتشار</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="This Month">این ماه</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="This Year">امسال</option>
            </select>

            <select value={vaSort} onChange={(e) => setVaSort(e.target.value)} className={`w-full p-2.5 rounded-xl border ${activeTheme.border} ${activeTheme.card} text-xs font-bold text-slate-600 dark:text-slate-300 focus:outline-none focus:border-violet-500 cursor-pointer dark:bg-slate-900`}>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="default">ترتیب پیش‌فرض</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="Newest First">جدیدترین</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="Oldest First">قدیمی‌ترین</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="Most Views">بیشترین بازدید</option>
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" value="Highest Rating">بالاترین امتیاز</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 ml:grid-cols-3 xl:grid-cols-4 gap-6">
            {finalFilteredList.length > 0 ? (
              currentViewList.map((novel, index) => (
                <NovelCard key={novel.id} novel={novel} rank={isRankingView ? (vaPage - 1) * PAGE_SIZE + index + 1 : undefined} theme={theme} isBookmarked={bookmarkedIds.includes(novel.id)} onSelectNovel={onSelectNovel} onBookmarkNovel={onBookmarkNovel} onSelectAuthor={onSelectAuthor} activeTheme={activeTheme} disableMotion={isMobile} />
              ))
            ) : (
              <div className="col-span-full py-20 text-center flex flex-col items-center">
                 <Filter className="w-12 h-12 text-slate-300 dark:text-slate-700 mb-4" />
                 <h3 className="text-xl font-bold text-slate-600 dark:text-slate-400">هیچ رمانی با فیلترهای شما همخوانی ندارد</h3>
                 <button onClick={() => openViewAll(viewAllSection.title, viewAllSection.list)} className="mt-4 px-4 py-2 bg-violet-500/10 text-violet-500 font-bold rounded-lg hover:bg-violet-500/20">پاک کردن فیلترها</button>
              </div>
            )}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8 pt-8 border-t border-slate-200 dark:border-slate-800">
              <button 
                onClick={() => setVaPage(p => Math.max(1, p - 1))}
                disabled={vaPage === 1}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-violet-500 disabled:opacity-50 disabled:hover:text-slate-500 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="text-sm font-bold text-slate-600 dark:text-slate-400 px-4">
                صفحه {vaPage} از {totalPages}
              </div>
              <button 
                onClick={() => setVaPage(p => Math.min(totalPages, p + 1))}
                disabled={vaPage === totalPages}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-violet-500 disabled:opacity-50 disabled:hover:text-slate-500 transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={isMobile ? false : { opacity: 0, y: 20 }}
      animate={isMobile ? undefined : { opacity: 1, y: 0 }}
      exit={isMobile ? undefined : { opacity: 0, y: -20 }}
      className="mobile-home-dashboard space-y-10 pb-16"
    >
      <HomepageHeroCarousel
        theme={theme}
        activeTheme={activeTheme}
        systemSettings={systemSettings}
        onOpenWriter={onOpenWriter}
        onOpenEvent={onOpenEvent}
      />


      {/* Persistent Statistics Bar */}
      <section id="stats-banner" className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "رمان‌های بایگانی‌شده", value: novels.length, icon: BookOpen, color: "text-violet-400" },
          { label: "فصل‌های منتشرشده", value: totalChapters, icon: LayoutGrid, color: "text-purple-400" },
          { label: "بازدیدهای جامعه", value: totalViews.toLocaleString(), icon: Eye, color: "text-fuchsia-400" },
          { label: "مسابقه‌های ماهانه", value: `${systemSettings?.activeContestsCount || 0} فعال`, icon: Flame, color: "text-amber-400" },
        ].map((stat, i) => (
          <div 
            key={i} 
            className={`p-3 sm:p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 ${activeTheme.shadow}`}
          >
            <div className={`p-2.5 sm:p-3 rounded-xl bg-violet-500/5 ${stat.color} shrink-0`}>
              <stat.icon className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-lg sm:text-xl md:text-2xl font-bold tracking-tight leading-none">{stat.value}</div>
              <div className="text-[10px] sm:text-xs text-slate-500 font-medium mt-1 truncate" title={stat.label}>{stat.label}</div>
            </div>
          </div>
        ))}
      </section>

      {/* Layout Grid with Novel Feed & Writing Prompts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Main Feed */}
        <div id="novels-explore" className="min-w-0 max-w-full overflow-hidden lg:col-span-2 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
                <LayoutGrid className="w-5 h-5 text-violet-500" />
                <span>کاوش دنیاهای تازه</span>
              </h2>
              <p className="text-xs text-slate-500 font-medium font-sans">مرور رمان‌ها و آثار محبوب جامعه</p>
            </div>
 
            {/* Action panel with Search & Sort controls */}
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              {/* Sort selector */}
              <div className="relative flex items-center">
                <SlidersHorizontal className="absolute right-3 w-3.5 h-3.5 text-violet-400 pointer-events-none" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className={`pl-8 pr-8 py-2 text-[11px] font-mono font-bold rounded-xl border border-slate-700/10 focus:outline-none transition-all appearance-none cursor-pointer ${
                    theme === "dark" 
                      ? "bg-[#0e0a1c] border-violet-950/60 text-violet-400 focus:border-violet-500" 
                      : "bg-white border-stone-200 text-stone-850 focus:border-purple-500"
                  }`}
                >
                  <option className="bg-white dark:bg-[#0e0a1c] text-slate-900 dark:text-slate-100" value="popular">🔥 محبوب</option>
                  <option className="bg-white dark:bg-[#0e0a1c] text-slate-900 dark:text-slate-100" value="best-rated">⭐ بالاترین امتیاز</option>
                  <option className="bg-white dark:bg-[#0e0a1c] text-slate-900 dark:text-slate-100" value="views">👁️ بیشترین بازدید</option>
                  <option className="bg-white dark:bg-[#0e0a1c] text-slate-900 dark:text-slate-100" value="most-comments">💬 بیشترین دیدگاه</option>
                  <option className="bg-white dark:bg-[#0e0a1c] text-slate-900 dark:text-slate-100" value="newest">📅 جدیدترین</option>
                  <option className="bg-white dark:bg-[#0e0a1c] text-slate-900 dark:text-slate-100" value="oldest">⏳ قدیمی‌ترین</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center px-2.5 text-slate-500">
                  <svg className="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                  </svg>
                </div>
              </div>

              {/* Live Search Input */}
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="جستجوی عنوان یا نویسنده..."
                  className={`w-full sm:w-56 pr-9 pl-4 py-2 text-xs rounded-xl border-1 focus:outline-none transition-all ${
                    theme === "dark" 
                      ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500" 
                      : "bg-white border-stone-200 text-stone-900 focus:border-amber-500"
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Genre Filters Row */}
          <div className="relative w-full overflow-hidden">
            <ScrollContainer className="gap-2">
              {GENRES_LIST.map((genre) => {
                const isActive = selectedGenre === genre;
                return (
                  <button
                    key={genre}
                    onClick={() => setSelectedGenre(genre)}
                    className={`px-5 py-2.5 rounded-full text-xs font-extrabold whitespace-nowrap transition-all shrink-0 snap-start shadow-sm border ${
                      isActive
                        ? theme === "dark" 
                          ? "bg-gradient-to-r from-violet-600 to-purple-600 text-white border-violet-500"
                          : "bg-gradient-to-r from-amber-500 to-orange-500 text-white border-amber-600"
                        : theme === "dark"
                          ? "bg-[#0e0a1c] border-violet-950/60 text-slate-300 hover:bg-slate-800 hover:text-white"
                          : "bg-white border-stone-200 text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                    }`}
                  >
                    {genre}
                  </button>
                );
              })}
            </ScrollContainer>
          </div>

          {/* Conditional Sections vs Active Filtered List */}
          {(searchQuery !== "") ? (
            sortedNovels.length === 0 ? (
              <div className={`p-12 text-center rounded-2xl border ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}>
                <BookOpen className="w-12 h-12 text-slate-600 mx-auto opacity-40 mb-4" />
                <h3 className="font-bold text-lg mb-1">رمان مناسبی پیدا نشد</h3>
                <p className="text-sm text-slate-500 max-w-sm mx-auto">هیچ رمانی مطابق با جستجوی شما پیدا نشد. خودتان یکی بنویسید!</p>
                <button
                  onClick={onOpenWriter}
                  className="mt-4 px-4 py-2 bg-violet-500 text-white rounded-xl text-xs font-bold transition-transform hover:scale-[1.03] cursor-pointer"
                >
                  ورود به استودیوی نگارش
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 relative">
                <AnimatePresence mode="popLayout">
                  {sortedNovels.map((novel) => (
                    <NovelCard key={novel.id} novel={novel} theme={theme} isBookmarked={bookmarkedIds.includes(novel.id)} onSelectNovel={onSelectNovel} onBookmarkNovel={onBookmarkNovel} onSelectAuthor={onSelectAuthor} activeTheme={activeTheme} disableMotion={isMobile} />
                  ))}
                </AnimatePresence>
              </div>
            )
          ) : (
            <div className="space-y-10">
              {/* Suggestion Section */}
              {systemSettings?.section_suggestion_enabled !== false && (
                <section className="mobile-home-deferred">
                  <div className="flex justify-between items-end mb-4">
                    <div>
                      <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-500"/> پیشنهادی برای شما</h3>
                      <p className="text-xs text-slate-500">بر اساس مطالعه‌ها، کتابخانه و نویسندگان دنبال‌شدهٔ شما</p>
                    </div>
                    {suggestionNovels.length > 0 && <button onClick={() => openViewAll("پیشنهادی برای شما", suggestionNovels)} className="text-xs font-bold text-violet-500 hover:text-violet-400">مشاهده همه {" >"}</button>}
                  </div>
                  {suggestionNovels.length > 0 ? (
                    <ScrollContainer className="gap-6">
                      {suggestionNovels.map((novel) => (
                        <div key={novel.id} className="w-[min(280px,calc(100vw-3rem))] shrink-0 snap-start">
                          <div className="mb-2 flex min-h-7 items-center justify-between gap-2">
                            {novel.recommendationReason && (
                              <div className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-[11px] font-bold text-violet-500">
                                <Sparkles className="h-3 w-3 shrink-0" />
                                <span className="truncate">{novel.recommendationReason}</span>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => dismissSuggestion(novel.id)}
                              disabled={suggestionFeedbackBusy === novel.id}
                              className="mr-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-500/20 px-2 py-1 text-[10px] font-bold text-slate-500 transition-colors hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-500 disabled:cursor-wait disabled:opacity-50"
                              title="این داستان دیگر به من پیشنهاد نشود"
                              aria-label={`علاقه‌ای به ${novel.title} ندارم`}
                            >
                              <EyeOff className="h-3 w-3" />
                              علاقه ندارم
                            </button>
                          </div>
                          <NovelCard novel={novel} theme={theme} isBookmarked={bookmarkedIds.includes(novel.id)} onSelectNovel={onSelectNovel} onBookmarkNovel={onBookmarkNovel} onSelectAuthor={onSelectAuthor} activeTheme={activeTheme} disableMotion={isMobile} />
                        </div>
                      ))}
                    </ScrollContainer>
                  ) : (
                    <div className={`p-8 text-center rounded-2xl border ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}>
                       <p className="text-sm font-bold text-slate-500">هیچ رمانی در این بخش پیدا نشد.</p>
                    </div>
                  )}
                </section>
              )}
              {/* Most Read */}
              {systemSettings?.section_must_read_enabled !== false && (
                <section className="mobile-home-deferred">
                  <div className="flex justify-between items-end mb-4">
                    <div>
                      <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Star className="w-4 h-4 text-amber-500"/> پرخواننده‌ترین</h3>
                      <p className="text-xs text-slate-500">بهترین رمان‌ها با انتخاب دستی برای شما</p>
                    </div>
                    {mustReadNovels.length > 0 && <button onClick={() => openViewAll("پرخواننده‌ترین", [...sourceData].sort((a, b) => ((b.viewsCount || 0) - (a.viewsCount || 0) || (b.rating || 0) - (a.rating || 0))))} className="text-xs font-bold text-amber-500 hover:text-amber-400">مشاهده همه {" >"}</button>}
                  </div>
                  {mustReadNovels.length > 0 ? (
                    <ScrollContainer className="gap-6">
                      {mustReadNovels.map((novel) => (
                        <div key={novel.id} className="w-[min(280px,calc(100vw-3rem))] shrink-0 snap-start">
                          <NovelCard novel={novel} theme={theme} isBookmarked={bookmarkedIds.includes(novel.id)} onSelectNovel={onSelectNovel} onBookmarkNovel={onBookmarkNovel} onSelectAuthor={onSelectAuthor} activeTheme={activeTheme} disableMotion={isMobile} />
                        </div>
                      ))}
                    </ScrollContainer>
                  ) : (
                    <div className={`p-8 text-center rounded-2xl border ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}>
                       <p className="text-sm font-bold text-slate-500">هیچ رمانی در این بخش پیدا نشد.</p>
                    </div>
                  )}
                </section>
              )}
              {/* Continue Reading */}
              {readingProgress.length > 0 && (
                <section className="mobile-home-deferred">
                  <div className="flex justify-between items-end mb-4">
                    <div>
                      <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><BookOpen className="w-4 h-4 text-purple-400"/> ادامه مطالعه</h3>
                    </div>
                  </div>
                  <ScrollContainer className="gap-4">
                    {readingProgress.map((progress) => (
                      <div
                        key={progress.novelId}
                        className={`relative overflow-visible w-[320px] shrink-0 snap-center sm:snap-start p-4 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-slate-900/40 hover:bg-slate-900/80" : "bg-white hover:bg-slate-50"} flex gap-4 items-center group transition-all duration-300 hover:-translate-y-1 cursor-pointer shadow-sm hover:shadow-md`}
                        onClick={() => onResumeReading(progress)}
                      >
                        <SafeImage
                          src={progress.novelCover}
                          alt={progress.novelTitle}
                          referrerPolicy="no-referrer"
                          className="w-16 h-24 rounded-xl object-cover flex-shrink-0 bg-slate-900 shadow-md group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="flex-1 min-w-0 pr-1">
                          <div className="text-[10px] font-extrabold uppercase text-purple-500 flex items-center justify-between mb-1">
                            <span>فصل {progress.chapterNumber}</span>
                            <span className="bg-purple-500/10 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full">{Math.round(progress.scrollPercent || 0)}%</span>
                          </div>
                          <h3 className={`font-black text-sm truncate mt-0.5 transition-colors ${theme === "dark" ? "text-slate-100 group-hover:text-purple-400" : "text-slate-900 group-hover:text-purple-600"}`}>
                            {progress.novelTitle}
                          </h3>
                          <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
                            {progress.chapterTitle}
                          </p>
                          
                          {/* Progress Bar Container */}
                          <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 mt-3 overflow-hidden shadow-inner">
                            <div 
                              className="bg-gradient-to-r from-purple-500 to-violet-500 h-1.5 rounded-full transition-all duration-500"
                              style={{ width: `${Math.max(5, progress.scrollPercent)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </ScrollContainer>
                </section>
              )}
              {/* New Releases */}
              {systemSettings?.section_new_releases_enabled !== false && (
                <section className="mobile-home-deferred">
                  <div className="flex justify-between items-end mb-4">
                    <div>
                      <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Flame className="w-4 h-4 text-orange-500"/> آثار تازه</h3>
                      <p className="text-xs text-slate-500">داستان‌های تازه همین حالا منتشر شدند</p>
                    </div>
                    {newestNovels.length > 0 && <button onClick={() => openViewAll("آثار تازه", [...sourceData].sort((a, b) => getNovelCreatedTime(b) - getNovelCreatedTime(a)))} className="text-xs font-bold text-orange-500 hover:text-orange-400">مشاهده همه {" >"}</button>}
                  </div>
                  {newestNovels.length > 0 ? (
                    <ScrollContainer className="gap-6">
                      {newestNovels.map((novel) => (
                        <div key={novel.id} className="w-[min(280px,calc(100vw-3rem))] shrink-0 snap-start">
                          <NovelCard novel={novel} theme={theme} isBookmarked={bookmarkedIds.includes(novel.id)} onSelectNovel={onSelectNovel} onBookmarkNovel={onBookmarkNovel} onSelectAuthor={onSelectAuthor} activeTheme={activeTheme} disableMotion={isMobile} />
                        </div>
                      ))}
                    </ScrollContainer>
                  ) : (
                    <div className={`p-8 text-center rounded-2xl border ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}>
                       <p className="text-sm font-bold text-slate-500">هیچ رمانی در این بخش پیدا نشد.</p>
                    </div>
                  )}
                </section>
              )}
              {/* Recently Updated */}
              {systemSettings?.section_recently_updated_enabled !== false && (
                <section className="mobile-home-deferred">
                  <div className="flex justify-between items-end mb-4">
                    <div>
                      <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-500"/> اخیراً به‌روزرسانی‌شده</h3>
                      <p className="text-xs text-slate-500">آخرین به‌روزرسانی‌ها</p>
                    </div>
                    {updatedNovels.length > 0 && <button onClick={() => openViewAll("اخیراً به‌روزرسانی‌شده", [...sourceData].sort((a, b) => getNovelUpdatedTime(b) - getNovelUpdatedTime(a)))} className="text-xs font-bold text-emerald-500 hover:text-emerald-400">مشاهده همه {" >"}</button>}
                  </div>
                  {updatedNovels.length > 0 ? (
                    <ScrollContainer className="gap-6">
                      {updatedNovels.map((novel) => (
                        <div key={novel.id} className="w-[min(280px,calc(100vw-3rem))] shrink-0 snap-start">
                          <NovelCard novel={novel} theme={theme} isBookmarked={bookmarkedIds.includes(novel.id)} onSelectNovel={onSelectNovel} onBookmarkNovel={onBookmarkNovel} onSelectAuthor={onSelectAuthor} activeTheme={activeTheme} disableMotion={isMobile} />
                        </div>
                      ))}
                    </ScrollContainer>
                  ) : (
                    <div className={`p-8 text-center rounded-2xl border ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}>
                       <p className="text-sm font-bold text-slate-500">هیچ رمانی در این بخش پیدا نشد.</p>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>

        {/* Sidebar Panel Widgets */}
        <div className="mobile-home-deferred space-y-6">
          {/* Active Contests & Rewards Banner */}
          {systemSettings?.activeContest && (
            <div className={`p-6 rounded-2xl border ${activeTheme.border} bg-gradient-to-br ${theme === "dark" ? "from-[#080d1e] to-black" : "from-stone-50 to-amber-50/20"} space-y-4 ${activeTheme.shadow}`}>
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm uppercase font-mono">
                <Flame className="w-5 h-5 animate-pulse" />
                <span>رویداد فعال نگارش</span>
              </div>

              <h3 className="text-lg font-black tracking-tight leading-snug">
                {systemSettings.activeContest.title}
              </h3>

              <p className="text-xs text-slate-500 leading-relaxed">
                موضوع: <span className="font-bold text-violet-400 dark:text-violet-300">{systemSettings.activeContest.theme}</span>. {systemSettings.activeContest.description}
              </p>

              <button
                onClick={() => {
                  setContestOpen(true);
                  const firstOwnNovel = currentUser ? novels.find((novel) => novel.author_id === currentUser.id) : null;
                  setContestNovelId(firstOwnNovel?.id || "");
                  setContestTitle(firstOwnNovel?.title || "");
                  setContestSynopsis(firstOwnNovel?.description || "");
                }}
                className="w-full py-2.5 rounded-xl text-xs font-bold bg-violet-500 hover:bg-violet-600 text-white border border-transparent shadow transition-all duration-300 cursor-pointer"
              >
                همین حالا در مسابقه شرکت کنید
              </button>
              {contestOpen && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!currentUser) {
                      setContestStatus("لطفاً پیش از ارسال، وارد حساب کاربری شوید.");
                      return;
                    }
                    const result = await api.submitContestEntry(systemSettings.activeContest.id, {
                      novelId: contestNovelId || undefined,
                      title: contestTitle,
                      synopsis: contestSynopsis
                    });
                    setContestStatus(result?.success ? "اثر شما در مسابقه ثبت شد." : result?.error || "ارسال ناموفق بود.");
                  }}
                  className="space-y-3 rounded-xl border border-violet-500/20 bg-black/20 p-3"
                >
                  <select
                    value={contestNovelId}
                    onChange={(e) => {
                      setContestNovelId(e.target.value);
                      const selected = novels.find((novel) => novel.id === e.target.value);
                      if (selected) {
                        setContestTitle(selected.title);
                        setContestSynopsis(selected.description);
                      }
                    }}
                    className="w-full rounded-lg border border-violet-500/20 bg-black/30 p-2 text-xs outline-none"
                  >
                    <option value="">اثر مستقل جدید</option>
                    {novels.filter((novel) => currentUser && novel.author_id === currentUser.id).map((novel) => (
                      <option key={novel.id} value={novel.id}>{novel.title}</option>
                    ))}
                  </select>
                  <input
                    value={contestTitle}
                    onChange={(e) => setContestTitle(e.target.value)}
                    placeholder="عنوان اثر"
                    className="w-full rounded-lg border border-violet-500/20 bg-black/30 p-2 text-xs outline-none"
                  />
                  <textarea
                    rows={3}
                    value={contestSynopsis}
                    onChange={(e) => setContestSynopsis(e.target.value)}
                    placeholder="خلاصه اثر"
                    className="w-full rounded-lg border border-violet-500/20 bg-black/30 p-2 text-xs outline-none"
                  />
                  {contestStatus && <p className="text-[10px] text-amber-400">{contestStatus}</p>}
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">ارسال اثر</button>
                    <button type="button" onClick={() => onOpenWriter()} className="rounded-lg border border-violet-500/30 px-3 py-2 text-xs font-bold text-violet-400">باز کردن استودیوی نگارش</button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Leaderboard Rating/Views */}
          <div className={`p-6 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-gradient-to-b from-[#0e0a1c] to-black" : "bg-gradient-to-b from-white to-slate-50"} space-y-6 ${activeTheme.shadow} relative overflow-hidden group`}>
            {/* Background glowing effects */}
            {theme === "dark" && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-purple-500/20 blur-[50px] pointer-events-none rounded-full" />
            )}
            
            <div className="flex items-center justify-between relative z-10">
              <h3 className="font-black text-base flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-purple-500" />
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-500 to-violet-500">جدول برترین‌ها</span>
              </h3>
              <div className="flex border border-slate-700/20 dark:border-violet-950/60 rounded-lg overflow-hidden shrink-0 bg-white/50 dark:bg-black/50 backdrop-blur-sm">
                {hasRatingData && (
                  <button 
                    onClick={() => setLeaderboardMode("rating")}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase transition-colors ${leaderboardMode === "rating" ? "bg-amber-500 text-white shadow-inner" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                  >
                    امتیاز
                  </button>
                )}
                <button 
                  onClick={() => setLeaderboardMode("views")}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase transition-colors ${leaderboardMode === "views" ? "bg-violet-600 text-white shadow-inner" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                >
                  بازدید
                </button>
              </div>
            </div>

            {leaderboardNovels.length >= 3 ? (
              <div className="flex items-end justify-center gap-2 h-[180px] mt-8 relative z-10">
                {/* 2nd Place */}
                <a
                  href={`/novels/${encodeURIComponent(leaderboardNovels[1].id)}`}
                  className="flex flex-col items-center w-1/3 cursor-pointer group/podium"
                  onClick={(event) => handleClientLink(event, () => onSelectNovel(leaderboardNovels[1]))}
                >
                  <SafeImage src={leaderboardNovels[1].coverUrl || leaderboardNovels[1].cover} className="w-12 h-16 rounded-md object-cover shadow-lg mb-2 group-hover/podium:-translate-y-2 transition-transform duration-300 border border-slate-300 dark:border-slate-700" alt="جلد رمان رتبه دوم" />
                  <div className="text-[10px] font-bold text-center mb-1 w-full px-1 truncate text-slate-500 dark:text-slate-400">
                    {leaderboardNovels[1].title}
                  </div>
                  <div className={`w-full bg-gradient-to-t from-slate-300 to-slate-200 dark:from-slate-800 dark:to-slate-700 rounded-t-xl h-20 flex justify-center pt-2 relative overflow-hidden shadow-inner`}>
                    <div className="absolute inset-0 bg-white/40 dark:bg-white/5" />
                    <span className="font-black text-slate-500 dark:text-slate-300 text-xl drop-shadow-md">2</span>
                  </div>
                </a>

                {/* 1st Place */}
                <a
                  href={`/novels/${encodeURIComponent(leaderboardNovels[0].id)}`}
                  className="flex flex-col items-center w-1/3 cursor-pointer group/podium -mb-2 z-10"
                  onClick={(event) => handleClientLink(event, () => onSelectNovel(leaderboardNovels[0]))}
                >
                  <div className="relative">
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 ">
                       <Star className="w-6 h-6 fill-amber-400 text-amber-500 drop-shadow-lg animate-pulse" />
                    </div>
                    <SafeImage src={leaderboardNovels[0].coverUrl || leaderboardNovels[0].cover} className="w-16 h-24 rounded-md object-cover shadow-xl mb-2 group-hover/podium:-translate-y-2 transition-transform duration-300 border-2 border-amber-400" alt="جلد رمان رتبه اول" />
                  </div>
                  <div className="text-xs font-black text-center mb-1 w-full px-1 truncate text-amber-600 dark:text-amber-400 drop-shadow-sm">
                    {leaderboardNovels[0].title}
                  </div>
                  <div className={`w-full bg-gradient-to-t from-amber-400 to-yellow-300 dark:from-amber-600 dark:to-yellow-500 rounded-t-xl h-28 flex justify-center pt-2 relative overflow-hidden shadow-2xl`}>
                     <div className="absolute inset-0 bg-white/40 dark:bg-white/10" />
                     <span className="font-black text-amber-900 dark:text-amber-100 text-2xl drop-shadow-md">1</span>
                  </div>
                </a>

                {/* 3rd Place */}
                <a
                  href={`/novels/${encodeURIComponent(leaderboardNovels[2].id)}`}
                  className="flex flex-col items-center w-1/3 cursor-pointer group/podium"
                  onClick={(event) => handleClientLink(event, () => onSelectNovel(leaderboardNovels[2]))}
                >
                  <SafeImage src={leaderboardNovels[2].coverUrl || leaderboardNovels[2].cover} className="w-10 h-14 rounded-md object-cover shadow-lg mb-2 group-hover/podium:-translate-y-2 transition-transform duration-300 border border-amber-900/30 dark:border-[#a46329]" alt="جلد رمان رتبه سوم" />
                  <div className="text-[9px] font-bold text-center mb-1 w-full px-1 truncate text-amber-800 dark:text-amber-600/80">
                    {leaderboardNovels[2].title}
                  </div>
                  <div className={`w-full bg-gradient-to-t from-[#cd7f32] to-[#e49b55] dark:from-[#8c5622] dark:to-[#ae6829] rounded-t-xl h-14 flex justify-center pt-1 relative overflow-hidden shadow-inner`}>
                     <div className="absolute inset-0 bg-white/20 dark:bg-white/5" />
                     <span className="font-black text-[#5c3713] dark:text-[#f3cdab] text-lg drop-shadow-md">3</span>
                  </div>
                </a>
              </div>
            ) : (
                <div className="text-xs text-center text-slate-500 py-4 h-32 flex items-center justify-center">داده کافی برای نمایش سکو وجود ندارد</div>
            )}

            {/* Top Monthly Novel */}
            {leaderboardNovels[0] && (
               <div className="pt-6 border-t border-slate-200 dark:border-slate-800/50 mt-4 relative z-10">
                 <h4 className="text-xs font-black uppercase text-slate-400 dark:text-slate-500 mb-4 flex items-center gap-2">
                   <Flame className="w-3.5 h-3.5 text-rose-500" />
رمان برتر ماه
                  </h4>
                 <a
                   href={`/novels/${encodeURIComponent(leaderboardNovels[0].id)}`}
                   className="flex items-center gap-4 bg-white/50 dark:bg-slate-900/60 p-3 rounded-2xl border border-slate-200/50 dark:border-slate-800 cursor-pointer hover:-translate-y-1 transition-transform backdrop-blur shadow-sm"
                   onClick={(event) => handleClientLink(event, () => onSelectNovel(leaderboardNovels[0]))}
                 >
                   <SafeImage src={leaderboardNovels[0].coverUrl || leaderboardNovels[0].cover} alt={leaderboardNovels[0].title} className="w-14 h-20 rounded-xl object-cover shadow bg-slate-800" />
                   <div className="flex-1 min-w-0">
                     <h5 className="font-bold text-sm truncate text-slate-900 dark:text-slate-100">{leaderboardNovels[0].title}</h5>
                     <p className="text-[10px] text-slate-500 truncate mb-2">نوشته {leaderboardNovels[0].author}</p>
                     
                     <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-md">
                          <Star className="w-3 h-3 fill-amber-500" />
                          <span>{leaderboardNovels[0].rating || "نامشخص"}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-bold text-violet-500 bg-violet-500/10 px-2 py-0.5 rounded-md">
                          <Eye className="w-3 h-3" />
                          <span>{(leaderboardNovels[0].viewsCount || 0).toLocaleString()} بازدید</span>
                        </div>
                     </div>
                   </div>
                 </a>
               </div>
            )}

            <button 
              type="button"
              onClick={() => openViewAll(
                leaderboardMode === "rating" ? "رتبه‌بندی کامل امتیاز" : "رتبه‌بندی کامل بازدید",
                [...leaderboardSource].sort((a, b) => leaderboardMode === "rating"
                  ? (b.rating || 0) - (a.rating || 0) || (b.viewsCount || 0) - (a.viewsCount || 0)
                  : (b.viewsCount || 0) - (a.viewsCount || 0) || (b.rating || 0) - (a.rating || 0)
                )
              )}
              className="w-full py-3 rounded-xl border border-slate-700/10 dark:border-violet-950/40 text-xs font-bold text-slate-500 hover:text-violet-600 dark:hover:text-amber-400 transition-all cursor-pointer bg-slate-50/50 dark:bg-slate-900/30 hover:bg-slate-100 dark:hover:bg-slate-800 mt-4 relative z-10"
            >
              مشاهده رتبه‌بندی کامل
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function NovelCard({ novel, rank, theme, isBookmarked, onSelectNovel, onBookmarkNovel, onSelectAuthor, activeTheme, disableMotion = false }: any) {
  return (
    <motion.div
      initial={disableMotion ? false : { opacity: 0, scale: 0.94, y: 10 }}
      animate={disableMotion ? undefined : { opacity: 1, scale: 1, y: 0 }}
      exit={disableMotion ? undefined : { opacity: 0, scale: 0.94, y: -10 }}
      transition={disableMotion ? undefined : {
        default: { type: "spring", stiffness: 150, damping: 18 }
      }}
      className={`group/novel-card relative overflow-hidden rounded-2xl border ${activeTheme.border} ${activeTheme.card} flex flex-col justify-between hover:border-violet-500/40 transition-all duration-300 hover:scale-[1.01] ${activeTheme.shadow}`}
    >
      {/* Background Light blur on hover inside dark cards */}
      {theme === "dark" && (
        <div className="absolute -right-12 -bottom-12 w-32 h-32 rounded-full bg-violet-500/5 blur-[50px] pointer-events-none group-hover/novel-card:bg-violet-500/15 transition-all duration-500" />
      )}

      <div className="p-4 flex gap-4 items-start">
        {/* Interactive Cover Container */}
        <a
          href={`/novels/${encodeURIComponent(novel.id)}`}
          className="relative w-24 h-36 rounded-xl overflow-hidden shadow-md flex-shrink-0 bg-slate-900 border border-black/10 cursor-pointer"
          onClick={(event) => handleClientLink(event, () => onSelectNovel(novel))}
          aria-label={`مشاهده رمان ${novel.title}`}
        >
          <SafeImage
            src={novel.cover}
            alt={novel.title}
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            className="w-full h-full object-cover transition-transform duration-500 group-hover/novel-card:scale-105"
          />
          {Number.isFinite(rank) && (
            <div
              className={`absolute right-1.5 top-1.5 flex h-8 min-w-8 items-center justify-center rounded-full border px-2 text-sm font-black shadow-lg backdrop-blur-sm ${
                rank === 1
                  ? "border-amber-200 bg-amber-400 text-amber-950"
                  : rank === 2
                    ? "border-slate-100 bg-slate-300 text-slate-800"
                    : rank === 3
                      ? "border-orange-200 bg-orange-600 text-white"
                      : "border-violet-300/40 bg-slate-950/85 text-violet-100"
              }`}
              aria-label={`رتبه ${rank}`}
              title={`رتبه ${rank}`}
            >
              {rank}
            </div>
          )}
          {/* Rating Badging */}
          <div className="absolute bottom-1.5 left-1.5 bg-black/80 backdrop-blur-xs px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-amber-400 flex items-center gap-1">
            <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
            <span>{novel.rating}</span>
          </div>

          {novel.isUserCreated && (
            <div className="absolute top-1.5 left-1.5 bg-pink-600 px-1.5 py-0.5 rounded text-[9px] font-mono font-extrabold text-white">
              پیش‌نویس
            </div>
          )}

          {/* A comic opens in a page viewer, not a text column, so the format is
              flagged on the card before a reader commits to opening it. */}
          {isMangaWork(novel) && (
            <div className="absolute top-1.5 right-1.5 rounded bg-fuchsia-600 px-1.5 py-0.5 text-[9px] font-mono font-extrabold text-white">
              مانگا
            </div>
          )}
        </a>

        {/* Info Panel */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-mono font-bold text-violet-500 tracking-wider uppercase">
              {novel.genre}
            </span>
            
            {/* Bookmark button */}
            <button
              onClick={(e) => onBookmarkNovel(novel.id, e)}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                isBookmarked
                  ? "bg-violet-500 border-violet-600 text-white"
                  : "bg-transparent border-slate-700/30 text-slate-400 hover:text-violet-400 hover:border-violet-900"
              }`}
              title={isBookmarked ? "حذف نشانک" : "افزودن به کتابخانه"}
            >
              <Bookmark className={`w-3.5 h-3.5 ${isBookmarked ? "fill-white" : ""}`} />
            </button>
          </div>

          <h3 className="font-extrabold text-base leading-tight group-hover/novel-card:text-violet-400 transition-colors line-clamp-1 text-left">
            <a href={`/novels/${encodeURIComponent(novel.id)}`} onClick={(event) => handleClientLink(event, () => onSelectNovel(novel))}>{novel.title}</a>
          </h3>

          <p className="text-xs text-slate-500 font-medium text-left">
            نوشته{" "}
            <a
              href={`/authors/${encodeURIComponent(novel.authorUsername || novel.author)}`}
              onClick={(event) => handleClientLink(event, () => onSelectAuthor?.(novel.authorUsername || novel.author))}
              className="font-bold text-violet-400 hover:underline cursor-pointer"
            >
              {novel.author}
            </a>
          </p>

          <p className="text-xs text-slate-400 dark:text-slate-400/80 line-clamp-3 leading-relaxed text-left">
            {novel.description}
          </p>
        </div>
      </div>

      {/* Bottom Stats Tray */}
      <div className="px-4 py-3 border-t border-slate-700/10 dark:border-violet-950/30 flex items-center justify-between text-xs font-mono bg-violet-500/2">
        <div className="flex items-center gap-3 text-slate-500">
          <span className="flex items-center gap-1">
            <LayoutGrid className="w-3.5 h-3.5 text-violet-500/70" />
            <span>{novel.chapters?.length || 0} فصل</span>
          </span>
          <span className="flex items-center gap-1">
            <Eye className="w-3.5 h-3.5 text-violet-500/70" />
                          <span>{(novel.viewsCount || 0).toLocaleString()}</span>
                          <span className="opacity-60">· میانگین {Number(novel.averageViews || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}/فصل</span>
          </span>
        </div>

        <a
          href={`/novels/${encodeURIComponent(novel.id)}`}
          onClick={(event) => handleClientLink(event, () => onSelectNovel(novel))}
          className="text-xs font-bold text-violet-400 hover:text-violet-300 transition-colors flex items-center gap-1 cursor-pointer"
        >
          <span>مشاهده کتاب</span>
          <span className="text-[10px]">→</span>
        </a>
      </div>
    </motion.div>
  );
}
