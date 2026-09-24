import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Crown,
  Eye,
  Medal,
  RefreshCw,
  ShieldX,
  Trophy,
} from "lucide-react";
import { motion } from "motion/react";
import { api } from "../utils/api";
import type { AugustViewsEventRanking, AugustViewsEventResponse } from "../../shared/augustViewsEvent";
import SafeImage from "./SafeImage";

interface EventStatusProps {
  theme: "light" | "dark";
  onBack: () => void;
  onSelectNovel: (novelId: string) => void;
}

const PAGE_SIZE = 12;

function phaseDetails(phase?: string) {
  if (phase === "active") return { label: "در جریان", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" };
  if (phase === "completed") return { label: "پایان‌یافته", className: "border-violet-400/30 bg-violet-400/10 text-violet-300" };
  return { label: "از 1 اوت آغاز می‌شود", className: "border-amber-400/30 bg-amber-400/10 text-amber-300" };
}

function TopNovelCard({ entry, onSelectNovel }: { key?: React.Key; entry: AugustViewsEventRanking; onSelectNovel: (novelId: string) => void }) {
  const styles = entry.rank === 1
    ? { ring: "border-amber-300/50 bg-gradient-to-b from-amber-300/15 to-transparent", icon: "text-amber-300", label: "مقام اول" }
    : entry.rank === 2
      ? { ring: "border-slate-300/35 bg-gradient-to-b from-slate-300/10 to-transparent", icon: "text-slate-300", label: "مقام دوم" }
      : { ring: "border-orange-400/35 bg-gradient-to-b from-orange-400/10 to-transparent", icon: "text-orange-300", label: "مقام سوم" };

  return (
    <button
      type="button"
      onClick={() => onSelectNovel(entry.novelId)}
      className={`group relative min-w-0 rounded-3xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-xl ${styles.ring} ${entry.rank === 1 ? "md:-translate-y-3 md:hover:-translate-y-4" : ""}`}
    >
      <div className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-slate-950/70 text-sm font-black text-white shadow-lg backdrop-blur">
        {entry.rank === 1 ? <Crown className={`h-5 w-5 ${styles.icon}`} /> : <Medal className={`h-5 w-5 ${styles.icon}`} />}
      </div>
      <div className="aspect-[3/4] overflow-hidden rounded-2xl bg-slate-800">
        <SafeImage src={entry.coverUrl} alt={`جلد ${entry.title}`} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
      </div>
      <div className="mt-4 min-w-0">
        <div className={`text-xs font-black uppercase tracking-[0.18em] ${styles.icon}`}>{styles.label}</div>
        <h3 className="mt-1 truncate text-lg font-black">{entry.title}</h3>
        <p className="truncate text-sm opacity-65">نویسنده: {entry.author}</p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-slate-950/55 px-3 py-1.5 text-sm font-black text-white">
          <Eye className="h-4 w-4 text-fuchsia-300" />
          {entry.eventViews.toLocaleString()} بازدید
        </div>
      </div>
    </button>
  );
}

export default function EventStatus({ theme, onBack, onSelectNovel }: EventStatusProps) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AugustViewsEventResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const isDark = theme === "dark";

  useEffect(() => {
    let mounted = true;
    const load = (showLoader: boolean) => {
      if (showLoader) setLoading(true);
      api.getAugustViewsEvent(page, PAGE_SIZE)
        .then((response) => {
          if (!mounted) return;
          setData(response);
          setError("");
        })
        .catch((requestError) => {
          if (mounted) setError(requestError instanceof Error ? requestError.message : "بارگذاری رویداد ناموفق بود.");
        })
        .finally(() => {
          if (mounted) setLoading(false);
        });
    };
    load(true);
    const refresh = window.setInterval(() => load(false), 15_000);
    return () => {
      mounted = false;
      window.clearInterval(refresh);
    };
  }, [page]);

  const phase = phaseDetails(data?.event.phase);
  const leaderboardEnabled = Boolean(data?.event.leaderboardEnabled);
  const totalPages = data?.pagination.totalPages || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      className={`mx-auto w-full max-w-6xl pb-16 ${isDark ? "text-slate-100" : "text-slate-900"}`}
    >
      <button
        type="button"
        onClick={onBack}
        className={`mb-5 inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition ${isDark ? "border-slate-800 bg-slate-900 hover:bg-slate-800" : "border-slate-200 bg-white hover:bg-slate-50"}`}
      >
        <ArrowLeft className="h-4 w-4" /> بازگشت به خانه
      </button>

      <header className="relative overflow-hidden rounded-[2rem] border border-fuchsia-400/20 bg-gradient-to-br from-[#120721] via-[#28104a] to-[#4c1d66] p-6 text-white shadow-2xl shadow-fuchsia-950/20 sm:p-9">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-fuchsia-400/20 blur-[90px]" />
        <div className="pointer-events-none absolute -bottom-24 left-1/4 h-64 w-64 rounded-full bg-amber-300/10 blur-[80px]" />
        <div className="relative z-10 max-w-4xl">
          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-widest ${phase.className}`}>
            <Trophy className="h-3.5 w-3.5" /> {phase.label}
          </div>
          <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">رویداد بازدیدهای اوت رپتوک 2026</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-purple-100 sm:text-base">
            هر رمان واجد شرایط به‌طور خودکار شرکت می‌کند. رمان‌هایی که در طول اوت بیشترین بازدید مجاز را کسب کنند، صدرنشین می‌شوند.
          </p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-purple-100">
            <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-amber-300" />1 تا 31 اوت 2026</span>
            <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4 text-amber-300" />از 1 اوت ساعت 00:00 تا 31 اوت ساعت 23:59 به وقت UTC</span>
          </div>
        </div>
      </header>

      {error && (
        <div className={`mt-6 flex items-center gap-3 rounded-2xl border p-4 ${isDark ? "border-red-400/20 bg-red-400/10 text-red-200" : "border-red-200 bg-red-50 text-red-700"}`}>
          <RefreshCw className="h-5 w-5 shrink-0" />
          <p className="text-sm font-semibold">{error}</p>
        </div>
      )}

      {loading && !data ? (
        <div className={`mt-6 flex min-h-72 items-center justify-center rounded-3xl border ${isDark ? "border-slate-800 bg-slate-900/60" : "border-slate-200 bg-white"}`}>
          <RefreshCw className="h-7 w-7 animate-spin text-fuchsia-500" />
        </div>
      ) : !leaderboardEnabled ? (
        <section className={`mt-6 rounded-3xl border p-8 text-center ${isDark ? "border-amber-300/20 bg-amber-300/5" : "border-amber-200 bg-amber-50"}`}>
          <Clock3 className="mx-auto h-12 w-12 text-amber-400" />
          <h2 className="mt-4 text-2xl font-black">جدول امتیازها از 1 اوت باز می‌شود</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm opacity-70">
            نتایج و رتبه‌بندی رویداد از لحظه آغاز رویداد در ساعت 00:00 UTC در دسترس قرار می‌گیرند.
          </p>
        </section>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { label: "رمان‌های واجد شرایط", value: data?.stats.eligibleNovels || 0, icon: BookOpen },
              { label: "رمان‌های دارای بازدید", value: data?.stats.rankedNovels || 0, icon: Trophy },
              { label: "بازدیدهای مجاز", value: data?.stats.eligibleViews || 0, icon: Eye },
            ].map((stat) => (
              <div key={stat.label} className={`rounded-2xl border p-5 ${isDark ? "border-slate-800 bg-slate-900/70" : "border-slate-200 bg-white shadow-sm"}`}>
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-fuchsia-500/10 p-2.5 text-fuchsia-400"><stat.icon className="h-5 w-5" /></div>
                  <div><div className="text-2xl font-black tabular-nums">{stat.value.toLocaleString()}</div><div className="text-xs font-bold uppercase tracking-wider opacity-55">{stat.label}</div></div>
                </div>
              </div>
            ))}
          </section>

          <section className="mt-10">
            <div className="mb-7 text-center">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-fuchsia-400">داستان‌های پیشتاز</p>
              <h2 className="mt-2 text-3xl font-black">سه برتر</h2>
            </div>
            {data?.topThree.length ? (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 md:items-start">
                {data.topThree.map((entry) => <TopNovelCard key={entry.novelId} entry={entry} onSelectNovel={onSelectNovel} />)}
              </div>
            ) : (
              <div className={`rounded-3xl border p-8 text-center ${isDark ? "border-slate-800 bg-slate-900/60" : "border-slate-200 bg-white"}`}>
                <Trophy className="mx-auto h-10 w-10 text-fuchsia-400" />
                <h3 className="mt-3 text-lg font-black">مسابقه آماده است</h3>
                <p className="mt-1 text-sm opacity-60">جایگاه‌های جدول امتیازها با رسیدن بازدیدهای مجاز رویداد نمایش داده می‌شوند.</p>
              </div>
            )}
          </section>

          <section className="mt-10">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-fuchsia-400">جدول کامل امتیازها</p>
                <h2 className="mt-1 text-2xl font-black">سایر رقبا</h2>
              </div>
              {totalPages > 0 && <span className="text-xs font-semibold opacity-55">صفحه {page} از {totalPages}</span>}
            </div>

            <div className={`overflow-hidden rounded-3xl border ${isDark ? "border-slate-800 bg-slate-900/65" : "border-slate-200 bg-white shadow-sm"}`}>
              {data?.rankings.length ? data.rankings.map((entry) => (
                <button
                  key={entry.novelId}
                  type="button"
                  onClick={() => onSelectNovel(entry.novelId)}
                  className={`flex w-full items-center gap-4 border-b p-4 text-left transition last:border-b-0 ${isDark ? "border-slate-800 hover:bg-slate-800/70" : "border-slate-100 hover:bg-slate-50"}`}
                >
                  <span className="w-9 shrink-0 text-center text-lg font-black text-fuchsia-400">#{entry.rank}</span>
                  <SafeImage src={entry.coverUrl} alt={`جلد ${entry.title}`} className="h-16 w-12 shrink-0 rounded-lg object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-black">{entry.title}</span>
                    <span className="block truncate text-sm opacity-55">نویسنده: {entry.author}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-black tabular-nums"><Eye className="h-4 w-4 text-fuchsia-400" />{entry.eventViews.toLocaleString()}</span>
                </button>
              )) : (
                <div className="p-8 text-center text-sm opacity-60">رمان‌های رتبه‌دار دیگر اینجا نمایش داده می‌شوند.</div>
              )}
            </div>

            {totalPages > 1 && (
              <div className="mt-5 flex items-center justify-center gap-3">
                <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className={`rounded-xl border p-2.5 transition disabled:cursor-not-allowed disabled:opacity-35 ${isDark ? "border-slate-800 bg-slate-900 hover:bg-slate-800" : "border-slate-200 bg-white hover:bg-slate-50"}`} aria-label="صفحه قبلی جدول امتیازها"><ChevronLeft className="h-5 w-5" /></button>
                <span className="min-w-24 text-center text-sm font-bold">{page} / {totalPages}</span>
                <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className={`rounded-xl border p-2.5 transition disabled:cursor-not-allowed disabled:opacity-35 ${isDark ? "border-slate-800 bg-slate-900 hover:bg-slate-800" : "border-slate-200 bg-white hover:bg-slate-50"}`} aria-label="صفحه بعدی جدول امتیازها"><ChevronRight className="h-5 w-5" /></button>
              </div>
            )}
          </section>
        </>
      )}

      <section className={`mt-10 rounded-3xl border p-6 sm:p-8 ${isDark ? "border-slate-800 bg-slate-900/65" : "border-slate-200 bg-white shadow-sm"}`}>
        <h2 className="flex items-center gap-2 text-xl font-black"><ShieldX className="h-5 w-5 text-fuchsia-400" />قوانین رویداد</h2>
        <div className="mt-4 grid gap-3 text-sm leading-relaxed opacity-75 sm:grid-cols-2">
          <p>همه رمان‌های تأییدشده به‌طور خودکار شرکت می‌کنند. رتبه‌بندی فقط شامل بازدیدهایی است که در بازه رویداد به دست آمده‌اند.</p>
          <p>بازدیدهای پیش از 1 اوت محاسبه نمی‌شوند. رمان‌های منتشرشده توسط تیم رپتوک واجد شرایط نیستند.</p>
        </div>
        <p className="mt-4 text-xs font-semibold opacity-55">حساب‌های مستثنی تیم: The_BestX، The_Lite و Abyss kid.</p>
      </section>
    </motion.div>
  );
}
