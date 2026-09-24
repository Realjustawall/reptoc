import React, { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowUpDown, BookOpen, CheckCircle2, Clock, Eye, FileText,
  Heart, Layers, Library, Search, SlidersHorizontal, Star, Trash2, TrendingUp,
  XCircle,
} from "lucide-react";
import type { Novel } from "../../types";
import SafeImage from "../SafeImage";
import { getNovelApprovalStatus } from "../../utils/novelVisibility";
import { isMangaWork } from "../../../shared/manga";
import { formatAverageViews } from "../../../shared/statistics";

/**
 * Owner library board.
 *
 * This replaced a four-column table that showed only title, author, a raw
 * status string and a delete button — an owner could not find a novel, could not
 * tell an approved work from a rejected one at a glance, and had no numbers to
 * act on. The board is now built around the three questions an owner actually
 * asks: what needs reviewing, what is this work worth, and where is the one I am
 * looking for.
 *
 * Deliberate choices:
 *   - Approve/reject stay per row and open the existing note dialog, so a
 *     moderation decision is never a single mis-click with no explanation.
 *   - Delete is the only destructive action and keeps its typed confirmation.
 *   - Everything is derived from the `novels` prop already in memory, so
 *     filtering and sorting cost no requests.
 */

export interface OwnerLibraryBoardProps {
  novels: Novel[];
  theme: "light" | "dark";
  borderClass: string;
  cardClass: string;
  shadowClass: string;
  controlClass: string;
  selectStyle: React.CSSProperties;
  onApprove: (novelId: string) => void;
  onReject: (novelId: string) => void;
  onDelete: (novelId: string) => void | Promise<void>;
  onOpenNovel?: (novelId: string) => void;
}

type StatusFilter = "all" | "approved" | "pending_approval" | "rejected";
type KindFilter = "all" | "novel" | "manga";
type SortKey = "recent" | "views" | "rating" | "chapters" | "title";

const STATUS_META: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  approved: { label: "تأییدشده", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25", icon: CheckCircle2 },
  pending_approval: { label: "در انتظار بررسی", className: "bg-amber-500/10 text-amber-400 border-amber-500/25", icon: Clock },
  rejected: { label: "ردشده", className: "bg-rose-500/10 text-rose-400 border-rose-500/25", icon: XCircle },
};

function statusMeta(novel: Novel) {
  return STATUS_META[getNovelApprovalStatus(novel)] || {
    label: getNovelApprovalStatus(novel) || "نامشخص",
    className: "bg-slate-500/10 text-slate-400 border-slate-500/25",
    icon: AlertTriangle,
  };
}

function publishedChapterCount(novel: Novel): number {
  const chapters = novel.chapters || [];
  if (chapters.length === 0) return Number(novel.publishedChapterCount || 0);
  return chapters.filter((chapter) => String((chapter as any).status || "Published").toLowerCase() === "published").length;
}

