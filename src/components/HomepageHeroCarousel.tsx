import React, { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  Feather,
  Sparkles,
  Trophy,
} from "lucide-react";
import { api } from "../utils/api";
import SafeImage from "./SafeImage";
import { AUGUST_VIEWS_EVENT, type AugustViewsEventPhase } from "../../shared/augustViewsEvent";
import {
  type SiteEventBanner,
  type SiteEventBannerTheme,
  type SiteEventKind,
  type SiteEventPhase,
} from "../../shared/siteEvents";

/**
 * Gradient per banner theme, mirroring the admin preview so what an owner picks
 * in the panel is exactly what readers see here.
 */
const BANNER_THEME_GRADIENTS: Record<SiteEventBannerTheme, string> = {
  violet: "from-[#120721] via-[#28104a] to-[#4c1d66]",
  emerald: "from-[#04211a] via-[#0b4034] to-[#137a5f]",
  amber: "from-[#2a1705] via-[#6b3d09] to-[#b8781a]",
  rose: "from-[#2b0714] via-[#6d1436] to-[#a81d54]",
  sky: "from-[#04182b] via-[#0a3355] to-[#136ba1]",
  slate: "from-[#0b0f16] via-[#1c2532] to-[#35414f]",
};

interface FeaturedEvent {
  slug: string;
  title: string;
  description: string;
  kind: SiteEventKind;
  phase: SiteEventPhase;
  dateLabel: string;
  startsAt: string;
  endsAt: string;
  banner: SiteEventBanner;
}

interface HomepageHeroCarouselProps {
  theme: "light" | "dark";
  activeTheme: any;
  systemSettings?: any;
  onOpenWriter: () => void;
  onOpenEvent: () => void;
}

