import React, { useState } from "react";
import { Novel, Chapter, Review } from "../types";
import { CONTRAST_THEMES, CONTENT_WARNINGS, filterTaxonomyList } from "../data";
import { BarChart3, BookOpen, Star, Undo2, Calendar, FileText, ChevronRight, MessageSquare, Plus, Check, Bookmark, Clock, Eye, Heart, AlertTriangle, Pencil, Share2, Sparkles, Users } from "lucide-react";
import { motion } from "motion/react";
import ReportButton from "./ReportButton";
import { copyLink } from "../utils/share";
import SafeImage from "./SafeImage";
import { formatAverageViews } from "../../shared/statistics";
import { premiumTemplateById } from "../../shared/premiumTemplates";
import AuthorLinksDisplay from "./AuthorLinksDisplay";
import { api } from "../utils/api";
import { isMangaWork } from "../../shared/manga";

interface NovelDetailsProps {
  novel: Novel;
  onBack: () => void;
  onReadChapter: (chapter: Chapter) => void;
  onBookmark: (novelId: string) => void;
  isBookmarked: boolean;
  onAddReview: (novelId: string, review: Review) => void;
  onRateNovel?: (novelId: string, rating: number, comment: string) => void;
  theme: "light" | "dark";
  readingProgress: number | null; // Chapter number currently at
  onSelectAuthor?: (authorName: string) => void;
  currentUser: any;
  onRequireLogin: () => void;
  onEditNovel?: (novelId: string) => void;
  onOpenWorldbuilding?: (novelId: string) => void;
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

export default function NovelDetails({
  novel,
  onBack,
  onReadChapter,
  onBookmark,
  isBookmarked,
  onAddReview,
  onRateNovel,
  theme,
  readingProgress,
  onSelectAuthor,
  currentUser,
  onRequireLogin,
  onEditNovel,
  onOpenWorldbuilding,
}: NovelDetailsProps) {
  const activeTheme = CONTRAST_THEMES[theme];
  const [newReviewText, setNewReviewText] = useState("");
  const [newReviewRating, setNewReviewRating] = useState(5);
  const [ratingStyle, setRatingStyle] = useState(5);
  const [ratingStory, setRatingStory] = useState(5);
  const [ratingGrammar, setRatingGrammar] = useState(5);
  const [ratingCharacter, setRatingCharacter] = useState(5);
  const [newReviewUser, setNewReviewUser] = useState("");
  const [showAddReview, setShowAddReview] = useState(false);
  const [commentError, setCommentError] = useState("");

  React.useEffect(() => {
    const reviewId = new URLSearchParams(window.location.search).get("review");
    const targetId = reviewId ? `review-${reviewId}` : "";
    if (!targetId) return;
    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [novel.id]);
  const existingUserReview = React.useMemo(() => (novel.reviews || []).find((review) =>
    currentUser?.id && review.userId === currentUser.id
  ), [novel.reviews, currentUser?.id]);
  const [userRating, setUserRating] = useState<number>(() => Number(existingUserReview?.ratingOverall || existingUserReview?.rating || 0));
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [isChangingRating, setIsChangingRating] = useState(false);
  const [ratingNote, setRatingNote] = useState(existingUserReview?.comment || "");
  const [showRatingEditor, setShowRatingEditor] = useState(false);
  const [ratingError, setRatingError] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [characterVotes, setCharacterVotes] = useState<Record<string, number>>({});
  const [votedCharacterIds, setVotedCharacterIds] = useState<string[]>([]);
  const [characterVotesRemaining, setCharacterVotesRemaining] = useState(3);
  const [votingCharacterId, setVotingCharacterId] = useState<string | null>(null);
  const [characterVoteError, setCharacterVoteError] = useState("");
  const isNovelOwner = Boolean(currentUser?.id && String(novel.author_id || "") === String(currentUser.id));

  React.useEffect(() => {
    let cancelled = false;
    setCharacterVoteError("");
    api.getCharacterVotes(novel.id)
      .then((summary) => {
        if (cancelled) return;
        setCharacterVotes(summary.votes || {});
        setVotedCharacterIds(summary.votedCharacterIds || []);
        setCharacterVotesRemaining(summary.votesRemainingToday ?? 3);
      })
      .catch(() => {
        if (!cancelled) setCharacterVoteError("رأی‌دهی به شخصیت‌ها موقتاً در دسترس نیست.");
      });
    return () => { cancelled = true; };
  }, [novel.id, currentUser?.id]);

  const voteForCharacter = async (characterId: string) => {
    if (!currentUser) {
      onRequireLogin();
      return;
    }
    if (votedCharacterIds.includes(characterId) || characterVotesRemaining <= 0 || votingCharacterId) return;
    setVotingCharacterId(characterId);
    setCharacterVoteError("");
    try {
      const summary = await api.voteForCharacter(novel.id, characterId);
      setCharacterVotes(summary.votes || {});
      setVotedCharacterIds(summary.votedCharacterIds || []);
      setCharacterVotesRemaining(summary.votesRemainingToday ?? 0);
    } catch (error) {
      setCharacterVoteError(error instanceof Error ? error.message : "ثبت رأی شما برای این شخصیت انجام نشد.");
    } finally {
      setVotingCharacterId(null);
    }
  };

  const shareNovel = async () => {
    const url = `${window.location.origin}/novels/${encodeURIComponent(novel.id)}`;
    try {
      await copyLink(url);
      setShareStatus("لینک کپی شد");
      window.setTimeout(() => setShareStatus(""), 2500);
    } catch (error: any) {
      if (error?.name !== "AbortError") setShareStatus("کپی لینک انجام نشد");
    }
  };

  React.useEffect(() => {
    setUserRating(Number(existingUserReview?.ratingOverall || existingUserReview?.rating || 0));
    setRatingNote(existingUserReview?.comment || "");
    setIsChangingRating(false);
    setShowRatingEditor(false);
  }, [existingUserReview?.id, existingUserReview?.ratingOverall, existingUserReview?.rating, existingUserReview?.comment]);

  const handleUserRate = (r: number) => {
    if (!currentUser) {
      onRequireLogin();
      return;
    }
    if (userRating > 0 && !isChangingRating) return;
    setUserRating(r);
    setIsChangingRating(true);
    setShowRatingEditor(true);
    setRatingError("");
  };

  const saveUserRating = () => {
    const note = ratingNote.trim();
    if (!userRating) {
      setRatingError("ابتدا امتیاز ستاره‌ای را انتخاب کنید.");
      return;
    }
    if (note.length > 0 && note.length < 3) {
      setRatingError("لطفاً حداقل 3 نویسه بنویسید یا یادداشت را خالی بگذارید.");
      return;
    }
    onRateNovel?.(novel.id, userRating, note);
    setIsChangingRating(false);
    setShowRatingEditor(false);
    setRatingError("");
  };

  const openReviewForm = () => {
    if (!currentUser) {
      onRequireLogin();
      return;
    }
    if (existingUserReview) {
      setNewReviewText(existingUserReview.comment || "");
      setNewReviewRating(Number(existingUserReview.ratingOverall || existingUserReview.rating || 5));
      setRatingStyle(Number(existingUserReview.ratingStyle || existingUserReview.rating || 5));
      setRatingStory(Number(existingUserReview.ratingStory || existingUserReview.rating || 5));
      setRatingGrammar(Number(existingUserReview.ratingGrammar || existingUserReview.rating || 5));
      setRatingCharacter(Number(existingUserReview.ratingCharacter || existingUserReview.rating || 5));
    }
    setShowAddReview(true);
  };

  const handlePublishReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onRequireLogin();
      return;
    }
    if (!newReviewText.trim() || newReviewText.length < 10) {
      setCommentError("طول نقد و بررسی باید حداقل 10 نویسه باشد.");
      return;
    }

    const review: Review = {
      id: "rev-" + Date.now(),
      userId: currentUser.id,
      username: currentUser.username,
      displayName: currentUser.nickname || currentUser.username,
      avatar: currentUser.avatar || "",
      role: currentUser.role || "reader",
      rating: newReviewRating,
      ratingOverall: newReviewRating,
      ratingStyle,
      ratingStory,
      ratingGrammar,
      ratingCharacter,
      comment: newReviewText,
      createdAt: new Date().toISOString().split("T")[0],
    };

    onAddReview(novel.id, review);
    setNewReviewText("");
    setNewReviewRating(5);
    setRatingStyle(5);
    setRatingStory(5);
    setRatingGrammar(5);
    setRatingCharacter(5);
    setShowAddReview(false);
    setCommentError("");
  };

