import React, { useState, useEffect } from "react";
import { MessageSquare, Users, Eye, ArrowUp, Sparkles, Filter, Plus, Flame, Search, RefreshCcw, X } from "lucide-react";
import { api } from "../utils/api";
import ThreadView from "./ThreadView";
import { Novel } from "../types";

interface ForumsProps {
  theme: "light" | "dark";
  currentUser: { username: string; role: string; level: number; xp: number; avatar: string; is_premium?: boolean; custom_permissions?: string[] } | null;
  systemSettings?: any;
  novels?: Novel[];
  onNavigateToNovel?: (id: string) => void;
}

interface Thread {
  id: string;
  title: string;
  content: string;
  author: string;
  authorRole: string;
  replies: number;
  votes: number;
  views: number;
  category: string;
  timeAgo: string;
  created_at?: string;
  isHot: boolean;
  isPinned: boolean;
  approvalStatus?: string;
}

const DEFAULT_CATEGORIES = ["همه انجمن‌ها", "اعلانات", "مهارت نویسندگی", "گفت‌وگو درباره کلیشه‌ها", "پیشنهاد رمان", "گفت‌وگوی عمومی"];
const SORT_OPTIONS = ["جدیدترین", "قدیمی‌ترین", "محبوب‌ترین", "داغ‌ترین", "پربازدیدترین", "بیشترین پاسخ"];
const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  "all categories": "همه انجمن‌ها",
  announcements: "اعلانات",
  "writing craft": "مهارت نویسندگی",
  "tropes discussion": "گفت‌وگو درباره کلیشه‌ها",
  recommendations: "پیشنهاد رمان",
  "general chat": "گفت‌وگوی عمومی",
};

function cleanLabel(value: any) {
  const label = String(value?.name ?? value?.label ?? value?.title ?? value ?? "").trim();
  return LEGACY_CATEGORY_LABELS[label.toLowerCase()] || label;
}

function categoryKey(value: any) {
  return cleanLabel(value).toLowerCase();
}