export default function HomepageHeroCarousel({
  theme,
  activeTheme,
  systemSettings,
  onOpenWriter,
  onOpenEvent,
}: HomepageHeroCarouselProps) {
  const [activeSlide, setActiveSlide] = useState(0);
  const [eventPhase, setEventPhase] = useState<AugustViewsEventPhase>("upcoming");
  const [leaderboardEnabled, setLeaderboardEnabled] = useState(false);
  const [rankedNovels, setRankedNovels] = useState(0);
  const [paused, setPaused] = useState(false);
  // The banner an owner featured in the admin panel. Null means none is
  // featured, in which case the carousel shows only the discovery slide.
  const [featured, setFeatured] = useState<FeaturedEvent | null>(null);
  const [featuredLoaded, setFeaturedLoaded] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    api.getFeaturedEventBanner()
      .then((event) => {
        if (!mounted) return;
        setFeatured(event && event.slug ? (event as FeaturedEvent) : null);
      })
      .catch(() => {
        if (mounted) setFeatured(null);
      })
      .finally(() => {
        if (mounted) setFeaturedLoaded(true);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    // Announcements and a homepage with no featured event do not need a live
    // leaderboard clock. Avoid polling an invisible feature forever.
    if (!featuredLoaded || !featured || featured.kind !== "views_leaderboard") return;
    let mounted = true;
    let boundaryTimer: number | undefined;
    const loadStatus = () => {
      api.getAugustViewsEvent(1, 3, true)
        .then((response) => {
          if (!mounted) return;
          setEventPhase(response?.event?.phase || "upcoming");
          setLeaderboardEnabled(Boolean(response?.event?.leaderboardEnabled));
          setRankedNovels(Number(response?.stats?.rankedNovels || 0));
          if (boundaryTimer !== undefined) window.clearTimeout(boundaryTimer);
          if (response?.event?.phase === "upcoming") {
            const millisecondsUntilStart = Date.parse(response.event.startsAt) - Date.parse(response.event.serverTime);
            if (millisecondsUntilStart > 0 && millisecondsUntilStart < 2_147_000_000) {
              boundaryTimer = window.setTimeout(loadStatus, millisecondsUntilStart + 100);
            }
          }
        })
        .catch(() => {
          if (mounted) setLeaderboardEnabled(false);
        });
    };
    const loadWhenVisible = () => {
      if (document.visibilityState === "visible") loadStatus();
    };
    loadStatus();
    const poll = window.setInterval(loadWhenVisible, 60_000);
    document.addEventListener("visibilitychange", loadWhenVisible);
    return () => {
      mounted = false;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", loadWhenVisible);
      if (boundaryTimer !== undefined) window.clearTimeout(boundaryTimer);
    };
  }, [featuredLoaded, featured?.slug, featured?.kind]);

  // The event slide is driven by whichever event an owner featured. A finished
  // leaderboard event with no ranked novels is a dead banner — it used to occupy
  // half the carousel and show an empty board — so it is retired rather than
  // rotated through.
  const featuredPhase: SiteEventPhase = featured?.phase || (eventPhase as SiteEventPhase);
  const isLeaderboardEvent = (featured?.kind || "views_leaderboard") === "views_leaderboard";
  const showEventSlide = featuredLoaded
    ? !!featured && (!isLeaderboardEvent || featuredPhase !== "completed" || rankedNovels > 0)
    : false;
  const slideCount = showEventSlide ? 2 : 1;
  const bannerTheme = featured?.banner.theme || "violet";
  const eventDateLabel = featured?.dateLabel || AUGUST_VIEWS_EVENT.dateLabel;

  useEffect(() => {
    if (activeSlide >= slideCount) setActiveSlide(0);
  }, [activeSlide, slideCount]);

  useEffect(() => {
    if (paused) return;
    if (slideCount < 2) return;
    const rotation = window.setInterval(() => setActiveSlide((slide) => (slide + 1) % slideCount), 9_000);
    return () => window.clearInterval(rotation);
  }, [paused, slideCount]);

  const changeSlide = (next: number) => setActiveSlide(((next % slideCount) + slideCount) % slideCount);
  const phaseLabel = featuredPhase === "active"
    ? "هم‌اکنون زنده"
    : featuredPhase === "completed"
      ? "نتایج نهایی"
      : eventDateLabel
        ? `از ${eventDateLabel} آغاز می‌شود`
        : "به‌زودی";
  // An announcement-only event has no leaderboard, so its button is always
  // active; a leaderboard event stays disabled until it opens.
  const eventCtaEnabled = !isLeaderboardEvent || leaderboardEnabled;
  const eventButtonLabel = featured?.banner.ctaLabel
    || (featuredPhase === "completed"
      ? "مشاهده نتایج نهایی"
      : eventCtaEnabled ? "مشاهده رویداد" : "هنوز آغاز نشده است");

  return (
    <section
      id="hero-banner"
      aria-roledescription="carousel"
      aria-label="برگزیده‌های رپتوک"
      className={`relative w-full overflow-hidden rounded-3xl border ${activeTheme.border} ${activeTheme.shadow}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }}
      onTouchEnd={(event) => {
        if (touchStartX.current === null) return;
        const distance = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
        if (Math.abs(distance) > 45) changeSlide(activeSlide + (distance < 0 ? 1 : -1));
        touchStartX.current = null;
      }}
    >
      <div
        dir="ltr"
        className="flex w-full items-stretch transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${activeSlide * 100}%)` }}
      >
        <article
          dir="rtl"
          aria-hidden={activeSlide !== 0}
          className={`relative min-h-[420px] w-full min-w-0 flex-[0_0_100%] overflow-hidden p-6 pb-14 sm:p-8 sm:pb-14 md:p-12 md:pb-14 ${systemSettings?.mainBannerImage ? "text-white" : ""} ${theme === "dark" ? "bg-gradient-to-br from-black via-[#0b0716] to-violet-950/30" : "bg-gradient-to-br from-amber-50/60 via-orange-50/20 to-white"}`}
        >
          {systemSettings?.mainBannerImage && (
            <>
              <SafeImage src={systemSettings.mainBannerImage} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full scale-105 object-cover opacity-30 blur-sm" />
              <SafeImage src={systemSettings.mainBannerImage} alt="تصویر بنر اصلی" className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-55" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-l from-slate-950/90 via-slate-950/75 to-slate-950/35" />
            </>
          )}
          {theme === "dark" && <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-violet-500/10 blur-[120px]" />}
          {theme === "dark" && <div className="pointer-events-none absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-purple-500/10 blur-[120px]" />}

          <div className="relative z-10 max-w-3xl space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1.5 font-mono text-xs font-medium text-violet-400">
              <Sparkles className="h-3.5 w-3.5 animate-pulse" />
              <span>شبکه مدرن خوانندگان و نویسندگان</span>
            </div>

            <h1 className="text-4xl font-black leading-tight tracking-tight md:text-6xl">
              {systemSettings?.mainBannerTitle || "رمان‌های شگفت‌انگیز را کشف کنید"}
              <span className="mt-2 block bg-gradient-to-r from-violet-600 via-violet-400 to-purple-300 bg-clip-text text-transparent">
                {systemSettings?.mainBannerSubtitle || "هر روز"}
              </span>
            </h1>

            <p className={`max-w-2xl text-base leading-relaxed md:text-lg ${systemSettings?.mainBannerImage ? "text-slate-200" : theme === "light" ? "text-stone-600" : "text-slate-400"}`}>
              {systemSettings?.mainBannerDescription || "به جامعه‌ای از خوانندگان و نویسندگان بپیوندید."}
              <span className="mt-1 block bg-gradient-to-r from-slate-400 to-slate-500 bg-clip-text font-medium text-transparent dark:from-slate-300 dark:to-slate-400">
                هزاران رمان، به‌روزرسانی روزانه، رایگان برای خواندن.
              </span>
            </p>

            <div className="flex flex-wrap gap-4 pt-2">
              <button
                id="start-writing-btn"
                onClick={onOpenWriter}
                className="flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-3 text-sm font-bold text-white shadow-md shadow-violet-500/20 transition-all duration-300 hover:-translate-y-1 hover:from-violet-500 hover:to-purple-500"
              >
                <Feather className="h-4 w-4" />
                <span>ساخت رمان جدید</span>
              </button>
              <a
                href="#novels-explore"
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-6 py-3 text-sm font-bold transition-all duration-300 hover:-translate-y-1 ${
                  theme === "dark"
                    ? "border-slate-800 bg-slate-900/60 text-slate-100 hover:bg-slate-800"
                    : "border-stone-200 bg-white text-stone-800 hover:bg-stone-50"
                }`}
              >
                <BookOpen className="h-4 w-4" />
                <span>مرور کتابخانه</span>
              </a>
            </div>
          </div>
        </article>

        {/* Event slide. Every string, the artwork and the colour come from the
            event an owner featured in the admin panel, so promoting a new event
            never needs a deployment. */}
        {showEventSlide && featured && (
        <article
          dir="rtl"
          aria-hidden={activeSlide !== 1}
          className={`relative min-h-[420px] w-full min-w-0 flex-[0_0_100%] overflow-hidden bg-gradient-to-br ${BANNER_THEME_GRADIENTS[bannerTheme]} p-6 pb-14 text-white sm:p-8 sm:pb-14 md:p-12 md:pb-14`}
        >
          {featured.banner.imageUrl && (
            <>
              <SafeImage src={featured.banner.imageUrl} alt="" aria-hidden="true" loading="lazy" decoding="async" className="pointer-events-none absolute inset-0 h-full w-full scale-105 object-cover opacity-25 blur-sm" />
              <SafeImage src={featured.banner.imageUrl} alt={featured.banner.alt || featured.title} loading="lazy" decoding="async" className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-50" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-l from-slate-950/80 via-slate-950/55 to-slate-950/20" />
            </>
          )}
          <div className="pointer-events-none absolute -right-24 -top-28 h-96 w-96 rounded-full bg-white/10 blur-[100px]" />
          <div className="pointer-events-none absolute -bottom-28 left-1/3 h-80 w-80 rounded-full bg-amber-300/15 blur-[100px]" />
          {!featured.banner.imageUrl && (
            <div className="pointer-events-none absolute right-8 top-8 hidden rotate-6 opacity-10 md:block">
              <Trophy className="h-52 w-52" strokeWidth={1.2} />
            </div>
          )}

          <div className="relative z-10 max-w-4xl space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 font-mono text-xs font-bold tracking-wide text-amber-200">
              <Trophy className="h-3.5 w-3.5" />
              <span>{phaseLabel}</span>
            </div>

            <div>
              <p className="mb-2 text-sm font-bold uppercase tracking-[0.2em] text-white/80">{featured.title}</p>
              <h2 className="max-w-3xl text-3xl font-black leading-tight tracking-tight sm:text-4xl md:text-5xl">
                {featured.banner.headline || featured.title}
              </h2>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-white/90">
              {eventDateLabel && (
                <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-amber-300" />{eventDateLabel}</span>
              )}
              <span className="inline-flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-amber-300" />
                {new Date(featured.startsAt).toLocaleDateString("fa-IR")} — {new Date(featured.endsAt).toLocaleDateString("fa-IR")}
              </span>
              {isLeaderboardEvent && (
                <span className="inline-flex items-center gap-2"><Eye className="h-4 w-4 text-amber-300" />فقط بازدیدهای دورهٔ رویداد</span>
              )}
            </div>

            {(featured.banner.subheadline || featured.description) && (
              <p className="max-w-2xl text-sm leading-relaxed text-white/85 md:text-base">
                {featured.banner.subheadline || featured.description}
              </p>
            )}

            {featured.banner.ctaHref ? (
              <a
                href={featured.banner.ctaHref}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-300 to-yellow-400 px-6 py-3 text-sm font-black text-slate-950 shadow-lg shadow-amber-500/20 transition-all hover:-translate-y-1 hover:from-amber-200 hover:to-yellow-300"
              >
                <Trophy className="h-4 w-4" />
                <span>{eventButtonLabel}</span>
              </a>
            ) : (
              <button
                type="button"
                disabled={!eventCtaEnabled}
                onClick={() => eventCtaEnabled && onOpenEvent()}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-300 to-yellow-400 px-6 py-3 text-sm font-black text-slate-950 shadow-lg shadow-amber-500/20 transition-all enabled:cursor-pointer enabled:hover:-translate-y-1 enabled:hover:from-amber-200 enabled:hover:to-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trophy className="h-4 w-4" />
                <span>{eventButtonLabel}</span>
              </button>
            )}
          </div>
        </article>
        )}
      </div>

      {slideCount > 1 && (
      <button
        type="button"
        onClick={() => changeSlide(activeSlide - 1)}
        aria-label="بنر قبلی"
        className="absolute left-2 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/20 bg-slate-950/45 p-2 text-white shadow-lg backdrop-blur transition hover:bg-slate-950/75 sm:left-4"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      )}
      {slideCount > 1 && (
      <button
        type="button"
        onClick={() => changeSlide(activeSlide + 1)}
        aria-label="بنر بعدی"
        className="absolute right-2 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/20 bg-slate-950/45 p-2 text-white shadow-lg backdrop-blur transition hover:bg-slate-950/75 sm:right-4"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
      )}

      {slideCount > 1 && <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-slate-950/45 px-2.5 py-1.5 backdrop-blur" role="tablist" aria-label="انتخاب بنر">
        {["کشف رپتوک", featured?.title || "رویداد"].slice(0, slideCount).map((label, index) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={activeSlide === index}
            aria-label={label}
            onClick={() => setActiveSlide(index)}
            className={`h-2.5 rounded-full transition-all ${activeSlide === index ? "w-7 bg-white" : "w-2.5 bg-white/45 hover:bg-white/70"}`}
          />
        ))}
      </div>}
    </section>
  );
}
