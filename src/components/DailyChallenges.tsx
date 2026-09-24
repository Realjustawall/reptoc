import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { api } from "../utils/api";
import {
  Target, Flame, Sparkles, Clock, Users, Send, CheckCircle2, Hourglass,
  XCircle, PenTool, RefreshCcw, Trophy, ChevronLeft, ChevronRight, Volume2
} from "lucide-react";

interface ActiveChallenge {
  id: string;
  title: string;
  promptText: string;
  /** Optional prompt illustration stored under /uploads. */
  imageUrl?: string;
  /** Optional narration clip stored under /uploads. */
  audioUrl?: string;
  challengeType: "continuation" | "story_naming";
  winnersAnnouncedAt?: string | null;
  createdAt: string;
}

interface ChallengeEntry {
  id: string;
  userId: string;
  username: string;
  content: string;
  moderationStatus: string;
  winnerRank?: number | null;
  createdAt: string;
}

interface ViewerEntry {
  id: string;
  moderationStatus: string;
}

const PAGE_SIZE = 10;

function statusBadge(status: string) {
  if (status === "approved") return { label: "منتشر شد", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 };
  if (status === "rejected") return { label: "رد شد", cls: "bg-rose-500/15 text-rose-400 border-rose-500/30", icon: XCircle };
  return { label: "در انتظار تأیید", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: Hourglass };
}