  // Manga works are read page by page, so chapter rows show pages, not words.
  const isManga = isMangaWork(novel);

  const sortedChapters = React.useMemo(
    () => [...(novel.chapters || [])].filter((chapter) => !chapter.isAuxiliary).sort((a, b) => Number(a.chapterNumber || 0) - Number(b.chapterNumber || 0)),
    [novel.chapters]
  );
  const auxiliaryChapters = React.useMemo(
    () => [...(novel.chapters || [])].filter((chapter) => chapter.isAuxiliary).sort((a, b) => Number(a.chapterNumber || 0) - Number(b.chapterNumber || 0)),
    [novel.chapters]
  );
  const firstChapter = sortedChapters[0] || null;
  const resumeChapter = readingProgress
    ? sortedChapters.find((chapter) => Number(chapter.chapterNumber) === Number(readingProgress)) || null
    : null;
  const primaryReadChapter = resumeChapter || firstChapter;
  const premiumTemplate = premiumTemplateById(novel.premiumPresentation?.templateId);
  const premiumPalette = novel.premiumPresentation?.palette || premiumTemplate.colors;
  const premiumActive = novel.premiumPresentationActive === true;

  return (
    <div
      className={`space-y-8 pb-16 ${premiumActive ? `premium-novel premium-animation-${premiumTemplate.animation}` : ""}`}
      style={premiumActive ? {
        "--premium-primary": premiumPalette.primary,
        "--premium-secondary": premiumPalette.secondary,
        "--premium-accent": premiumPalette.accent,
        "--premium-background": premiumTemplate.background,
      } as React.CSSProperties : undefined}
    >
      {/* Back button */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl border ${activeTheme.border} ${activeTheme.card} hover:text-violet-500 cursor-pointer transition-colors ${activeTheme.shadow}`}
        >
          <Undo2 className="w-4 h-4" />
          <span>بازگشت به کتابخانه</span>
        </button>

        <div className="text-xs text-slate-500 font-mono">
          کد رمان: #{novel.id.slice(0, 8).toUpperCase()}
        </div>
      </div>


      {/* Main Novel Overview Banner */}
      <section 
        id="novel-overview-banner"
        className={`relative overflow-hidden rounded-3xl border ${activeTheme.border} ${activeTheme.card} p-6 md:p-8 ${activeTheme.shadow} ${premiumActive ? "premium-novel-hero" : ""}`}
      >
        {premiumActive && <div aria-hidden="true" className="premium-decoration" />}
        {/* Glow for dark theme */}
        {theme === "dark" && (
          <div className="absolute -right-20 -top-20 w-80 h-80 rounded-full bg-violet-500/5 blur-[100px] pointer-events-none" />
        )}

        <div className="relative z-10 flex flex-col md:flex-row gap-8 items-start">
          {/* Cover Art Image */}
          <div className="w-48 max-w-full aspect-[2/3] rounded-2xl overflow-hidden shadow-lg border border-slate-700/15 flex-shrink-0 bg-slate-900 mx-auto md:mx-0">
            <SafeImage
              src={novel.cover}
              alt={novel.title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>

          {/* Details Section */}
          <div className="flex-grow space-y-4 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              {premiumActive && <span className="premium-novel-badge"><Sparkles className="h-3.5 w-3.5" />پریمیوم · {premiumTemplate.name}</span>}
              {isNovelOwner && onEditNovel && (
                <button
                  type="button"
                  onClick={() => onEditNovel(novel.id)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-violet-500/10 text-violet-400 border border-violet-500/25 hover:bg-violet-500 hover:text-white transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  ویرایش رمان
                </button>
              )}
              {onOpenWorldbuilding && (
                <button type="button" onClick={() => onOpenWorldbuilding(novel.id)} className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-violet-500/10 text-violet-400 border border-violet-500/25 hover:bg-violet-500 hover:text-white transition-colors">
                  <Users className="w-3.5 h-3.5" /> جهان‌سازی
                </button>
              )}
              <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-violet-500/10 text-violet-400 border border-violet-500/20">
                {novel.genre}
              </span>
              
              {filterTaxonomyList(novel.warnings || []).map(w => {
                 const warningMeta = CONTENT_WARNINGS.find(cw => cw.id === w);
                 return (
                   <span key={w} className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-red-500/10 text-red-500 border border-red-500/20 flex items-center gap-1">
                     <AlertTriangle className="w-3.5 h-3.5" />
                     {warningMeta ? warningMeta.label : w}
                   </span>
                 );
              })}
              <span className="flex items-center gap-1 text-xs text-amber-500 font-bold bg-amber-500/5 px-2.5 py-1 rounded-full border border-amber-500/10">
                <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                <span>امتیاز {novel.rating}</span>
              </span>
              {novel.isAIGenerated && (
                 <span className="px-2 py-0.5 rounded text-[10px] font-mono font-black border bg-rose-500/10 border-rose-500/30 text-rose-500 uppercase">
                    محتوای تولیدشده با هوش مصنوعی
                 </span>
              )}
              {novel.isAIAssisted && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-black border bg-purple-500/10 border-purple-500/30 text-purple-400 uppercase">
                    با کمک هوش مصنوعی
                  </span>
              )}
              {novel.originType === "translated" && (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-black border bg-sky-500/10 border-sky-500/30 text-sky-400 uppercase">
                  ترجمه‌شده
                </span>
              )}
              {/* Readers need to know a work is a comic before opening it: the
                  reading experience is a page viewer, not a text column. */}
              {isManga && (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-black border bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-400 uppercase">
                  مانگا / کمیک
                </span>
              )}
            </div>

            <div className="space-y-1">
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight">
                {novel.title}
              </h1>
              <p className="text-sm text-slate-500 font-medium">
                نوشتهٔ <span onClick={() => onSelectAuthor?.(novel.authorUsername || novel.author)} className="font-bold text-violet-400 hover:underline cursor-pointer">{novel.author}</span>
              </p>
              {novel.originType === "translated" && novel.originalAuthor && (
                <p className="text-xs text-slate-500 font-medium">
                  اثر اصلی از <span className="font-bold text-slate-400 dark:text-slate-300">{novel.originalAuthor}</span>
                  {Array.isArray(novel.translators) && novel.translators.length > 0 && (
                    <> · ترجمهٔ <span className="font-bold text-sky-400">{novel.translators.join("، ")}</span></>
                  )}
                </p>
              )}
            </div>

            {/* Read / Bookmark Interactions */}
            <div className="flex flex-wrap gap-4 pt-2">
              {primaryReadChapter ? (
                <button
                  onClick={() => onReadChapter(primaryReadChapter)}
                  className="px-6 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-500 hover:to-purple-500 transition-all duration-300 shadow-md shadow-violet-500/10 flex items-center gap-2 cursor-pointer"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>
                    {readingProgress ? `ادامه مطالعه (فصل ${readingProgress})` : "شروع مطالعه فصل 1"}
                  </span>
                </button>
              ) : (
                <div className="text-stone-500 text-sm font-medium py-3 px-6 rounded-xl border border-dashed border-stone-300 dark:border-violet-950/40 bg-stone-50 dark:bg-[#0b0716]">
                  هنوز فصلی منتشر نشده است. منتظر باشید!
                </div>
              )}

              <button
                onClick={() => {
                  if (!currentUser) {
                    onRequireLogin();
                    return;
                  }
                  onBookmark(novel.id);
                }}
                className={`px-5 py-3 rounded-xl font-bold text-sm border transition-all duration-300 flex items-center gap-2 cursor-pointer ${
                  isBookmarked
                    ? "bg-violet-500 border-violet-600 text-white"
                    : theme === "dark"
                    ? "bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-200"
                    : "bg-white border-stone-200 text-stone-800 hover:bg-stone-50"
                }`}
              >
                {isBookmarked ? (
                  <>
                    <Check className="w-4 h-4 text-white" />
                    <span>در کتابخانه شماست</span>
                  </>
                ) : (
                  <>
                    <Bookmark className="w-4 h-4" />
                    <span>افزودن به کتابخانه</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={shareNovel}
                className="px-5 py-3 rounded-xl font-bold text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-violet-500 text-slate-700 dark:text-slate-200 transition-all flex items-center gap-2 cursor-pointer"
                aria-label={`کپی لینک ${novel.title}`}
              >
                <Share2 className="w-4 h-4" />
                <span>{shareStatus || "کپی لینک رمان"}</span>
              </button>
              {currentUser && currentUser.id !== novel.author_id && (
                <ReportButton targetType="novel" targetId={novel.id} className="px-4 py-3 rounded-xl border border-rose-500/25 text-rose-400 hover:bg-rose-500/10 text-xs font-bold" />
              )}
            </div>

            {/* Interactive Webnovel Rating Stars */}
            <div className={`p-4 rounded-2xl border ${theme === 'dark' ? 'bg-[#11152a] border-slate-600/70' : 'bg-stone-50 border-stone-200'} space-y-3`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-0.5 text-left">
                <span className="block text-xs font-mono font-bold text-slate-400 dark:text-violet-300 uppercase tracking-wide">به این وب‌رمان امتیاز بدهید</span>
                <span className="text-[11px] text-slate-500 block leading-normal">امتیاز خود را ثبت کنید تا میانگین امتیاز کلی این اثر محاسبه شود (1 تا 5 ستاره)</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 bg-black/5 dark:bg-slate-950/70 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 shrink-0">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => handleUserRate(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    disabled={userRating > 0 && !isChangingRating}
                    className="p-1 cursor-pointer transition-transform hover:scale-125 focus:outline-none disabled:cursor-default disabled:hover:scale-100"
                  >
                    <Star
                      className={`w-5 h-5 transition-colors ${
                        star <= (hoverRating || userRating)
                          ? "fill-amber-400 text-amber-400"
                          : "text-slate-400 dark:text-slate-400"
                      }`}
                    />
                  </button>
                ))}
                {userRating > 0 && !showRatingEditor && (
                  <span className="text-xs font-mono font-extrabold text-emerald-500 dark:text-emerald-400 ml-1.5">
                    ثبت شد ({userRating}/5)
                  </span>
                )}
                {userRating > 0 && showRatingEditor && (
                  <span className="text-xs font-mono font-extrabold text-amber-600 dark:text-amber-300 ml-1.5">
                    انتخاب‌شده ({userRating}/5)
                  </span>
                )}
                {userRating > 0 && !isChangingRating && !showRatingEditor && (
                  <button type="button" onClick={() => { setIsChangingRating(true); setShowRatingEditor(true); }} className="ml-2 text-[10px] font-bold text-violet-400 hover:underline">
                    تغییر
                  </button>
                )}
              </div>
              </div>
              {showRatingEditor && (
                <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
                  <label htmlFor="rating-note" className="block text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-violet-200">
                    به خوانندگان بگویید چرا این امتیاز را داده‌اید (اختیاری)
                  </label>
                  <textarea
                    id="rating-note"
                    rows={3}
                    maxLength={5000}
                    value={ratingNote}
                    onChange={(event) => { setRatingNote(event.target.value); setRatingError(""); }}
                    placeholder="بگویید چه چیزی مورد پسندتان بود یا چه چیزی می‌توانست بهتر باشد..."
                    className="w-full resize-y rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                  {ratingError && <p className="text-xs font-medium text-rose-500">{ratingError}</p>}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] text-slate-500">{ratingNote.length}/5000 نویسه</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setShowRatingEditor(false); setIsChangingRating(false); setUserRating(Number(existingUserReview?.ratingOverall || existingUserReview?.rating || 0)); setRatingNote(existingUserReview?.comment || ""); }} className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">انصراف</button>
                      <button type="button" onClick={saveUserRating} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500">ذخیره امتیاز و یادداشت</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Synopsis Panel */}
            <div className="space-y-2 pt-2">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                خلاصه داستان و معرفی
              </h3>
              <p className={`text-sm leading-relaxed text-slate-400 dark:text-slate-300 font-sans ${theme === "light" ? "text-stone-800" : ""}`}>
                {novel.description}
              </p>
            </div>

            {/* Reader engagement */}
            <div className="grid grid-cols-2 gap-3 border-t border-slate-700/10 pt-4 dark:border-violet-950/20 sm:grid-cols-4">
              <div className="flex items-center gap-2 rounded-xl bg-rose-500/5 p-3 text-rose-500">
                <Heart className="h-4 w-4" />
                <div><span className="block text-base font-extrabold leading-none">{Number(novel.likesCount || 0).toLocaleString()}</span><span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">لایک‌ها</span></div>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-violet-500/5 p-3 text-violet-500">
                <Eye className="h-4 w-4" />
                <div><span className="block text-base font-extrabold leading-none">{Number(novel.viewsCount || 0).toLocaleString()}</span><span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">بازدیدها</span></div>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-violet-500/5 p-3 text-violet-500">
                <BarChart3 className="h-4 w-4" />
                <div><span className="block text-base font-extrabold leading-none">{formatAverageViews(novel.averageViews || 0)}</span><span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">میانگین بازدید هر فصل</span></div>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/5 p-3 text-emerald-500">
                <MessageSquare className="h-4 w-4" />
                <div><span className="block text-base font-extrabold leading-none">{Number(novel.reviewsCount ?? novel.reviews?.length ?? 0).toLocaleString()}</span><span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">دیدگاه‌ها</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <AuthorLinksDisplay
        username={novel.authorUsername || novel.author}
        authorName={novel.authorDisplayName || novel.author}
        placement="novel"
      />


      <section id="characters-section" className={`rounded-3xl border ${activeTheme.border} ${activeTheme.card} p-6 ${activeTheme.shadow}`}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div><h2 className="flex items-center gap-2 text-xl font-extrabold"><Users className="h-5 w-5 text-violet-400" />شخصیت‌ها</h2><p className="mt-1 text-xs text-slate-500">با شخصیت‌های {novel.title} آشنا شوید.</p></div>
          <div className="text-right"><span className="rounded-lg bg-violet-500/10 px-3 py-1 text-xs font-bold text-violet-400">{novel.characters?.length || 0}</span>{currentUser && <p className="mt-2 text-[10px] font-bold text-slate-500">امروز {characterVotesRemaining} رأی از 3 رأی باقی مانده است</p>}</div>
        </div>
        {characterVoteError && <p className="mb-4 rounded-xl bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-400" role="alert">{characterVoteError}</p>}
        {novel.characters?.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {novel.characters.map((character) => (
              <article key={character.id} className="overflow-hidden rounded-2xl border border-slate-700/20 bg-slate-500/5">
                <div className="aspect-square bg-violet-500/10 flex items-center justify-center overflow-hidden">
                  {character.imageUrl ? <SafeImage src={character.imageUrl} alt={character.name} loading="lazy" className="h-full w-full object-cover" /> : <Users className="h-14 w-14 text-violet-400/60" />}
                </div>
                <div className="space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-extrabold">{character.name}</h3><span className="rounded-md bg-amber-500/10 px-2 py-1 text-[9px] font-black uppercase text-amber-500">{character.role}</span></div><p className="text-xs leading-relaxed text-slate-500 dark:text-slate-300">{character.bio}</p><button type="button" onClick={() => void voteForCharacter(character.id)} disabled={votedCharacterIds.includes(character.id) || (!!currentUser && characterVotesRemaining <= 0) || votingCharacterId !== null} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/25 px-3 py-2 text-xs font-extrabold text-rose-400 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-55" aria-label={`رأی دادن به ${character.name}`}><Heart className={`h-4 w-4 ${votedCharacterIds.includes(character.id) ? "fill-current" : ""}`} />{votedCharacterIds.includes(character.id) ? "رأی داده شد" : votingCharacterId === character.id ? "در حال رأی‌گیری…" : "رأی"}<span className="rounded-md bg-rose-500/10 px-1.5 py-0.5">{Number(characterVotes[character.id] || 0).toLocaleString()}</span></button></div>
              </article>
            ))}
          </div>
        ) : <div className="rounded-2xl border border-dashed border-slate-700/30 py-10 text-center text-sm text-slate-500">نویسنده هنوز پروفایل شخصیت‌ها را اضافه نکرده است.</div>}
      </section>


      {/* Chapter Index Table & Reviews Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Chapters list */}
        <section id="chapters-list-section" className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-xl font-extrabold tracking-tight">فهرست فصل‌ها</h2>
              <p className="text-xs text-slate-500 font-medium font-sans">
                برای باز کردن صفحه مطالعه، یکی از فصل‌های زیر را انتخاب کنید.
              </p>
            </div>
            <span className="px-3 py-1 rounded-lg text-xs font-mono font-bold bg-slate-800/5 dark:bg-violet-950/20 text-slate-500 border border-slate-700/5 dark:border-violet-950/30">
              {sortedChapters.length} فصل{auxiliaryChapters.length ? ` • ${auxiliaryChapters.length} جانبی` : ""}
            </span>
          </div>

          <div className="space-y-3">
            {sortedChapters.length > 0 ? (
              sortedChapters
                .map((chapter) => (
                  <div
                    key={chapter.id}
                    onClick={() => onReadChapter(chapter)}
                    className={`p-4 rounded-xl border ${activeTheme.border} ${activeTheme.card} flex items-center justify-between group cursor-pointer hover:border-violet-500/40 transition-all ${activeTheme.shadow}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-violet-500/10 dark:bg-violet-500/5 border border-violet-500/15 flex items-center justify-center font-mono text-sm font-bold text-violet-400">
                        {chapter.chapterNumber}
                      </div>
                      <div>
                        <h4 className="font-bold text-sm tracking-tight text-slate-800 dark:text-violet-100 group-hover:text-violet-400 transition-colors">
                          {chapter.title}
                        </h4>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5" />
                            <span>{isManga ? `${Number(chapter.pageCount || 0).toLocaleString("fa-IR")} صفحه` : `${chapter.wordCount} واژه`}</span>
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            <span>
                              {isManga
                                ? `حدود ${Math.max(1, Math.ceil(Number(chapter.pageCount || 0) / 8)).toLocaleString("fa-IR")} دقیقه مطالعه`
                                : `حدود ${Math.max(1, Math.ceil(chapter.wordCount / 200))} دقیقه مطالعه`}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold ${chapter.likedByCurrentUser ? "bg-rose-500/10 text-rose-500" : "text-slate-500"}`}
                        title={`${Number(chapter.likesCount || 0).toLocaleString()} لایک فصل`}
                      >
                        <Heart className={`h-3.5 w-3.5 ${chapter.likedByCurrentUser ? "fill-current" : ""}`} />
                        <span>{Number(chapter.likesCount || 0).toLocaleString()}</span>
                      </span>
                      <span className="text-[10px] font-mono font-semibold text-slate-500">
                        {chapter.createdAt}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-600 transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                ))
            ) : (
              <div className="py-12 border-2 border-dashed border-slate-700/10 dark:border-violet-950/20 text-center rounded-2xl text-slate-400 font-medium">
                هیچ فصل منتشرشده‌ای وجود ندارد. برای انتشار از استودیو نوشتن استفاده کنید!
              </div>
            )}
          </div>

          {auxiliaryChapters.length > 0 && (
            <div className="space-y-3 pt-4">
              <div className="flex items-center justify-between border-t border-violet-500/15 pt-5">
                <div>
                  <h3 className="font-extrabold text-violet-400">اطلاعات جانبی</h3>
                  <p className="text-xs text-slate-500">دانش دنیای داستان، راهنماها، یادداشت‌ها و مطالب تکمیلی اختیاری از نویسنده.</p>
                </div>
                <span className="rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-xs font-bold text-violet-400">{auxiliaryChapters.length}</span>
              </div>
              {auxiliaryChapters.map((chapter) => (
                <button
                  type="button"
                  key={chapter.id}
                  onClick={() => onReadChapter(chapter)}
                  className={`w-full p-4 rounded-xl border border-violet-500/20 ${activeTheme.card} flex items-center justify-between group cursor-pointer hover:border-violet-500/50 transition-all ${activeTheme.shadow} text-left`}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-10 h-10 shrink-0 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center font-mono text-xs font-black text-violet-400">ک{chapter.chapterNumber}</div>
                    <div className="min-w-0">
                      <h4 className="truncate font-bold text-sm tracking-tight text-slate-800 dark:text-violet-100 group-hover:text-violet-400 transition-colors">{chapter.title}</h4>
                      <span className="text-xs text-slate-500">
                        {isManga
                          ? `${Number(chapter.pageCount || 0).toLocaleString("fa-IR")} صفحه`
                          : `${Number(chapter.wordCount || 0).toLocaleString()} واژه`} • مطالعه اختیاری
                      </span>
                    </div>
                  </div>
                  <span className="ml-3 rounded-md bg-violet-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-violet-400">جانبی</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Reviews panel */}
        <section id="reviews-section" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-purple-400" />
              <span>نقد و بررسی</span>
            </h2>

            <button
              onClick={() => showAddReview ? setShowAddReview(false) : openReviewForm()}
              className="text-xs font-bold text-violet-400 bg-violet-500/10 border border-violet-500/15 px-3 py-1.5 rounded-lg flex items-center gap-1 hover:bg-violet-500 hover:text-white transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{existingUserReview ? "ویرایش نقد" : "نوشتن نقد"}</span>
            </button>
          </div>

          {/* Form to write a review */}
          {showAddReview && (
            <form 
              onSubmit={handlePublishReview}
              className={`p-4 rounded-xl border border-violet-500/30 bg-violet-500/2 space-y-4`}
            >
              <h3 className="font-bold text-xs font-mono uppercase tracking-wider text-slate-600 dark:text-violet-300">
                ثبت نقد برای این اثر
              </h3>

              {commentError && (
                <div className="p-2.5 rounded-lg text-xs bg-rose-500/10 border border-rose-500/30 text-rose-400 font-medium">
                  {commentError}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                    نام مستعار شما
                  </label>
                  <input
                    type="text"
                    value={newReviewUser}
                    onChange={(e) => setNewReviewUser(e.target.value)}
                    placeholder="مثلاً شکارچی_رمان"
                    className={`w-full p-2 text-xs rounded-lg border-1 focus:outline-none transition-all ${
                      theme === "dark"
                        ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500"
                        : "bg-white border-stone-200 text-stone-900 focus:border-amber-500"
                    }`}
                  />
                </div>

                {[
                  ["کلی", newReviewRating, setNewReviewRating],
                  ["سبک", ratingStyle, setRatingStyle],
                  ["داستان", ratingStory, setRatingStory],
                  ["نگارش", ratingGrammar, setRatingGrammar],
                  ["شخصیت‌ها", ratingCharacter, setRatingCharacter],
                ].map(([label, value, setter]: any) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono">
                      {label}
                    </label>
                    <div className="flex gap-1.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          type="button"
                          key={star}
                          onClick={() => setter(star)}
                          className="p-1 cursor-pointer transition-transform hover:scale-110"
                        >
                          <Star
                            className={`w-4 h-4 ${
                              star <= value
                                ? "fill-amber-400 text-amber-400"
                                : "text-slate-600"
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                <div>
                  <label className="block text-[10px] font-bold text-stone-500 uppercase font-mono mb-1">
                    دیدگاه / بازخورد
                  </label>
                  <textarea
                    rows={3}
                    value={newReviewText}
                    onChange={(e) => setNewReviewText(e.target.value)}
                    placeholder="نقد خود درباره پیرنگ، شخصیت‌ها، نگارش و ریتم داستان را بنویسید..."
                    className={`w-full p-2 text-xs rounded-lg border-1 focus:outline-none transition-all resize-none ${
                      theme === "dark"
                        ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500"
                        : "bg-white border-stone-200 text-stone-900 focus:border-amber-500"
                    }`}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddReview(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-700/10 cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 bg-violet-600 hover:bg-violet-500 text-white shadow font-semibold text-xs rounded-lg cursor-pointer transition-all"
                >
                  {existingUserReview ? "ذخیره تغییرات" : "انتشار نقد"}
                </button>
              </div>
            </form>
          )}

          {/* List of reviews */}
          <div className="space-y-3">
            {novel.reviews && novel.reviews.length > 0 ? (
              novel.reviews.map((review) => (
                <div
                  key={review.id}
                  id={`review-${review.id}`}
                  className={`p-4 rounded-xl border ${activeTheme.border} ${activeTheme.card} space-y-2 last:border-none ${activeTheme.shadow}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => review.username && onSelectAuthor?.(review.username)}
                      disabled={!review.username || !onSelectAuthor}
                      className="min-w-0 flex items-center gap-2 text-left disabled:cursor-default enabled:cursor-pointer group"
                    >
                      <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 via-purple-600 to-emerald-500 text-white flex items-center justify-center text-[11px] font-black shrink-0 overflow-hidden">
                        {getSafeAvatarUrl(review.avatar) ? (
                          <SafeImage
                            src={getSafeAvatarUrl(review.avatar) || ""}
                            alt={review.displayName || review.username || "خواننده"}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          String(review.displayName || review.username || "خواننده").slice(0, 2).toUpperCase()
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-extrabold text-xs dark:text-violet-100 truncate group-hover:text-violet-500">
                          {review.displayName || review.username || "خواننده"}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono block truncate">
                          @{review.username || "reader"} - نقد در تاریخ {review.createdAt}
                        </span>
                      </span>
                    </button>
                    
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, idx) => (
                        <Star
                          key={idx}
                          className={`w-3 h-3 ${
                            idx < review.rating
                              ? "fill-amber-400 text-amber-400"
                              : "text-slate-600"
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {review.comment?.trim() ? (
                    <p className="whitespace-pre-wrap break-words text-xs text-slate-600 leading-relaxed font-sans dark:text-slate-300">
                      {review.comment}
                    </p>
                  ) : (
                    <p className="text-[11px] italic text-slate-500">این خواننده فقط امتیازی ثبت کرده و متنی ننوشته است.</p>
                  )}
                  <div className="grid grid-cols-2 gap-1 text-[9px] font-mono text-slate-500">
                    <span>سبک: {review.ratingStyle || review.rating}/5</span>
                    <span>داستان: {review.ratingStory || review.rating}/5</span>
                    <span>نگارش: {review.ratingGrammar || review.rating}/5</span>
                    <span>شخصیت‌ها: {review.ratingCharacter || review.rating}/5</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-6 border border-dashed border-slate-700/10 dark:border-violet-950/20 text-center rounded-xl text-slate-500 text-xs">
                هنوز نقدی برای این رمان ثبت نشده است. شما اولین نفر باشید!
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
