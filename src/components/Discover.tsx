import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Heart, MessageCircle, Share2, Bookmark, MoreHorizontal, X, Send, Link, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { Novel, Review } from '../types';
import { api } from '../utils/api';
import { CONTENT_WARNINGS, filterTaxonomyList } from '../data';
import { shareOrCopyLink } from '../utils/share';
import SafeImage from './SafeImage';
import { isMangaWork } from '../../shared/manga';

function normalizeBookmarkCategories(categories: any[]) {
  return (Array.isArray(categories) ? categories : []).map((category: any, index: number) => ({
    id: category?.id || `cat-${index + 1}`,
    name: category?.name || `دسته ${index + 1}`,
    items: Array.isArray(category?.items) ? category.items : Array.isArray(category?.ids) ? category.ids : []
  }));
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

function avatarInitials(name: unknown) {
  return String(name || "کاربر").trim().slice(0, 2).toUpperCase();
}

interface DiscoverFeedProps {
  theme: string;
  activeTheme: any;
  novels: Novel[];
  bookmarkedIds?: string[];
  onToggleBookmark?: (novelId: string, bookmark: boolean) => void;
  onLikeChange?: (novelId: string, likesCount: number) => void;
  currentUser?: any;
  onNavigateToAuthor?: (authorName: string) => void;
  onNavigateToNovel?: (novelId: string) => void;
}

export default function DiscoverFeed({
  theme,
  novels,
  bookmarkedIds = [],
  onToggleBookmark,
  onLikeChange,
  currentUser,
  onNavigateToAuthor,
  onNavigateToNovel
}: DiscoverFeedProps) {
  // Sort novels randomly or sequentially. For now just show novels as is.
  const [feedNovels, setFeedNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const novelIdsSignature = novels.map((novel) => novel.id).join("|");

  const mergeWithLoadedNovels = (recommendations: Novel[]) => recommendations.map((recommendation) => {
    const loadedNovel = novels.find((novel) => novel.id === recommendation.id);
    if (!loadedNovel) return recommendation;
    return {
      ...loadedNovel,
      ...recommendation,
      chapters: (loadedNovel.chapters?.length || 0) >= (recommendation.chapters?.length || 0)
        ? loadedNovel.chapters
        : recommendation.chapters
    };
  });

  useEffect(() => {
    let active = true;
    const fetchRecommendations = async () => {
      setLoading(true);
      try {
        if (currentUser?.id) {
          const device = window.innerWidth < 768 ? 'mobile' : 'desktop';
          const recs = await api.getRecommendedNovels(currentUser.id, device);
          if (active && recs && recs.length > 0) {
            setFeedNovels(mergeWithLoadedNovels(recs));
          } else if (active) {
            setFeedNovels(novels);
          }
        } else {
          if (active) setFeedNovels(novels);
        }
      } catch (err) {
        if (active) setFeedNovels(novels);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchRecommendations();
    return () => { active = false; };
  }, [novelIdsSignature, currentUser?.id]);

  useEffect(() => {
    setActiveIndex(0);
    feedRef.current?.scrollTo({ top: 0 });
  }, [novelIdsSignature]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const handleFeedScroll = () => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const feed = feedRef.current;
      if (!feed || feed.clientHeight === 0) return;
      const nextIndex = Math.max(0, Math.min(feedNovels.length - 1, Math.round(feed.scrollTop / feed.clientHeight)));
      setActiveIndex((current) => current === nextIndex ? current : nextIndex);
    });
  };

  const textPrimary = theme === 'dark' ? 'text-stone-100' : 'text-stone-900';
  const textSecondary = theme === 'dark' ? 'text-stone-400' : 'text-stone-500';
  const bgCol = theme === 'dark' ? 'bg-[#060409]' : 'bg-stone-50';

  if (loading) {
    return (
      <div className={`w-full h-screen flex flex-col items-center justify-center ${textPrimary}`}>
        <p className={textSecondary}>در حال بارگذاری فید شخصی‌سازی‌شده...</p>
      </div>
    );
  }

  if (feedNovels.length === 0) {
    return (
      <div className={`w-full h-screen flex flex-col items-center justify-center ${textPrimary}`}>
        <p className={textSecondary}>هنوز داستانی موجود نیست.</p>
      </div>
    );
  }

  return (
    <div
      ref={feedRef}
      onScroll={handleFeedScroll}
      className={`discover-feed feed-scroller w-full overflow-y-auto scrollbar-none ${bgCol}`}
    >
      {feedNovels.map((novel, index) => (
        Math.abs(index - activeIndex) <= 2 ? (
          <FeedPost
            key={novel.id}
            novel={novel}
            theme={theme}
            isActive={index === activeIndex}
            isBookmarked={bookmarkedIds.includes(novel.id)}
            onToggleBookmark={(state) => onToggleBookmark?.(novel.id, state)}
            onLikeChange={(likesCount) => onLikeChange?.(novel.id, likesCount)}
            currentUser={currentUser}
            onNavigateToAuthor={onNavigateToAuthor}
            onNavigateToNovel={onNavigateToNovel}
          />
        ) : (
          <div key={novel.id} className="feed-post-shell" aria-hidden="true" />
        )
      ))}
    </div>
  );
}

function FeedPost({
  novel,
  theme,
  isActive,
  isBookmarked,
  onToggleBookmark,
  onLikeChange,
  currentUser,
  onNavigateToAuthor,
  onNavigateToNovel
}: {
  key?: React.Key;
  novel: Novel;
  theme: string;
  isActive: boolean;
  isBookmarked: boolean;
  onToggleBookmark: (state: boolean) => void;
  onLikeChange?: (likesCount: number) => void;
  currentUser: any;
  onNavigateToAuthor?: (name: string) => void;
  onNavigateToNovel?: (id: string) => void;
}) {
  const [liked, setLiked] = useState<boolean>(false);
  const [likesCount, setLikesCount] = useState<number>(Number(novel.likesCount || 0));
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [comments, setComments] = useState<Review[]>(novel.reviews || []);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [likeBusy, setLikeBusy] = useState(false);
  const [likeBurst, setLikeBurst] = useState(false);
  const impressionTrackedRef = useRef(false);
  const commentsDragControls = useDragControls();
  const authorAvatarUrl = getSafeAvatarUrl(novel.authorAvatar);
  const authorDisplayName = novel.authorDisplayName || novel.author;

  useEffect(() => {
    setComments(novel.reviews || []);
  }, [novel.id, novel.reviews]);

  useEffect(() => {
    impressionTrackedRef.current = false;
  }, [novel.id]);

  // Only the story that is actually on screen should produce an impression.
  useEffect(() => {
    if (!isActive || !currentUser || impressionTrackedRef.current) return;
    impressionTrackedRef.current = true;
    api.trackEvent(currentUser.id, novel.id, 'impression');
  }, [isActive, currentUser?.id, novel.id]);

  useEffect(() => {
    if (showSaveDialog && currentUser) {
      const token = api.getToken();
      if (token) {
        api.getBookmarkCategories(token).then(cats => {
          const normalized = normalizeBookmarkCategories(cats);
          if (normalized.length > 0) {
            setCategories(normalized);
          } else {
            setCategories([
              { id: "cat-read-later", name: "بعداً بخوان", items: [] },
              { id: "cat-favorites", name: "علاقه‌مندی‌ها", items: [] }
            ]);
          }
        });
      }
    }
  }, [showSaveDialog, currentUser]);

  useEffect(() => {
    if (!isActive) return;
    let active = true;
    const token = api.getToken();
    if (!currentUser && Number.isFinite(Number(novel.likesCount))) return;
    api.getNovelLike(token, novel.id).then((state) => {
      if (active && state) {
        setLiked(!!state.liked);
        setLikesCount(state.likesCount || 0);
        onLikeChange?.(state.likesCount || 0);
      }
    });
    return () => { active = false; };
  }, [isActive, novel.id, currentUser?.id]);

  useEffect(() => {
    if (!showComments) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowComments(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showComments]);

  const textPrimary = theme === 'dark' ? 'text-stone-100' : 'text-stone-900';
  const textSecondary = theme === 'dark' ? 'text-stone-400' : 'text-stone-500';
  const cardBg = theme === 'dark' ? 'bg-[#0e0a1c]' : 'bg-white';
  const borderCol = theme === 'dark' ? 'border-violet-950/40' : 'border-stone-200';

  const handleShare = async () => {
    if (currentUser) {
      api.trackEvent(currentUser.id, novel.id, "share");
    }
    const url = `${window.location.origin}/novels/${encodeURIComponent(novel.id)}`;
    try {
      const result = await shareOrCopyLink({ title: novel.title, text: `«${novel.title}» اثر ${novel.author} را از دست ندهید!`, url });
      if (result === "copied") alert('پیوند در کلیپ‌بورد کپی شد!');
    } catch (err: any) {
      if (err?.name !== "AbortError") alert("کپی این پیوند ممکن نشد.");
    }
  };

  const handleToggleLike = async () => {
    if (!currentUser || likeBusy) return;
    const token = api.getToken();
    if (!token) return;
    const nextLiked = !liked;
    if (nextLiked) {
      setLikeBurst(false);
      requestAnimationFrame(() => setLikeBurst(true));
      window.setTimeout(() => setLikeBurst(false), 700);
    }
    setLikeBusy(true);
    try {
      setLiked(nextLiked);
      setLikesCount((prev) => Math.max(0, prev + (nextLiked ? 1 : -1)));
      const result = await api.toggleNovelLike(token, novel.id, nextLiked);
      if (result) {
        setLiked(result.liked);
        setLikesCount(result.likesCount || 0);
        onLikeChange?.(result.likesCount || 0);
        if (result.liked) api.trackEvent(currentUser.id, novel.id, "favorite");
      } else {
        setLiked(!nextLiked);
        setLikesCount((prev) => Math.max(0, prev + (nextLiked ? -1 : 1)));
      }
    } finally {
      setLikeBusy(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !currentUser) return;
    const submittedComment = newComment.trim();
    const review: Review = {
      id: "pending",
      userId: currentUser.id,
      username: currentUser.username || "شما",
      displayName: currentUser.nickname || currentUser.username || "شما",
      avatar: currentUser.avatar || "",
      role: currentUser.role || "reader",
      rating: 5,
      comment: submittedComment,
      createdAt: new Date().toISOString()
    };

    api.trackEvent(currentUser.id, novel.id, "comment");

    try {
      const saved = await api.addReview(novel.id, review);
      if (saved?.review) {
        setComments((prev) => [...prev.filter((item) => item.userId !== saved.review.userId), saved.review]);
      }
      setNewComment('');
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveToCategory = async (categoryName: string) => {
    if (currentUser) {
       api.trackEvent(currentUser.id, novel.id, "library_add");
    }
    onToggleBookmark(true);
    const token = api.getToken();
    if (token) {
      const currentCategories = normalizeBookmarkCategories(categories);
      const updatedCats = currentCategories.map((category: any) => {
        const existingItems = Array.isArray(category.items) ? category.items : [];
        if (category.name === categoryName && !existingItems.includes(novel.id)) {
          return { ...category, items: [...existingItems, novel.id] };
        }
        return { ...category, items: existingItems };
      });
      setCategories(updatedCats);
      await api.saveBookmarkCategories(token, updatedCats);
    }
    setShowSaveDialog(false);
  };

  const displayTags = filterTaxonomyList([...(novel.tags || []), novel.genre, ...(novel.subCategories || [])])
    .filter((v, i, a) => v && a.indexOf(v) === i)
    .slice(0, 5);
  const displayWarnings = filterTaxonomyList(novel.warnings || []);

  return (
    <div className="feed-post-shell flex flex-col items-center justify-center overflow-hidden">
      <div className={`feed-post-card w-full h-full md:max-w-md md:h-[90%] md:rounded-2xl flex flex-col relative overflow-hidden ${cardBg} md:border ${borderCol} md:shadow-2xl`}>
        
        {/* Author Header */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-3 px-4 bg-gradient-to-b from-black/60 to-transparent">
          <div 
            className="flex items-center gap-3 cursor-pointer group"
            onClick={() => onNavigateToAuthor?.(novel.authorUsername || novel.author)}
          >
            <div className="relative">
              <div className="feed-avatar-ring absolute -inset-[2px] bg-linear-to-tr from-rose-500 via-fuchsia-500 to-violet-500 rounded-full animate-spin-slow"></div>
              <div className={`relative w-9 h-9 rounded-full border-2 border-black overflow-hidden bg-slate-800 flex justify-center items-center text-xs font-bold text-white`}>
                {authorAvatarUrl ? (
                  <SafeImage src={authorAvatarUrl} alt={authorDisplayName} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                ) : (
                  avatarInitials(authorDisplayName)
                )}
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-[14px] leading-tight text-white drop-shadow-md">{authorDisplayName}</span>
              <span className="text-[11px] text-stone-300 drop-shadow-md">پیشنهاد ویژه برای شما</span>
            </div>
          </div>
          <button className="p-2 rounded-full transition-colors text-white hover:bg-black/20">
            <MoreHorizontal className="w-5 h-5 drop-shadow-lg" />
          </button>
        </div>

        {/* Middle: Banner / Book Cover */}
        <div className="relative flex-1 bg-black overflow-hidden flex items-center justify-center group" onDoubleClick={handleToggleLike}>
          {novel.coverUrl ? (
            <SafeImage
              src={novel.coverUrl} 
              alt="جلد"
              loading={isActive ? "eager" : "lazy"}
              decoding="async"
              fetchPriority={isActive ? "high" : "low"}
              className="absolute inset-0 w-full h-full object-cover opacity-80 select-none"
            />
          ) : (
            <div className="absolute inset-0 w-full h-full bg-linear-to-b from-slate-900 to-[#060409] flex items-center justify-center opacity-80">
              <span className="text-white opacity-20 font-serif text-4xl italic px-4 text-center">{novel.title}</span>
            </div>
          )}
          
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent pointer-events-none" />

          {/* Comics read in a page viewer, so the format is flagged before the
              reader taps through. */}
          {isMangaWork(novel) && (
            <span className="absolute right-3 top-16 z-10 rounded-lg bg-fuchsia-600/90 px-2 py-1 text-[10px] font-black text-white backdrop-blur-sm">
              مانگا
            </span>
          )}
        </div>

        {/* Floating Right Actions */}
        <div className="absolute left-3 bottom-24 z-20 flex flex-col gap-6 items-center">
          <div className="flex flex-col items-center gap-1.5">
            <button 
              onClick={handleToggleLike} 
              className="feed-action-button group relative transition-transform active:scale-90 bg-black/30 backdrop-blur-md p-2.5 rounded-full"
            >
              <Heart className={`w-[26px] h-[26px] transition-all ${liked ? 'fill-rose-500 text-rose-500 drop-shadow-[0_0_15px_rgba(244,63,94,0.6)]' : 'text-white'}`} />
              {likeBurst && <>
                <Heart className="pointer-events-none absolute -top-4 left-0 w-3 h-3 fill-rose-400 text-rose-400 animate-ping" />
                <Heart className="pointer-events-none absolute -top-2 -right-3 w-2.5 h-2.5 fill-pink-300 text-pink-300 animate-bounce" />
                <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-rose-400 animate-ping" />
              </>}
            </button>
            <span className="font-semibold text-xs text-white drop-shadow-md tabular-nums">{likesCount.toLocaleString()}</span>
          </div>
          
          <div className="flex flex-col items-center gap-1.5">
            <button 
              onClick={() => setShowComments(true)} 
              aria-label="باز کردن دیدگاه‌ها"
              className="feed-action-button transition-transform active:scale-90 bg-black/30 backdrop-blur-md p-2.5 rounded-full"
            >
              <MessageCircle className="w-[26px] h-[26px] text-white" />
            </button>
            <span className="font-semibold text-xs text-white drop-shadow-md tabular-nums">{comments.length}</span>
          </div>
          
          <button aria-label="هم‌رسانی داستان" onClick={handleShare} className="feed-action-button transition-transform active:scale-90 bg-black/30 backdrop-blur-md p-2.5 rounded-full flex flex-col items-center gap-1.5">
            <Share2 className="w-[24px] h-[24px] text-white" />
          </button>
          
          <button aria-label={isBookmarked ? "حذف نشانک" : "نشانک‌گذاری داستان"} onClick={() => isBookmarked ? onToggleBookmark(false) : setShowSaveDialog(true)} className="feed-action-button transition-transform active:scale-90 bg-black/30 backdrop-blur-md p-2.5 rounded-full mt-2">
            <Bookmark className={`w-[26px] h-[26px] ${isBookmarked ? 'fill-yellow-500 text-yellow-500' : 'text-white'}`} />
          </button>
        </div>

        {/* Bottom Left Info */}
        <div className="absolute right-0 left-16 bottom-0 z-20 p-4 pt-16 flex flex-col pointer-events-none">
          <h3 
            className="font-display font-bold text-[18px] leading-tight mb-1 text-white drop-shadow-xl cursor-pointer pointer-events-auto hover:text-violet-400"
            onClick={() => {
              if (currentUser) api.trackEvent(currentUser.id, novel.id, "click");
              onNavigateToNovel?.(novel.id);
            }}
          >
            {novel.title}
          </h3>
          
          <div className="mb-2 pointer-events-auto">
            <span className={`text-[14px] leading-relaxed text-stone-200 drop-shadow-lg`}>
              {showFullDesc ? novel.description : (novel.description.length > 90 ? `${novel.description.substring(0, 90)}...` : novel.description)}
            </span>
            {novel.description.length > 90 && (
              <button 
                onClick={() => setShowFullDesc(!showFullDesc)} 
                className="ml-1.5 text-[14px] font-bold text-white drop-shadow-lg"
              >
                {showFullDesc ? 'کمتر' : 'بیشتر'}
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pointer-events-auto mt-2">
            {displayWarnings.map(w => {
              const warningMeta = CONTENT_WARNINGS.find(cw => cw.id === w);
              return (
                <span 
                  key={w} 
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded backdrop-blur-sm bg-red-500/80 text-white shadow-sm border border-red-500/40 flex items-center gap-1"
                >
                  <AlertTriangle className="w-3 h-3" />
                  {warningMeta ? warningMeta.label : w}
                </span>
              );
            })}
            {displayTags.map(tag => (
              <span 
                key={tag} 
                className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded backdrop-blur-sm bg-white/20 text-white shadow-sm border border-white/20"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Render outside the feed card so mobile clipping and stacking cannot trap the sheet. */}
        {createPortal(
          <AnimatePresence>
            {showComments && (
              <motion.div
                key="comments-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 md:items-center md:p-5"
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) setShowComments(false);
                }}
              >
                <motion.section
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={`feed-comments-${novel.id}`}
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 30, stiffness: 360 }}
                  drag="y"
                  dragControls={commentsDragControls}
                  dragListener={false}
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={{ top: 0, bottom: 0.45 }}
                  onDragEnd={(_, info) => {
                    if (info.offset.y > 90 || info.velocity.y > 650) setShowComments(false);
                  }}
                  className={`feed-comments-sheet flex max-h-[85dvh] min-h-[50dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t shadow-2xl md:max-h-[min(80vh,46rem)] md:max-w-lg md:rounded-3xl md:border ${borderCol} ${theme === 'dark' ? 'bg-[#0b0716]' : 'bg-white'}`}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div
                    className="flex shrink-0 touch-none cursor-grab justify-center py-2 active:cursor-grabbing md:hidden"
                    aria-hidden="true"
                    onPointerDown={(event) => commentsDragControls.start(event)}
                  >
                    <span className="h-1.5 w-12 rounded-full bg-slate-400/50" />
                  </div>

                  <div className={`flex min-h-14 shrink-0 items-center justify-between border-b px-4 ${borderCol}`}>
                    <div>
                      <h3 id={`feed-comments-${novel.id}`} className={`font-bold ${textPrimary}`}>دیدگاه‌ها</h3>
                      <p className={`text-xs ${textSecondary}`}>{comments.length} دیدگاه</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowComments(false)}
                      aria-label="بستن دیدگاه‌ها"
                      className={`flex h-11 w-11 touch-manipulation items-center justify-center rounded-full ${textSecondary} hover:bg-slate-500/10 hover:text-violet-500 active:scale-95`}
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </div>

                  <div className="feed-comments-list flex-1 overflow-y-auto overscroll-contain p-4 space-y-4">
                    {comments.length === 0 ? (
                      <p className={`text-center text-sm ${textSecondary} mt-10`}>هنوز دیدگاهی ثبت نشده است. اولین نفر باشید!</p>
                    ) : (
                      comments.map((rev) => (
                        <div key={rev.id} className="flex gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-800 flex justify-center items-center text-xs font-bold text-white shrink-0 overflow-hidden">
                            {getSafeAvatarUrl(rev.avatar) ? (
                              <SafeImage src={getSafeAvatarUrl(rev.avatar) || ""} alt={rev.displayName || rev.username} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                            ) : (
                              avatarInitials(rev.displayName || rev.username)
                            )}
                          </div>
                          <div className="flex min-w-0 flex-col">
                            <span className={`text-[13px] font-bold ${textPrimary}`}>{rev.displayName || rev.username}</span>
                            {rev.displayName && rev.username && rev.displayName !== rev.username && (
                              <span className={`text-[10px] -mt-0.5 ${textSecondary}`}>@{rev.username}</span>
                            )}
                            <span className={`break-words text-[14px] ${theme === 'dark' ? 'text-stone-300' : 'text-stone-700'}`}>{rev.comment}</span>
                            <span className={`text-[10px] mt-1 ${textSecondary}`}>{new Date(rev.createdAt).toLocaleDateString('fa-IR')}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className={`flex shrink-0 items-center gap-3 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${borderCol}`}>
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex justify-center items-center text-xs font-bold text-white shrink-0 overflow-hidden">
                      {getSafeAvatarUrl(currentUser?.avatar) ? (
                        <SafeImage src={getSafeAvatarUrl(currentUser?.avatar) || ""} alt={currentUser?.nickname || currentUser?.username || "من"} decoding="async" className="w-full h-full object-cover" />
                      ) : (
                        avatarInitials(currentUser?.nickname || currentUser?.username || "من")
                      )}
                    </div>
                    <input
                      type="text"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder={currentUser ? "دیدگاهی بنویسید..." : "برای نوشتن دیدگاه وارد شوید"}
                      disabled={!currentUser}
                      className={`min-h-11 flex-1 rounded-full bg-slate-500/10 px-4 text-base md:text-sm border-none outline-none placeholder:text-stone-500 ${textPrimary}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAddComment();
                      }}
                    />
                    <button
                      type="button"
                      aria-label="ارسال دیدگاه"
                      onClick={handleAddComment}
                      disabled={!currentUser || !newComment.trim()}
                      className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full text-violet-500 transition-opacity active:scale-95 disabled:opacity-40"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                </motion.section>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

        {/* Save Dialog Popup */}
        <AnimatePresence>
          {showSaveDialog && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center pb-24 md:items-center md:pb-0 p-4"
              onClick={() => setShowSaveDialog(false)}
            >
              <motion.div 
                initial={{ y: 50, scale: 0.95 }}
                animate={{ y: 0, scale: 1 }}
                exit={{ y: 50, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className={`w-full max-w-sm rounded-2xl ${cardBg} border ${borderCol} p-5 shadow-2xl`}
              >
                <div className="flex justify-between items-center mb-4">
                  <h3 className={`font-bold text-lg ${textPrimary}`}>ذخیره در...</h3>
                  <button onClick={() => setShowSaveDialog(false)} className={textSecondary}><X className="w-5 h-5"/></button>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {categories.map((cat, idx) => (
                    <button 
                      key={idx}
                      onClick={() => handleSaveToCategory(cat.name)}
                      className={`w-full text-left p-3 rounded-xl transition-colors ${theme === 'dark' ? 'hover:bg-slate-800 text-stone-200' : 'hover:bg-stone-100 text-stone-800'} flex items-center justify-between`}
                    >
                      <span className="font-semibold text-sm">{cat.name}</span>
                      {(Array.isArray(cat.items) ? cat.items : []).includes(novel.id) && <Heart className="w-4 h-4 fill-violet-500 text-violet-500" />}
                    </button>
                  ))}
                  {categories.length === 0 && !currentUser && (
                    <p className={`text-sm ${textSecondary} text-center`}>برای ذخیره در دسته‌های دلخواه، وارد شوید.</p>
                  )}
                  {categories.length === 0 && currentUser && (
                     <p className={`text-sm ${textSecondary} text-center`}>در حال بارگذاری دسته‌ها...</p>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