export default function DailyChallenges({
  theme,
  currentUser,
  onRequireLogin,
}: {
  theme: "light" | "dark";
  currentUser: any | null;
  onRequireLogin: () => void;
}) {
  const isDark = theme === "dark";
  const cardCls = isDark ? "bg-[#0b0716]/90 border-violet-950/40" : "bg-white border-stone-200/70";

  const [challenge, setChallenge] = useState<ActiveChallenge | null>(null);
  const [entries, setEntries] = useState<ChallengeEntry[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [submissionCount, setSubmissionCount] = useState(0);
  const [viewerEntry, setViewerEntry] = useState<ViewerEntry | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState("");

  const load = useCallback(async (targetPage: number, showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await api.getActiveChallenge(targetPage, PAGE_SIZE);
      setChallenge(data.challenge || null);
      setEntries(data.entries || []);
      setTotalEntries(data.pagination?.total || 0);
      setSubmissionCount(data.submissionCount ?? data.pagination?.total ?? 0);
      setViewerEntry(data.viewerEntry || null);
      setError("");
    } catch (err: any) {
      setError(err?.message || "بارگذاری چالش ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page);
    const interval = window.setInterval(() => load(page, false), 30_000);
    return () => window.clearInterval(interval);
  }, [load, page]);

  useEffect(() => {
    if (!currentUser) setDraft("");
  }, [currentUser]);

  const submitEntry = async () => {
    if (!challenge) return;
    const content = draft.trim();
    const minimumLength = challenge.challengeType === "story_naming" ? 2 : 10;
    if (content.length < minimumLength) {
      setFlash(challenge.challengeType === "story_naming" ? "نام پیشنهادی باید حداقل ۲ کاراکتر باشد." : "ادامهٔ نوشته باید حداقل ۱۰ کاراکتر باشد.");
      return;
    }
    setSubmitting(true);
    setFlash("");
    try {
      const result = await api.submitChallengeEntry(challenge.id, content);
      setFlash(result?.message || "شرکت شما ثبت شد.");
      setDraft("");
      await load(1, false);
      setPage(1);
    } catch (err: any) {
      setFlash(err?.message || "ثبت مشارکت ناموفق بود.");
    } finally {
      setSubmitting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalEntries / PAGE_SIZE));
  const alreadyJoined = !!viewerEntry;
  const isNamingChallenge = challenge?.challengeType === "story_naming";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-3 sm:px-0">
      {/* Hero */}
      <motion.header
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className={`relative overflow-hidden rounded-3xl border p-6 sm:p-8 ${cardCls} ${isDark ? "shadow-[0_20px_60px_-25px_rgba(124,58,237,0.45)]" : "shadow-sm"}`}
      >
        <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -right-10 h-52 w-52 rounded-full bg-fuchsia-600/15 blur-3xl" />
        <div className="relative space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1 text-[11px] font-black text-white shadow-lg shadow-violet-600/30">
              <Target className="h-3.5 w-3.5" /> چالش روزانهٔ رپتوک
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-bold text-amber-400">
              <Flame className="h-3.5 w-3.5" /> {isNamingChallenge ? "برای تصویر نام انتخاب کن" : "متن را ادامه بده"}
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight sm:text-4xl">
            {challenge ? challenge.title : "چالش روزانه"}
          </h1>
          <p className={`max-w-2xl text-xs leading-relaxed ${isDark ? "text-slate-400" : "text-stone-600"}`}>
            {isNamingChallenge
              ? "تصویر را ببین و بهترین نامی را که برای داستان آن به ذهنت می‌رسد پیشنهاد بده. مدیر می‌تواند تا سه نام برتر را انتخاب و اعلام کند."
              : "هر چالش یک متن آغازین دارد؛ آن را بخوان، داستان را در ذهنت ادامه بده و ادامهٔ خودت را بنویس. بهترین ادامه‌ها پس از تأیید مدیر نمایش داده می‌شوند."}
          </p>
        </div>
      </motion.header>

      {loading && !challenge ? (
        <div className={`rounded-3xl border p-12 text-center text-xs italic ${cardCls} ${isDark ? "text-slate-500" : "text-stone-500"}`}>
          در حال بارگذاری چالش...
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-rose-500/25 bg-rose-500/10 p-5 text-center text-xs text-rose-400">{error}</div>
      ) : !challenge ? (
        <div className={`rounded-3xl border p-12 text-center ${cardCls}`}>
          <Sparkles className="mx-auto h-10 w-10 text-violet-500/60" />
          <p className="mt-3 text-sm font-bold">فعلاً چالش فعالی وجود ندارد</p>
          <p className={`mt-1 text-xs ${isDark ? "text-slate-500" : "text-stone-500"}`}>چالش بعدی به‌زودی از سوی تیم رپتوک منتشر می‌شود.</p>
        </div>
      ) : (
        <>
          {/* Prompt card. The prompt may be text, a picture, a narration clip,
              or any combination an admin published. */}
          <section className={`relative overflow-hidden rounded-3xl border p-5 sm:p-7 ${cardCls}`}>
            {challenge.promptText ? <QuoteMark /> : null}
            {challenge.promptText && (
              <p className="whitespace-pre-wrap text-base font-extrabold leading-loose sm:text-lg" dir="rtl">
                {challenge.promptText}
              </p>
            )}

            {challenge.imageUrl && (
              <figure className={challenge.promptText ? "mt-4" : ""}>
                <img
                  src={challenge.imageUrl}
                  alt={`تصویر چالش: ${challenge.title}`}
                  loading="lazy"
                  decoding="async"
                  className="max-h-[420px] w-full rounded-2xl border border-violet-500/20 object-contain"
                />
              </figure>
            )}

            {challenge.audioUrl && (
              <div className={`${challenge.promptText || challenge.imageUrl ? "mt-4" : ""} rounded-2xl border p-3 ${isDark ? "border-emerald-500/25 bg-emerald-500/5" : "border-emerald-500/30 bg-emerald-50"}`}>
                <span className="mb-2 flex items-center gap-1.5 text-[11px] font-black text-emerald-500">
                  <Volume2 className="h-3.5 w-3.5" /> روایت صوتی چالش
                </span>
                {/* `preload="none"` keeps the page light: the clip is fetched
                    only when a reader presses play. */}
                <audio controls preload="none" src={challenge.audioUrl} className="w-full">
                  مرورگر شما پخش صدا را پشتیبانی نمی‌کند.
                </audio>
              </div>
            )}
            <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 ${isDark ? "border-violet-950/40" : "border-stone-200"}`}>
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono ${isDark ? "text-slate-500" : "text-stone-500"}`}>
                <Clock className="h-3.5 w-3.5" />
                {new Date(challenge.createdAt).toLocaleDateString("fa-IR", { weekday: "long", day: "numeric", month: "long" })}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-3 py-1 text-[11px] font-bold text-violet-400">
                <Users className="h-3.5 w-3.5" />
                {submissionCount.toLocaleString("fa-IR")} شرکت‌کننده
              </span>
            </div>
          </section>

          {/* Submit */}
          {!currentUser ? (
            <button
              onClick={onRequireLogin}
              className={`flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-xs font-bold transition-colors cursor-pointer ${
                isDark ? "border-violet-800/50 text-slate-400 hover:border-violet-500 hover:text-violet-300" : "border-stone-300 text-stone-500 hover:border-violet-400 hover:text-violet-500"
              }`}
            >
              <PenTool className="h-4 w-4" />
              {isNamingChallenge ? "برای پیشنهاد نام داستان وارد حساب خود شوید" : "برای نوشتن ادامهٔ داستان وارد حساب خود شوید"}
            </button>
          ) : alreadyJoined ? (
            (() => {
              const badge = statusBadge(viewerEntry!.moderationStatus);
              const BadgeIcon = badge.icon;
              return (
                <div className={`flex items-center justify-between gap-3 rounded-2xl border p-4 ${badge.cls}`}>
                  <span className="inline-flex items-center gap-2 text-xs font-bold">
                    <BadgeIcon className="h-4 w-4" />
                    {viewerEntry!.moderationStatus === "pending"
                      ? (isNamingChallenge ? "نام پیشنهادی شما ثبت شده و در انتظار بررسی مدیر است." : "متن شما ثبت شده و در انتظار تأیید مدیر است.")
                      : viewerEntry!.moderationStatus === "approved"
                        ? (isNamingChallenge
                            ? (challenge.winnersAnnouncedAt ? "نتیجه اعلام شده است؛ برندگان را پایین صفحه ببینید." : "نام شما تأیید شده و در مرحلهٔ انتخاب برندگان است.")
                            : "ادامهٔ شما تأیید شد و اکنون برای همه قابل مشاهده است.")
                        : (isNamingChallenge ? "نام پیشنهادی شما این بار پذیرفته نشد." : "متن شما این بار پذیرفته نشد؛ در چالش بعدی دوباره تلاش کن.")}
                  </span>
                </div>
              );
            })()
          ) : (
            <section className={`rounded-3xl border p-5 ${cardCls} space-y-3`}>
              <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-violet-400">
                <PenTool className="h-4 w-4" /> {isNamingChallenge ? "نام پیشنهادی داستان" : "ادامهٔ داستان را بنویس"}
              </label>
              {isNamingChallenge ? (
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.replace(/[\r\n]+/g, " "))}
                  maxLength={140}
                  placeholder="مثلاً: آخرین فانوس شهر"
                  className={`w-full rounded-2xl border p-4 text-sm font-bold outline-none transition-colors focus:border-violet-500 ${isDark ? "border-violet-950/50 bg-black/30" : "border-stone-200 bg-stone-50"}`}
                />
              ) : (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={2000}
                  rows={5}
                  placeholder="قلم را بردار و داستان را جلو ببر..."
                  className={`w-full resize-y rounded-2xl border p-4 text-sm leading-relaxed outline-none transition-colors focus:border-violet-500 ${
                    isDark ? "border-violet-950/50 bg-black/30" : "border-stone-200 bg-stone-50"
                  }`}
                />
              )}
              <div className="flex items-center justify-between">
                <span className={`font-mono text-[10px] ${isDark ? "text-slate-600" : "text-stone-400"}`}>{draft.length}/{isNamingChallenge ? 140 : 2000}</span>
                <button
                  onClick={submitEntry}
                  disabled={submitting || draft.trim().length < (isNamingChallenge ? 2 : 10)}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-black text-white shadow-lg shadow-violet-600/25 transition-all hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                  {submitting ? "در حال ارسال..." : isNamingChallenge ? "ثبت نام پیشنهادی" : "ارسال برای تأیید"}
                </button>
              </div>
              {flash && <p className="text-[11px] font-bold text-amber-400">{flash}</p>}
              <p className={`text-[10px] ${isDark ? "text-slate-600" : "text-stone-400"}`}>
                {isNamingChallenge
                  ? "هر کاربر فقط یک نام می‌تواند پیشنهاد بدهد. نام‌ها تا زمان اعلام نتیجه عمومی نمی‌شوند."
                  : "مشارکت‌ها پیش از نمایش، توسط تیم بررسی می‌شوند؛ هر کاربر در هر چالش فقط یک بار می‌تواند شرکت کند."}
              </p>
            </section>
          )}

          {/* Feed */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-black">
                <Trophy className="h-4 w-4 text-amber-400" /> {isNamingChallenge ? "نام‌های برتر" : "ادامه‌های منتشرشده"}
              </h2>
              <button onClick={() => load(page)} className="cursor-pointer rounded-lg p-1.5 text-violet-400 hover:bg-violet-500/10" title="به‌روزرسانی">
                <RefreshCcw className={`h-4 w-4 ${(loading && challenge) ? "animate-spin" : ""}`} />
              </button>
            </div>

            <AnimatePresence mode="popLayout">
              {entries.length === 0 ? (
                <div className={`rounded-2xl border p-10 text-center text-xs italic ${cardCls} ${isDark ? "text-slate-500" : "text-stone-500"}`}>
                  {isNamingChallenge
                    ? (challenge.winnersAnnouncedAt ? "برای این چالش برنده‌ای اعلام نشده است." : "نتیجه هنوز اعلام نشده است؛ پیشنهادها تا آن زمان محرمانه می‌مانند.")
                    : "هنوز ادامه‌ای منتشر نشده؛ اولین نفر باش!"}
                </div>
              ) : (
                entries.map((entry, index) => (
                  <motion.article
                    key={entry.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.3) }}
                    className={`rounded-2xl border p-4 ${cardCls}`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-[11px] font-black text-white">
                          {(entry.username || "?").slice(0, 1).toUpperCase()}
                        </span>
                        <span className="truncate font-mono text-xs font-bold text-violet-400">@{entry.username}</span>
                      </span>
                      <span className={`shrink-0 font-mono text-[10px] ${isDark ? "text-slate-600" : "text-stone-400"}`}>
                        {isNamingChallenge && entry.winnerRank ? `رتبهٔ ${entry.winnerRank.toLocaleString("fa-IR")}` : new Date(entry.createdAt).toLocaleString("fa-IR")}
                      </span>
                    </div>
                    <p className={`whitespace-pre-wrap leading-relaxed ${isNamingChallenge ? "text-lg font-black text-amber-400" : "text-xs"}`} dir="rtl">{entry.content}</p>
                  </motion.article>
                ))
              )}
            </AnimatePresence>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="cursor-pointer rounded-xl border border-violet-500/25 p-2 text-violet-400 disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <span className="font-mono text-xs text-slate-400">{page.toLocaleString("fa-IR")} از {totalPages.toLocaleString("fa-IR")}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="cursor-pointer rounded-xl border border-violet-500/25 p-2 text-violet-400 disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function QuoteMark() {
  return (
    <svg className="pointer-events-none absolute left-5 top-4 h-10 w-10 text-violet-500/20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.983 3v7.391c0 5.704-3.731 9.57-8.983 10.609l-.995-2.151c2.432-.917 3.995-3.638 3.995-5.849h-4v-10h9.983zm14.017 0v7.391c0 5.704-3.748 9.571-9 10.609l-.996-2.151c2.433-.917 3.996-3.638 3.996-5.849h-3.983v-10h9.983z" />
    </svg>
  );
}