export default function OwnerLibraryBoard({
  novels,
  theme,
  borderClass,
  cardClass,
  shadowClass,
  controlClass,
  selectStyle,
  onApprove,
  onReject,
  onDelete,
  onOpenNovel,
}: OwnerLibraryBoardProps) {
  const isDark = theme === "dark";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [descending, setDescending] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /** Platform totals. Computed from the list already in memory. */
  const totals = useMemo(() => {
    let approved = 0;
    let pending = 0;
    let rejected = 0;
    let manga = 0;
    let views = 0;
    let chapters = 0;
    let words = 0;
    for (const novel of novels) {
      const novelStatus = getNovelApprovalStatus(novel);
      if (novelStatus === "approved") approved += 1;
      else if (novelStatus === "rejected") rejected += 1;
      else pending += 1;
      if (isMangaWork(novel)) manga += 1;
      views += Number(novel.viewsCount || 0);
      chapters += publishedChapterCount(novel);
      words += Number(novel.wordsCount || 0);
    }
    return { total: novels.length, approved, pending, rejected, manga, views, chapters, words };
  }, [novels]);

  const visibleNovels = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("fa-IR");
    const filtered = novels.filter((novel) => {
      if (status !== "all" && getNovelApprovalStatus(novel) !== status) return false;
      if (kind === "manga" && !isMangaWork(novel)) return false;
      if (kind === "novel" && isMangaWork(novel)) return false;
      if (!needle) return true;
      // Searching the id too is what makes a support ticket referencing an id
      // actionable without a database query.
      return [novel.title, novel.author, novel.authorUsername, novel.genre, novel.id]
        .some((field) => String(field || "").toLocaleLowerCase("fa-IR").includes(needle));
    });

    const direction = descending ? -1 : 1;
    return [...filtered].sort((left, right) => {
      switch (sort) {
        case "views":
          return direction * (Number(left.viewsCount || 0) - Number(right.viewsCount || 0));
        case "rating":
          return direction * (Number(left.rating || 0) - Number(right.rating || 0));
        case "chapters":
          return direction * (publishedChapterCount(left) - publishedChapterCount(right));
        case "title":
          return direction * String(left.title || "").localeCompare(String(right.title || ""), "fa");
        case "recent":
        default: {
          const leftTime = Date.parse(String(left.updatedAt || left.createdAt || "")) || 0;
          const rightTime = Date.parse(String(right.updatedAt || right.createdAt || "")) || 0;
          return direction * (leftTime - rightTime);
        }
      }
    });
  }, [descending, kind, novels, search, sort, status]);

  const summaryCards = [
    { label: "کل آثار", value: totals.total, icon: Library, tone: "text-violet-300", ring: "bg-violet-500/10 border-violet-500/20" },
    { label: "تأییدشده", value: totals.approved, icon: CheckCircle2, tone: "text-emerald-300", ring: "bg-emerald-500/10 border-emerald-500/20" },
    { label: "در انتظار بررسی", value: totals.pending, icon: Clock, tone: "text-amber-300", ring: "bg-amber-500/10 border-amber-500/20" },
    { label: "ردشده", value: totals.rejected, icon: XCircle, tone: "text-rose-300", ring: "bg-rose-500/10 border-rose-500/20" },
    { label: "مانگا", value: totals.manga, icon: Layers, tone: "text-fuchsia-300", ring: "bg-fuchsia-500/10 border-fuchsia-500/20" },
    { label: "فصل‌های منتشرشده", value: totals.chapters, icon: FileText, tone: "text-sky-300", ring: "bg-sky-500/10 border-sky-500/20" },
  ];

  const chip = (active: boolean) =>
    `rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
      active
        ? "bg-purple-600 text-white shadow-sm"
        : isDark ? "bg-slate-800/60 text-slate-300 hover:bg-slate-700" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
    }`;

  return (
    <div className="space-y-4 min-w-0" data-owner-library-board>
      {/* Platform totals */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map((card) => (
          <div key={card.label} className={`rounded-2xl border p-3 ${card.ring}`}>
            <div className="flex items-center justify-between gap-2">
              <card.icon className={`h-4 w-4 ${card.tone}`} />
              <span className={`text-lg font-black tabular-nums ${card.tone}`}>
                {Number(card.value || 0).toLocaleString("fa-IR")}
              </span>
            </div>
            <p className="mt-1 text-[9px] font-mono uppercase leading-tight text-slate-500">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Reach summary: the two numbers an owner reports upward. */}
      <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border p-3.5 ${borderClass} ${cardClass}`}>
        <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-400">
          <TrendingUp className="h-4 w-4 text-violet-400" />
          بازدید کل: <span className="font-mono text-violet-300">{formatAverageViews(totals.views)}</span>
        </span>
        <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-400">
          <BookOpen className="h-4 w-4 text-emerald-400" />
          واژگان منتشرشده: <span className="font-mono text-emerald-300">{totals.words.toLocaleString("fa-IR")}</span>
        </span>
        {totals.pending > 0 && (
          <button
            type="button"
            onClick={() => { setStatus("pending_approval"); setSearch(""); }}
            className="ms-auto inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-black text-amber-300 hover:bg-amber-500/20"
          >
            <Clock className="h-3.5 w-3.5" />
            {totals.pending.toLocaleString("fa-IR")} اثر در انتظار بررسی
          </button>
        )}
      </div>

      {/* Controls */}
      <div className={`space-y-3 rounded-2xl border p-3.5 ${borderClass} ${cardClass}`}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="جست‌وجوی عنوان، نویسنده، ژانر یا شناسه…"
              className={`w-full rounded-xl border py-2.5 pe-3 ps-10 text-xs ${controlClass}`}
              aria-label="جست‌وجو در کتابخانه"
            />
          </label>

          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-slate-500" />
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              style={selectStyle}
              className={`rounded-xl border p-2.5 text-xs ${controlClass}`}
              aria-label="ترتیب فهرست"
            >
              <option value="recent">آخرین به‌روزرسانی</option>
              <option value="views">بیشترین بازدید</option>
              <option value="rating">بالاترین امتیاز</option>
              <option value="chapters">بیشترین فصل</option>
              <option value="title">عنوان (الفبایی)</option>
            </select>
            <button
              type="button"
              onClick={() => setDescending((value) => !value)}
              className={`rounded-xl border p-2.5 ${borderClass} text-slate-400 hover:text-purple-300`}
              title={descending ? "نزولی — برای صعودی کلیک کنید" : "صعودی — برای نزولی کلیک کنید"}
              aria-label="تغییر جهت ترتیب"
            >
              <ArrowUpDown className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold text-slate-500">وضعیت:</span>
          {([
            ["all", "همه"],
            ["pending_approval", "در انتظار"],
            ["approved", "تأییدشده"],
            ["rejected", "ردشده"],
          ] as Array<[StatusFilter, string]>).map(([value, label]) => (
            <button key={value} type="button" className={chip(status === value)} onClick={() => setStatus(value)}>
              {label}
            </button>
          ))}

          <span className="ms-3 text-[10px] font-bold text-slate-500">قالب:</span>
          {([
            ["all", "همه"],
            ["novel", "رمان"],
            ["manga", "مانگا"],
          ] as Array<[KindFilter, string]>).map(([value, label]) => (
            <button key={value} type="button" className={chip(kind === value)} onClick={() => setKind(value)}>
              {label}
            </button>
          ))}

          <span className="ms-auto font-mono text-[11px] font-bold text-slate-500">
            {visibleNovels.length.toLocaleString("fa-IR")} از {totals.total.toLocaleString("fa-IR")}
          </span>
        </div>
      </div>

      {/* Rows */}
      {visibleNovels.length === 0 ? (
        <div className={`rounded-2xl border border-dashed p-12 text-center ${borderClass}`}>
          <Library className="mx-auto mb-3 h-10 w-10 text-slate-500 opacity-40" />
          <h3 className="text-sm font-bold">اثری با این فیلترها پیدا نشد</h3>
          <p className="mt-1 text-xs text-slate-500">
            {novels.length === 0 ? "هنوز اثری در کتابخانه ثبت نشده است." : "جست‌وجو یا فیلترها را تغییر دهید."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleNovels.map((novel) => {
            const meta = statusMeta(novel);
            const StatusIcon = meta.icon;
            const manga = isMangaWork(novel);
            const chapters = publishedChapterCount(novel);
            const isPending = getNovelApprovalStatus(novel) === "pending_approval";
            const isRejected = getNovelApprovalStatus(novel) === "rejected";
            const confirmingDelete = deletingId === novel.id;

            return (
              <div
                key={novel.id}
                className={`rounded-2xl border p-3 transition-colors ${borderClass} ${cardClass} ${shadowClass} hover:border-purple-500/40`}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <SafeImage
                    src={novel.coverUrl || novel.cover}
                    alt={novel.title}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="h-20 w-14 shrink-0 rounded-xl border border-black/20 object-cover"
                  />

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[9px] font-black ${meta.className}`}>
                        <StatusIcon className="h-2.5 w-2.5" />
                        {meta.label}
                      </span>
                      {manga && (
                        <span className="rounded-lg border border-fuchsia-500/25 bg-fuchsia-500/10 px-2 py-0.5 text-[9px] font-black text-fuchsia-300">
                          مانگا
                        </span>
                      )}
                      {novel.originType === "translated" && (
                        <span className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[9px] font-black text-sky-300">
                          ترجمه
                        </span>
                      )}
                      {novel.genre && (
                        <span className="font-mono text-[10px] text-slate-500">{novel.genre}</span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenNovel?.(novel.id)}
                      disabled={!onOpenNovel}
                      className="block max-w-full truncate text-start text-sm font-black hover:text-purple-300 disabled:cursor-default disabled:hover:text-inherit"
                      title={novel.title}
                    >
                      {novel.title}
                    </button>

                    <p className="truncate text-[11px] text-slate-500">
                      نوشتهٔ <span className="font-bold text-violet-400">{novel.author}</span>
                      {novel.authorUsername && novel.authorUsername !== novel.author && (
                        <span className="font-mono text-slate-600"> · @{novel.authorUsername}</span>
                      )}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {chapters.toLocaleString("fa-IR")} {manga ? "فصل" : "فصل"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        {formatAverageViews(Number(novel.viewsCount || 0))}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3 w-3 text-amber-500" />
                        {Number(novel.rating || 0) > 0 ? Number(novel.rating).toLocaleString("fa-IR", { maximumFractionDigits: 1 }) : "—"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Heart className="h-3 w-3 text-rose-500" />
                        {Number(novel.likesCount || 0).toLocaleString("fa-IR")}
                      </span>
                      {!manga && Number(novel.wordsCount || 0) > 0 && (
                        <span>{Number(novel.wordsCount).toLocaleString("fa-IR")} واژه</span>
                      )}
                      <span className="truncate text-slate-600" dir="ltr" title={novel.id}>#{novel.id.slice(0, 10)}</span>
                    </div>

                    {novel.editorNote && (
                      <p className="line-clamp-2 rounded-lg bg-amber-500/5 px-2 py-1 text-[10px] text-amber-500/90">
                        یادداشت تحریریه: {novel.editorNote}
                      </p>
                    )}
                  </div>

                  {/* Actions. Moderation opens the note dialog; delete is the
                      only destructive action and asks twice. */}
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {(isPending || isRejected) && (
                      <button
                        type="button"
                        onClick={() => onApprove(novel.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-black text-white hover:bg-emerald-500"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> تأیید
                      </button>
                    )}
                    {!isRejected && (
                      <button
                        type="button"
                        onClick={() => onReject(novel.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-[11px] font-black text-rose-400 hover:bg-rose-500/15"
                      >
                        <XCircle className="h-3.5 w-3.5" /> رد / یادداشت
                      </button>
                    )}

                    {confirmingDelete ? (
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={async () => {
                            setDeletingId(null);
                            try {
                              await onDelete(novel.id);
                            } catch (error: any) {
                              window.alert(error?.message || "حذف رمان ممکن نشد.");
                            }
                          }}
                          className="rounded-xl bg-rose-600 px-3 py-2 text-[11px] font-black text-white hover:bg-rose-500"
                        >
                          حذف دائمی
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingId(null)}
                          className={`rounded-xl border px-3 py-2 text-[11px] font-bold ${borderClass} text-slate-400`}
                        >
                          انصراف
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeletingId(novel.id)}
                        className="rounded-xl border border-rose-500/15 bg-rose-500/5 p-2 text-rose-500 hover:bg-rose-500 hover:text-white"
                        title="حذف دائمی اثر و همهٔ سوابق آن"
                        aria-label={`حذف ${novel.title}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {confirmingDelete && (
                  <p className="mt-2 rounded-xl border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-[11px] font-bold text-rose-300">
                    «{novel.title}» و همهٔ فصل‌ها، دیدگاه‌ها، نشانک‌ها و پرونده‌های تصویری آن برای همیشه حذف می‌شود. این عمل قابل بازگشت نیست.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