function uniqueLabels(values: any[]) {
  const seen = new Set<string>();
  return values.map(cleanLabel).filter((label) => {
    if (!label) return false;
    const key = label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function configuredCategories(systemSettings: any, threads: Thread[]) {
  const raw = Array.isArray(systemSettings?.forumCategories) ? systemSettings.forumCategories : DEFAULT_CATEGORIES;
  const labels = uniqueLabels(["همه انجمن‌ها", ...raw, ...threads.map((thread) => thread.category)]);
  return labels.some((label) => categoryKey(label) === "همه انجمن‌ها") ? labels : ["همه انجمن‌ها", ...labels];
}

function normalizeThread(row: any): Thread {
  const category = cleanLabel(row?.category || row?.forum_id || "گفت‌وگوی عمومی") || "گفت‌وگوی عمومی";
  const views = Number(row?.views || 0);
  return {
    id: String(row?.id || ""),
    title: String(row?.title || "موضوع بی‌عنوان"),
    content: String(row?.content ?? row?.body ?? row?.description ?? row?.message ?? row?.text ?? row?.post_content ?? row?.initial_post ?? ""),
    author: String(row?.author || row?.author_username || row?.username || "ناشناس"),
    authorRole: String(row?.authorRole || row?.author_role || row?.role || "خواننده"),
    replies: Math.max(0, Number(row?.replies || 0) || 0),
    votes: Math.max(0, Number(row?.votes || 0) || 0),
    views: Math.max(0, views || 0),
    category,
    timeAgo: String(row?.timeAgo || row?.created_at || new Date().toISOString()),
    created_at: row?.created_at,
    isHot: Boolean(row?.isHot) || views > 100,
    isPinned: row?.isPinned === true || row?.is_pinned === true || row?.is_pinned === 1 || String(row?.is_pinned || "").toLowerCase() === "true"
    , approvalStatus: String(row?.approvalStatus || row?.approval_status || "pending_approval")
  };
}

function threadDate(thread: Thread) {
  const time = new Date(thread.created_at || thread.timeAgo || "").getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatThreadTime(value: string) {
  const date = new Date(value || "");
  const time = date.getTime();
  if (!Number.isFinite(time)) return "";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (diffSeconds < 60) return "همین حالا";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} دقیقه پیش`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} ساعت پیش`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} روز پیش`;
  return date.toLocaleDateString("fa-IR", { month: "short", day: "numeric", year: "numeric" });
}

export default function Forums({ theme, currentUser, systemSettings, novels = [], onNavigateToNovel }: ForumsProps) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeCategory, setActiveCategory] = useState("همه انجمن‌ها");
  const [searchQuery, setSearchQuery] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState("گفت‌وگوی عمومی");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [sortBy, setSortBy] = useState("جدیدترین");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createNotice, setCreateNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [votingIds, setVotingIds] = useState<Set<string>>(() => new Set());
  const [serverCategories, setServerCategories] = useState<string[]>([]);
  const canModerateForums = !!currentUser && (
    ["owner", "publisher", "editor"].includes(String(currentUser.role || "").toLowerCase()) ||
    (currentUser.custom_permissions || []).some((permission) => permission === "admin:*" || permission === "moderate:*" || permission === "forum:moderate" || permission === "forum:*")
  );

  const loadThreads = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await api.getThreads();
      setThreads((loaded || []).map(normalizeThread).filter((thread) => thread.id));
    } catch {
      setLoadError("بارگیری موضوعات انجمن ممکن نشد. لطفاً دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    api.getForumCategories().then((loaded) => {
      if (loaded.length) setServerCategories(loaded);
    }).catch(() => {});
  }, []);

  const categorySettings = React.useMemo(
    () => serverCategories.length ? { forumCategories: serverCategories } : systemSettings,
    [serverCategories, systemSettings]
  );
  const categories = React.useMemo(() => configuredCategories(categorySettings, threads), [categorySettings, threads]);
  const postCategories = React.useMemo(() => categories.filter((category) => categoryKey(category) !== "همه انجمن‌ها"), [categories]);
  const canCreateAnnouncements = !!currentUser && (
    currentUser.role === "owner" ||
    (currentUser.custom_permissions || []).some((permission) => permission === "admin:*" || permission === "forum:*" || permission === "forum:announce")
  );
  const allowedPostCategories = React.useMemo(() => postCategories.filter((category) => categoryKey(category) !== "اعلانات" || canCreateAnnouncements), [postCategories, canCreateAnnouncements]);

  useEffect(() => {
    if (!categories.some((category) => categoryKey(category) === categoryKey(activeCategory))) {
      setActiveCategory("همه انجمن‌ها");
    }
  }, [activeCategory, categories]);

  useEffect(() => {
    if (allowedPostCategories.length && !allowedPostCategories.some((category) => categoryKey(category) === categoryKey(newCategory))) {
      setNewCategory(allowedPostCategories[0]);
    }
  }, [newCategory, allowedPostCategories]);

  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    const content = newContent.trim();
    setCreateError(null);
    setCreateNotice(null);

    if (!currentUser) {
      setCreateError("برای ارسال موضوع باید وارد حساب شوید.");
      return;
    }
    if (!title || !content) {
      setCreateError("پیش از انتشار، هم عنوان و هم محتوا را وارد کنید.");
      return;
    }
    if (creating) return;

    setCreating(true);
    try {
      const payload = {
        title,
        author: currentUser.username,
        authorRole: currentUser.role || "نویسنده",
        category: newCategory,
        content
      };
      const result = await api.createThread(payload);
      if (!result.success) {
        setCreateError(result.error || "موضوع منتشر نشد. لطفاً دوباره تلاش کنید.");
        return;
      }

      const created = normalizeThread(result.thread || {
        id: result.id,
        title,
        content,
        author: currentUser.username,
        authorRole: currentUser.role || "نویسنده",
        category: newCategory,
        timeAgo: new Date().toISOString(),
        replies: 0,
        votes: 0,
        views: 0
      });

      setThreads((previous) => [created, ...previous.filter((thread) => thread.id !== created.id)]);
      setCreateNotice("موضوع ارسال شد و در انتظار تأیید مالک است.");
      setNewTitle("");
      setNewContent("");
      setShowCreateForm(false);
      void loadThreads();
    } catch {
      setCreateError("خطای شبکه هنگام انتشار موضوع.");
    } finally {
      setCreating(false);
    }
  };

  const handleVote = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) {
      setLoadError("برای رأی دادن ابتدا باید وارد حساب شوید.");
      return;
    }
    if (votingIds.has(id)) return;

    setVotingIds((previous) => new Set(previous).add(id));
    setLoadError(null);
    try {
      const success = await api.voteThread(id);
      if (!success) {
        setLoadError("رأی شما ثبت نشد. ممکن است قبلاً رأی داده باشید.");
        return;
      }
      setThreads((previous) => previous.map((thread) => thread.id === id ? { ...thread, votes: thread.votes + 1 } : thread));
      void loadThreads();
    } catch {
      setLoadError("خطای شبکه هنگام رأی دادن.");
    } finally {
      setVotingIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  };

  const handleApproveThread = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    const result = await api.approveThread(id);
    if (!result?.success) {
      if (result?.status === 404) {
        setThreads((previous) => previous.filter((thread) => thread.id !== id));
        if (activeThread?.id === id) setActiveThread(null);
        setLoadError(null);
        return;
      }
      return setLoadError(result?.error || "تأیید موضوع ناموفق بود.");
    }
    await loadThreads();
  };

  const handleRejectThread = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    const result = await api.rejectThread(id);
    if (!result?.success) {
      if (result?.status === 404) {
        setThreads((previous) => previous.filter((thread) => thread.id !== id));
        if (activeThread?.id === id) setActiveThread(null);
        setLoadError(null);
        return;
      }
      return setLoadError(result?.error || "رد موضوع ناموفق بود.");
    }
    await loadThreads();
  };

  const handleThreadBack = () => {
    setActiveThread(null);
    void loadThreads();
  };

  const handleThreadDeleted = (id: string) => {
    setThreads((previous) => previous.filter((thread) => thread.id !== id));
    setActiveThread(null);
    void loadThreads();
  };

  const filteredThreads = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const activeKey = categoryKey(activeCategory);
    return threads.filter((thread) => {
      const matchesCategory = activeKey === "همه انجمن‌ها" || categoryKey(thread.category) === activeKey;
      const haystack = [thread.title, thread.author, thread.content, thread.category, thread.authorRole].join(" ").toLowerCase();
      return matchesCategory && (!query || haystack.includes(query));
    });
  }, [activeCategory, searchQuery, threads]);

  const sortedThreads = React.useMemo(() => {
    return [...filteredThreads].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      switch (sortBy) {
        case "قدیمی‌ترین":
          return threadDate(a) - threadDate(b);
        case "محبوب‌ترین":
        case "داغ‌ترین":
          return b.votes - a.votes || threadDate(b) - threadDate(a);
        case "پربازدیدترین":
          return b.views - a.views || threadDate(b) - threadDate(a);
        case "بیشترین پاسخ":
          return b.replies - a.replies || threadDate(b) - threadDate(a);
        case "جدیدترین":
        default:
          return threadDate(b) - threadDate(a);
      }
    });
  }, [filteredThreads, sortBy]);

  return (
    <div className="space-y-6 pb-16">
      <section className={`p-5 md:p-8 rounded-2xl border ${
        theme === "dark"
          ? "bg-gradient-to-br from-black via-[#080b20] to-violet-950/20 border-violet-900/40 shadow-[0_0_15px_rgba(139,92,246,0.1)]"
          : "bg-gradient-to-br from-amber-50/40 to-white border-[#E7DEC8] shadow-sm"
      }`}>
        <div className="max-w-3xl space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-medium border border-violet-500/20 bg-violet-500/10 text-violet-400">
            <Users className="w-3.5 h-3.5" />
            <span>میدان جامعه</span>
          </div>
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight">انجمن‌های رپتوک</h1>
          <p className="text-sm md:text-base text-slate-400 leading-relaxed max-w-2xl">
            درباره رمان‌ها، پیشنهادها، مهارت نویسندگی و تازه‌های جامعه گفت‌وگو کنید.
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 lg:gap-7 items-start">
        <aside className="lg:col-span-1 space-y-4">
          <div className={`p-4 rounded-2xl border ${
            theme === "dark" ? "bg-[#0b0716] border-violet-900/30" : "bg-white border-[#E7DEC8]"
          } space-y-3`}>
            <h3 className="font-extrabold text-sm flex items-center gap-2 text-violet-400">
              <Filter className="w-4 h-4" />
              <span>انجمن‌های گفت‌وگو</span>
            </h3>
            <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {categories.map((category) => {
                const isActive = categoryKey(activeCategory) === categoryKey(category);
                return (
                  <button
                    key={category}
                    onClick={() => setActiveCategory(category)}
                    className={`shrink-0 lg:w-full lg:text-left px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                      isActive
                        ? "bg-violet-600 text-white"
                        : theme === "dark"
                          ? "text-slate-400 hover:text-white hover:bg-slate-800/40"
                          : "text-stone-600 hover:text-stone-900 hover:bg-stone-100"
                    }`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={() => {
              setShowCreateForm((value) => !value);
              setCreateError(null);
            }}
            className="w-full py-3 rounded-2xl font-bold text-xs bg-purple-600 hover:bg-purple-500 text-white shadow flex items-center justify-center gap-2 cursor-pointer transition-transform hover:scale-[1.01]"
          >
            <Plus className="w-4 h-4" />
            <span>ایجاد موضوع تازه</span>
          </button>
          {createNotice && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">{createNotice}</div>}
        </aside>

        <main className="lg:col-span-3 min-w-0 space-y-5">
          {activeThread ? (
            <ThreadView
              thread={activeThread}
              theme={theme}
              onBack={handleThreadBack}
              onDeleted={handleThreadDeleted}
              currentUser={currentUser}
              novels={novels}
              onNavigateToNovel={onNavigateToNovel}
            />
          ) : (
            <>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-black truncate">{activeCategory}</h2>
                  <p className="text-xs text-slate-500">{sortedThreads.length} موضوع</p>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_auto] sm:flex gap-2 w-full md:w-auto">
                  <div className="relative min-w-0 sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      placeholder="جست‌وجوی عنوان، نویسنده، محتوا..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className={`w-full pl-9 pr-4 py-2 text-xs rounded-xl focus:outline-none border ${
                        theme === "dark"
                          ? "bg-[#0e0a1c] border-violet-950 text-white focus:border-violet-500"
                          : "bg-white border-[#E7DEC8] text-stone-900 focus:border-amber-500"
                      }`}
                    />
                  </div>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className={`min-w-[8.5rem] px-3 py-2 text-xs font-bold rounded-xl outline-none border cursor-pointer ${
                      theme === "dark"
                        ? "bg-[#0e0a1c] border-violet-950 text-white"
                        : "bg-white border-[#E7DEC8] text-stone-900"
                    }`}
                  >
                    {SORT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
              </div>

              {loadError && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                  <span>{loadError}</span>
                  <button onClick={loadThreads} className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-500/20 px-3 py-2 text-xs font-bold text-rose-100">
                    <RefreshCcw className="w-3.5 h-3.5" />
                    تلاش دوباره
                  </button>
                </div>
              )}

              {showCreateForm && (
                <form
                  onSubmit={handleCreateThread}
                  className={`p-4 md:p-5 rounded-2xl border ${
                    theme === "dark" ? "bg-[#090b1c] border-violet-800/40" : "bg-orange-50/20 border-amber-200"
                  } space-y-4`}
                >
                  <h3 className="text-sm font-extrabold flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <span>شروع گفت‌وگوی تازه</span>
                  </h3>

                  {createError && (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                      {createError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2 space-y-1">
                      <label className="block text-[10px] font-mono font-extrabold text-slate-500 uppercase">عنوان موضوع</label>
                      <input
                        type="text"
                        required
                        maxLength={120}
                        placeholder="درباره چه می‌خواهید گفت‌وگو کنید؟"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        className={`w-full px-4 py-2.5 text-sm rounded-xl focus:outline-none border ${
                          theme === "dark" ? "bg-black border-slate-800 text-white" : "bg-white border-stone-200"
                        }`}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[10px] font-mono font-extrabold text-slate-500 uppercase">انتخاب انجمن</label>
                      <select
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        className={`w-full px-4 py-2.5 text-sm rounded-xl focus:outline-none border ${
                          theme === "dark" ? "bg-black border-slate-800 text-white" : "bg-white border-stone-200"
                        }`}
                      >
                        {allowedPostCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10px] font-mono font-extrabold text-slate-500 uppercase">متن گفت‌وگو</label>
                    <textarea
                      required
                      maxLength={10000}
                      placeholder="افکارتان را با دیگران در میان بگذارید..."
                      value={newContent}
                      onChange={(e) => setNewContent(e.target.value)}
                      className={`w-full min-h-[120px] px-4 py-3 text-sm rounded-xl focus:outline-none border resize-y ${
                        theme === "dark" ? "bg-black border-slate-800 text-white" : "bg-white border-stone-200"
                      }`}
                    />
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateForm(false);
                        setCreateError(null);
                      }}
                      className={`px-4 py-2 rounded-xl text-xs font-semibold ${
                        theme === "dark" ? "text-slate-400 hover:text-white" : "text-stone-500 hover:text-stone-900"
                      }`}
                    >
                      انصراف
                    </button>
                    <button
                      type="submit"
                      disabled={creating || !newTitle.trim() || !newContent.trim()}
                      className="px-5 py-2 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {creating ? "در حال انتشار..." : "انتشار موضوع"}
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-4">
                {loading ? (
                  <div className={`rounded-2xl border p-5 text-sm ${theme === "dark" ? "bg-[#0b0716] border-violet-950/40 text-slate-400" : "bg-white border-[#E7DEC8] text-stone-500"}`}>
                    در حال بارگیری موضوعات انجمن...
                  </div>
                ) : sortedThreads.length === 0 ? (
                  <div className={`rounded-2xl border border-dashed p-6 text-center text-sm ${theme === "dark" ? "border-violet-950/50 text-slate-500" : "border-stone-300 text-stone-500"}`}>
                    در این بخش موضوعی پیدا نشد.
                  </div>
                ) : sortedThreads.map((thread) => (
                  <article
                    key={thread.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveThread(thread)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") setActiveThread(thread);
                    }}
                    className={`p-4 md:p-5 rounded-2xl border cursor-pointer hover:border-violet-500/40 transition-all ${
                      theme === "dark" ? "bg-[#0b0716] border-violet-950/40" : "bg-white border-[#E7DEC8]"
                    } flex items-start justify-between gap-3 group`}
                  >
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-400">
                          {thread.category}
                        </span>
                        {thread.isPinned && (
                          <span className="text-[9px] font-bold text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded">سنجاق‌شده</span>
                        )}
                        {thread.isHot && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                            <Flame className="w-3 h-3 fill-amber-500/20" />
                            <span>داغ</span>
                          </span>
                        )}
                        {thread.approvalStatus !== "approved" && <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">در انتظار تأیید</span>}
                        <span className="text-[10px] text-slate-500 font-medium">
                          توسط <span className="font-bold text-slate-300 dark:text-violet-100">{thread.author}</span>
                        </span>
                        <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">
                          {thread.authorRole}
                        </span>
                      </div>

                      <h3 className="font-extrabold text-sm md:text-base leading-snug group-hover:text-violet-400 transition-colors break-words">
                        {thread.title}
                      </h3>

                      {thread.content && (
                        <p className="line-clamp-2 text-xs leading-relaxed text-slate-500 break-words">
                          {thread.content}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 font-mono">
                        <span>{formatThreadTime(thread.timeAgo)}</span>
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>{thread.replies} پاسخ</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Eye className="w-3.5 h-3.5" />
                          <span>{thread.views} بازدید</span>
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={(e) => handleVote(thread.id, e)}
                      disabled={votingIds.has(thread.id)}
                      className={`flex flex-col items-center justify-center p-2.5 rounded-xl border w-12 shrink-0 transition-all hover:bg-emerald-500/10 hover:text-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed ${
                        theme === "dark" ? "bg-black/40 border-slate-800/40 text-slate-400" : "bg-stone-50 border-stone-200 text-stone-500"
                      }`}
                      title="رأی مثبت به این گفت‌وگو"
                    >
                      <ArrowUp className="w-4 h-4 mb-0.5" />
                      <span className="text-xs font-black font-mono">{thread.votes}</span>
                    </button>
                    {canModerateForums && thread.approvalStatus !== "approved" && (
                      <div className="flex gap-2 shrink-0">
                        <button onClick={(event) => handleApproveThread(thread.id, event)} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-bold">تأیید</button>
                        {thread.approvalStatus !== "rejected" && <button onClick={(event) => handleRejectThread(thread.id, event)} className="px-3 py-2 rounded-xl bg-rose-600 text-white text-[10px] font-bold flex items-center gap-1"><X className="w-3 h-3" />رد</button>}
                      </div>
                    )}
                  </article>
                ))}
              </div>

            </>
          )}
        </main>
      </div>
    </div>
  );
}
