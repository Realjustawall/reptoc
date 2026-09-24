import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Calendar, Check, ImagePlus, Loader2, Pencil, Pin, Plus,
  RefreshCw, Star, Trash2, Trophy, X,
} from "lucide-react";
import { api } from "../../utils/api";
import { uploadImageBlob } from "../../utils/imageUpload";
import SafeImage from "../SafeImage";
import {
  DEFAULT_SITE_EVENT_BANNER,
  SITE_EVENT_BANNER_THEMES,
  SITE_EVENT_LIMITS,
  isSafeSiteEventUrl,
  normalizeExcludedAuthorNames,
  normalizeSiteEventSlug,
  validateSiteEventInput,
  type SiteEvent,
  type SiteEventBannerTheme,
  type SiteEventKind,
  type SiteEventStatus,
} from "../../../shared/siteEvents";

/**
 * Event manager.
 *
 * Events used to be a constant in the source, so an owner had to ship a
 * deployment to run one. This panel owns their whole life cycle — create, edit,
 * feature on the home page, archive, delete — including the banner artwork and
 * its copy, which are stored with the event rather than in a separate settings
 * blob.
 *
 * Validation is the shared `validateSiteEventInput`, the same function the API
 * runs, so the form can never accept something the server will reject.
 */

export interface EventManagerProps {
  theme: "light" | "dark";
  /** Tailwind classes for inputs, taken from the surrounding admin surface. */
  controlClass: string;
  borderClass: string;
  cardClass: string;
}

interface DraftEvent {
  id?: string;
  slug: string;
  title: string;
  description: string;
  kind: SiteEventKind;
  status: SiteEventStatus;
  /** `datetime-local` value (no timezone), converted on save. */
  startsAt: string;
  endsAt: string;
  dateLabel: string;
  timezoneLabel: string;
  bannerImageUrl: string;
  bannerAlt: string;
  bannerHeadline: string;
  bannerSubheadline: string;
  bannerCtaLabel: string;
  bannerCtaHref: string;
  bannerTheme: SiteEventBannerTheme;
  isFeatured: boolean;
  excludedAuthors: string;
}

const BANNER_THEME_CLASSES: Record<SiteEventBannerTheme, string> = {
  violet: "from-violet-600 to-purple-700",
  emerald: "from-emerald-600 to-teal-700",
  amber: "from-amber-500 to-orange-600",
  rose: "from-rose-600 to-pink-700",
  sky: "from-sky-600 to-blue-700",
  slate: "from-slate-700 to-slate-900",
};

const STATUS_LABELS: Record<SiteEventStatus, string> = {
  draft: "پیش‌نویس",
  published: "منتشرشده",
  archived: "بایگانی",
};

const PHASE_LABELS: Record<string, string> = {
  upcoming: "هنوز آغاز نشده",
  active: "در جریان",
  completed: "پایان‌یافته",
};

/** ISO instant → the `datetime-local` value the browser expects. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function emptyDraft(): DraftEvent {
  const now = new Date();
  const inAMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    slug: "",
    title: "",
    description: "",
    kind: "views_leaderboard",
    status: "draft",
    startsAt: toLocalInput(now.toISOString()),
    endsAt: toLocalInput(inAMonth.toISOString()),
    dateLabel: "",
    timezoneLabel: "UTC",
    bannerImageUrl: "",
    bannerAlt: "",
    bannerHeadline: "",
    bannerSubheadline: "",
    bannerCtaLabel: "",
    bannerCtaHref: "",
    bannerTheme: "violet",
    isFeatured: false,
    excludedAuthors: "",
  };
}

function draftFromEvent(event: SiteEvent): DraftEvent {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    kind: event.kind,
    status: event.status,
    startsAt: toLocalInput(event.startsAt),
    endsAt: toLocalInput(event.endsAt),
    dateLabel: event.dateLabel,
    timezoneLabel: event.timezoneLabel,
    bannerImageUrl: event.banner.imageUrl,
    bannerAlt: event.banner.alt,
    bannerHeadline: event.banner.headline,
    bannerSubheadline: event.banner.subheadline,
    bannerCtaLabel: event.banner.ctaLabel,
    bannerCtaHref: event.banner.ctaHref,
    bannerTheme: event.banner.theme,
    isFeatured: event.isFeatured,
    excludedAuthors: event.excludedAuthorNames.join("، "),
  };
}

/** Draft → the payload shape the API and the shared validator expect. */
function draftToPayload(draft: DraftEvent) {
  const toIso = (value: string) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
  };
  return {
    slug: draft.slug || draft.title,
    title: draft.title,
    description: draft.description,
    kind: draft.kind,
    status: draft.status,
    startsAt: toIso(draft.startsAt),
    endsAt: toIso(draft.endsAt),
    dateLabel: draft.dateLabel,
    timezoneLabel: draft.timezoneLabel,
    banner: {
      imageUrl: draft.bannerImageUrl,
      alt: draft.bannerAlt,
      headline: draft.bannerHeadline,
      subheadline: draft.bannerSubheadline,
      ctaLabel: draft.bannerCtaLabel,
      ctaHref: draft.bannerCtaHref,
      theme: draft.bannerTheme,
    },
    isFeatured: draft.isFeatured,
    excludedAuthorNames: normalizeExcludedAuthorNames(draft.excludedAuthors),
  };
}

export default function EventManager({ theme, controlClass, borderClass, cardClass }: EventManagerProps) {
  const isDark = theme === "dark";
  const [events, setEvents] = useState<SiteEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; message: string } | null>(null);
  const [invalidField, setInvalidField] = useState<string>("");
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const announce = useCallback((message: string, tone: "info" | "error" = "info") => {
    setNotice({ tone, message });
  }, []);

  const reload = useCallback(async () => {
    const token = api.getToken();
    if (!token) return;
    setLoading(true);
    try {
      setEvents(await api.getAllSiteEvents(token));
    } catch (error: any) {
      announce(error?.message || "بارگذاری رویدادها ناموفق بود.", "error");
    } finally {
      setLoading(false);
    }
  }, [announce]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Live validation preview.
   *
   * The same validator the server runs, so the disabled state of the save button
   * and the server's answer can never disagree.
   */
  const validation = useMemo(
    () => (draft ? validateSiteEventInput(draftToPayload(draft), { existingId: draft.id }) : null),
    [draft],
  );

  const update = (changes: Partial<DraftEvent>) => {
    setInvalidField("");
    setDraft((current) => (current ? { ...current, ...changes } : current));
  };

  const uploadBanner = async (file: File) => {
    if (!/^image\/(jpeg|png|webp|avif|gif)$/.test(file.type)) {
      announce("بنر باید تصویری با قالب JPEG، PNG، WebP، AVIF یا GIF باشد.", "error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      announce("حجم بنر باید کمتر از ۵ مگابایت باشد.", "error");
      return;
    }
    setUploadingBanner(true);
    try {
      const body = await uploadImageBlob(file, {
        fileName: file.name || "banner.jpg",
        csrfToken: api.getToken(),
        // Public, so every visitor can load the home-page banner.
        fields: { visibility: "public" },
      });
      const url = String(body.url || "").trim();
      if (!url) throw new Error("بارگذاری بنر بدون نشانی قابل استفاده پایان یافت.");
      update({ bannerImageUrl: url });
      announce("تصویر بنر بارگذاری شد.");
    } catch (error: any) {
      announce(error?.message || "بارگذاری بنر ناموفق بود.", "error");
    } finally {
      setUploadingBanner(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    const token = api.getToken();
    if (!token) {
      announce("نشست شما منقضی شده است؛ دوباره وارد شوید.", "error");
      return;
    }
    if (validation?.error) {
      setInvalidField(validation.error.field);
      announce(validation.error.message, "error");
      return;
    }

    setSaving(true);
    try {
      const saved = await api.saveSiteEvent(token, draftToPayload(draft), draft.id);
      announce(draft.id ? "رویداد به‌روزرسانی شد." : "رویداد ساخته شد.");
      setDraft(null);
      setEvents((current) => {
        const others = current.filter((item) => item.id !== saved.id);
        // Featuring is exclusive on the server, so mirror that locally instead of
        // waiting for the refetch and briefly showing two featured banners.
        const cleaned = saved.isFeatured ? others.map((item) => ({ ...item, isFeatured: false })) : others;
        return [saved, ...cleaned].sort((left, right) => (
          Number(right.isFeatured) - Number(left.isFeatured)
          || Date.parse(right.startsAt) - Date.parse(left.startsAt)
        ));
      });
    } catch (error: any) {
      if (error?.field) setInvalidField(String(error.field));
      announce(error?.message || "ذخیره رویداد ناموفق بود.", "error");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (event: SiteEvent, status: SiteEventStatus) => {
    const token = api.getToken();
    if (!token) return;
    try {
      const saved = await api.setSiteEventStatus(token, event.id, status, status === "published" ? event.isFeatured : false);
      setEvents((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      announce(`وضعیت «${saved.title}» به ${STATUS_LABELS[saved.status]} تغییر کرد.`);
    } catch (error: any) {
      announce(error?.message || "تغییر وضعیت ناموفق بود.", "error");
    }
  };

  const feature = async (event: SiteEvent) => {
    const token = api.getToken();
    if (!token) return;
    try {
      const saved = await api.saveSiteEvent(token, {
        ...draftToPayload(draftFromEvent(event)),
        status: "published",
        isFeatured: !event.isFeatured,
      }, event.id);
      setEvents((current) => current
        .map((item) => (item.id === saved.id ? saved : { ...item, isFeatured: saved.isFeatured ? false : item.isFeatured })));
      announce(saved.isFeatured ? "این رویداد روی صفحهٔ اصلی نمایش داده می‌شود." : "بنر از صفحهٔ اصلی برداشته شد.");
    } catch (error: any) {
      announce(error?.message || "تغییر بنر صفحهٔ اصلی ناموفق بود.", "error");
    }
  };

  const remove = async (event: SiteEvent) => {
    const token = api.getToken();
    if (!token) return;
    if (!window.confirm(`«${event.title}» و همهٔ بازدیدهای ثبت‌شدهٔ آن برای همیشه حذف شود؟ این عمل قابل بازگشت نیست.`)) return;
    try {
      const result = await api.deleteSiteEvent(token, event.id);
      setEvents((current) => current.filter((item) => item.id !== event.id));
      if (draft?.id === event.id) setDraft(null);
      announce(`رویداد حذف شد؛ ${result.removedViews.toLocaleString("fa-IR")} بازدید ثبت‌شده هم پاک شد.`);
    } catch (error: any) {
      announce(error?.message || "حذف رویداد ناموفق بود.", "error");
    }
  };

  const fieldClass = (field: string) =>
    `w-full rounded-xl border p-2.5 text-xs ${controlClass} ${invalidField === field ? "border-rose-500 ring-1 ring-rose-500/40" : ""}`;

  const chip = (active: boolean) =>
    `rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
      active ? "bg-cyan-600 text-white" : isDark ? "bg-slate-800/70 text-slate-300 hover:bg-slate-700" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
    }`;

  return (
    <div className="space-y-4" data-event-manager>
      <div className="flex flex-wrap items-center gap-2">
        <Trophy className="h-5 w-5 text-cyan-400" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">مدیریت رویدادها و بنرها</h2>
          <p className="text-[10px] text-slate-500">
            ساخت، ویرایش، انتشار، بایگانی و حذف رویداد — همراه با بنر صفحهٔ اصلی. برای اجرای یک رویداد تازه نیازی به انتشار نسخهٔ جدید نیست.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-bold ${borderClass} hover:text-cyan-300`}
        >
          <RefreshCw className="h-3.5 w-3.5" /> نوسازی
        </button>
        <button
          type="button"
          onClick={() => { setDraft(emptyDraft()); setInvalidField(""); }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2 text-[11px] font-black text-white hover:bg-cyan-500"
        >
          <Plus className="h-4 w-4" /> رویداد جدید
        </button>
      </div>

      {notice && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 rounded-xl px-4 py-2 text-[11px] font-bold ${
            notice.tone === "error" ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300"
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            {notice.tone === "error" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <Check className="h-3.5 w-3.5 shrink-0" />}
            <span className="break-words">{notice.message}</span>
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label="بستن پیام" className="shrink-0 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Editor */}
      {draft && (
        <div className={`space-y-4 rounded-2xl border p-4 ${borderClass} ${cardClass}`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-black uppercase tracking-wider text-cyan-300">
              {draft.id ? "ویرایش رویداد" : "رویداد جدید"}
            </h3>
            <button type="button" onClick={() => setDraft(null)} className="rounded-lg p-1 text-slate-400 hover:text-rose-400" aria-label="بستن ویرایشگر">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
              عنوان رویداد *
              <input
                className={fieldClass("title")}
                value={draft.title}
                maxLength={SITE_EVENT_LIMITS.title}
                onChange={(e) => update({ title: e.target.value })}
                placeholder="مثلاً: رویداد زمستانی رمان‌ها"
              />
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
              نشانی رویداد (لاتین) *
              <input
                className={`${fieldClass("slug")} font-mono`}
                value={draft.slug}
                dir="ltr"
                onChange={(e) => update({ slug: e.target.value })}
                onBlur={(e) => update({ slug: normalizeSiteEventSlug(e.target.value || draft.title) })}
                placeholder="winter-2026"
              />
              <span className="block font-normal normal-case text-[9px] text-slate-500">
                در پیوندها استفاده می‌شود؛ فقط حروف و ارقام لاتین.
              </span>
            </label>
          </div>

          <label className="block space-y-1 text-[10px] font-bold uppercase text-slate-400">
            توضیح کوتاه
            <textarea
              className={`${fieldClass("description")} resize-none`}
              rows={2}
              value={draft.description}
              maxLength={SITE_EVENT_LIMITS.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="در یک یا دو جمله توضیح دهید این رویداد چیست."
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
              آغاز رویداد *
              <input type="datetime-local" className={fieldClass("startsAt")} value={draft.startsAt} onChange={(e) => update({ startsAt: e.target.value })} />
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
              پایان رویداد *
              <input type="datetime-local" className={fieldClass("endsAt")} value={draft.endsAt} onChange={(e) => update({ endsAt: e.target.value })} />
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
              برچسب تاریخ (نمایشی)
              <input className={fieldClass("dateLabel")} value={draft.dateLabel} onChange={(e) => update({ dateLabel: e.target.value })} placeholder="۱ تا ۳۱ دی ۱۴۰۵" />
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
              برچسب منطقهٔ زمانی
              <input className={fieldClass("timezoneLabel")} value={draft.timezoneLabel} onChange={(e) => update({ timezoneLabel: e.target.value })} placeholder="UTC" />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold text-slate-500">گونه:</span>
              <button type="button" className={chip(draft.kind === "views_leaderboard")} onClick={() => update({ kind: "views_leaderboard" })}>جدول بازدیدها</button>
              <button type="button" className={chip(draft.kind === "announcement")} onClick={() => update({ kind: "announcement" })}>اطلاعیه (فقط بنر)</button>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold text-slate-500">وضعیت:</span>
              {(["draft", "published", "archived"] as SiteEventStatus[]).map((status) => (
                <button key={status} type="button" className={chip(draft.status === status)} onClick={() => update({ status })}>
                  {STATUS_LABELS[status]}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
              <input
                type="checkbox"
                checked={draft.isFeatured}
                onChange={(e) => update({ isFeatured: e.target.checked })}
                className="h-4 w-4 accent-cyan-500"
              />
              نمایش بنر روی صفحهٔ اصلی
            </label>
          </div>

          {draft.kind === "views_leaderboard" && (
            <label className="block space-y-1 text-[10px] font-bold uppercase text-slate-400">
              نویسندگان مستثنا (با ویرگول جدا کنید)
              <input
                className={fieldClass("excludedAuthors")}
                value={draft.excludedAuthors}
                onChange={(e) => update({ excludedAuthors: e.target.value })}
                placeholder="The_BestX، The_Lite"
              />
              <span className="block font-normal normal-case text-[9px] text-slate-500">
                رمان‌های این حساب‌ها از جدول امتیازها حذف می‌شوند (نام‌های پیشین حساب هم بررسی می‌شود).
              </span>
            </label>
          )}

          {/* Banner */}
          <div className={`space-y-3 rounded-2xl border p-3 ${borderClass}`}>
            <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400">بنر رویداد</h4>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
                تیتر بنر
                <input className={fieldClass("bannerHeadline")} value={draft.bannerHeadline} onChange={(e) => update({ bannerHeadline: e.target.value })} placeholder="رویداد زمستانی" />
              </label>
              <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
                زیرتیتر بنر
                <input className={fieldClass("bannerSubheadline")} value={draft.bannerSubheadline} onChange={(e) => update({ bannerSubheadline: e.target.value })} placeholder="جدول امتیازها را دنبال کنید." />
              </label>
              <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
                متن دکمه
                <input className={fieldClass("bannerCtaLabel")} value={draft.bannerCtaLabel} onChange={(e) => update({ bannerCtaLabel: e.target.value })} placeholder="مشاهدهٔ جدول" />
              </label>
              <label className="space-y-1 text-[10px] font-bold uppercase text-slate-400">
                پیوند دکمه
                <input
                  className={`${fieldClass("banner.ctaHref")} font-mono`}
                  dir="ltr"
                  value={draft.bannerCtaHref}
                  onChange={(e) => update({ bannerCtaHref: e.target.value })}
                  placeholder="/eventstatus"
                />
                {draft.bannerCtaHref && !isSafeSiteEventUrl(draft.bannerCtaHref) && (
                  <span className="block font-normal normal-case text-[9px] text-rose-400">
                    پیوند باید مسیری در رپتوک (با / آغاز شود) یا نشانی HTTPS باشد.
                  </span>
                )}
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500">رنگ‌بندی:</span>
              {SITE_EVENT_BANNER_THEMES.map((bannerTheme) => (
                <button
                  key={bannerTheme}
                  type="button"
                  onClick={() => update({ bannerTheme })}
                  aria-label={`رنگ‌بندی ${bannerTheme}`}
                  aria-pressed={draft.bannerTheme === bannerTheme}
                  className={`h-7 w-7 rounded-lg bg-gradient-to-br ${BANNER_THEME_CLASSES[bannerTheme]} ${
                    draft.bannerTheme === bannerTheme ? "ring-2 ring-white/80" : "opacity-70 hover:opacity-100"
                  }`}
                />
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadBanner(file);
                }}
              />
              <button
                type="button"
                disabled={uploadingBanner}
                onClick={() => bannerInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-[11px] font-black text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {uploadingBanner ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {uploadingBanner ? "در حال بارگذاری…" : "بارگذاری تصویر بنر"}
              </button>
              <label className="min-w-48 flex-1 space-y-1 text-[10px] font-bold uppercase text-slate-400">
                یا نشانی تصویر
                <input
                  className={`${fieldClass("banner.imageUrl")} font-mono`}
                  dir="ltr"
                  value={draft.bannerImageUrl}
                  onChange={(e) => update({ bannerImageUrl: e.target.value })}
                  placeholder="/uploads/banner.webp"
                />
              </label>
              {draft.bannerImageUrl && (
                <button
                  type="button"
                  onClick={() => update({ bannerImageUrl: "" })}
                  className="rounded-xl border border-rose-500/30 px-3 py-2 text-[11px] font-bold text-rose-400 hover:bg-rose-500/10"
                >
                  حذف تصویر
                </button>
              )}
            </div>

            <label className="block space-y-1 text-[10px] font-bold uppercase text-slate-400">
              متن جانشین تصویر (دسترس‌پذیری)
              <input className={fieldClass("bannerAlt")} value={draft.bannerAlt} onChange={(e) => update({ bannerAlt: e.target.value })} placeholder="پوستر رویداد زمستانی" />
            </label>

            {/* Live preview: what a reader will see on the home page. */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-slate-500">پیش‌نمایش بنر</span>
              <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${BANNER_THEME_CLASSES[draft.bannerTheme]} p-5`}>
                {draft.bannerImageUrl && (
                  <SafeImage
                    src={draft.bannerImageUrl}
                    alt={draft.bannerAlt || "پیش‌نمایش بنر"}
                    className="absolute inset-0 h-full w-full object-cover opacity-40"
                  />
                )}
                <div className="relative space-y-1 text-white">
                  <p className="text-lg font-black drop-shadow">{draft.bannerHeadline || draft.title || "تیتر بنر"}</p>
                  {(draft.bannerSubheadline || draft.dateLabel) && (
                    <p className="text-xs font-semibold opacity-90 drop-shadow">
                      {draft.bannerSubheadline || draft.dateLabel}
                    </p>
                  )}
                  {draft.bannerCtaLabel && (
                    <span className="mt-2 inline-block rounded-xl bg-white/90 px-3 py-1.5 text-[11px] font-black text-slate-900">
                      {draft.bannerCtaLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-700/20 pt-3">
            {validation?.error && (
              <span className="me-auto text-[11px] font-bold text-amber-500">{validation.error.message}</span>
            )}
            <button type="button" onClick={() => setDraft(null)} className={`rounded-xl border px-4 py-2 text-[11px] font-bold ${borderClass} hover:text-rose-400`}>
              انصراف
            </button>
            <button
              type="button"
              disabled={saving || !!validation?.error}
              onClick={() => void save()}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2 text-[11px] font-black text-white hover:bg-cyan-500 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {draft.id ? "ذخیره تغییرات" : "ساخت رویداد"}
            </button>
          </div>
        </div>
      )}

      {/* Existing events */}
      {loading ? (
        <div className={`flex items-center justify-center gap-2 rounded-2xl border p-8 text-xs font-bold text-slate-500 ${borderClass} ${cardClass}`}>
          <Loader2 className="h-4 w-4 animate-spin" /> در حال بارگذاری رویدادها…
        </div>
      ) : events.length === 0 ? (
        <div className={`rounded-2xl border p-8 text-center text-xs italic text-slate-500 ${borderClass} ${cardClass}`}>
          هنوز رویدادی ساخته نشده است. با «رویداد جدید» نخستین رویداد را بسازید.
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border p-3 ${borderClass} ${cardClass}`}>
              <div className={`h-12 w-20 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br ${BANNER_THEME_CLASSES[event.banner.theme]}`}>
                {event.banner.imageUrl && (
                  <SafeImage src={event.banner.imageUrl} alt={event.banner.alt || event.title} className="h-full w-full object-cover opacity-80" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-xs font-black">{event.title}</span>
                  {event.isFeatured && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-black text-amber-400">
                      <Star className="h-2.5 w-2.5" /> صفحهٔ اصلی
                    </span>
                  )}
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${
                    event.status === "published" ? "bg-emerald-500/15 text-emerald-400"
                      : event.status === "draft" ? "bg-amber-500/15 text-amber-400"
                        : "bg-slate-500/15 text-slate-400"
                  }`}>
                    {STATUS_LABELS[event.status]}
                  </span>
                  <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-black text-cyan-300">
                    {PHASE_LABELS[event.phase] || event.phase}
                  </span>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-500">
                  <span dir="ltr">/{event.slug}</span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {new Date(event.startsAt).toLocaleDateString("fa-IR")} — {new Date(event.endsAt).toLocaleDateString("fa-IR")}
                  </span>
                  <span>{event.kind === "views_leaderboard" ? "جدول بازدیدها" : "اطلاعیه"}</span>
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void feature(event)}
                  className={`rounded-lg p-2 ${event.isFeatured ? "text-amber-400 hover:bg-amber-500/10" : "text-slate-400 hover:bg-slate-500/10 hover:text-amber-400"}`}
                  title={event.isFeatured ? "برداشتن بنر از صفحهٔ اصلی" : "نمایش بنر روی صفحهٔ اصلی"}
                  aria-label={event.isFeatured ? "برداشتن بنر از صفحهٔ اصلی" : "نمایش بنر روی صفحهٔ اصلی"}
                >
                  <Pin className="h-4 w-4" />
                </button>
                {(["draft", "published", "archived"] as SiteEventStatus[])
                  .filter((status) => status !== event.status)
                  .map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => void changeStatus(event, status)}
                      className={chip(false)}
                      title={`تغییر وضعیت به ${STATUS_LABELS[status]}`}
                    >
                      {STATUS_LABELS[status]}
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => { setDraft(draftFromEvent(event)); setInvalidField(""); }}
                  className="rounded-lg p-2 text-cyan-400 hover:bg-cyan-500/10"
                  title="ویرایش رویداد"
                  aria-label={`ویرایش ${event.title}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void remove(event)}
                  className="rounded-lg p-2 text-rose-400 hover:bg-rose-500/10"
                  title="حذف رویداد"
                  aria-label={`حذف ${event.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { BANNER_THEME_CLASSES, DEFAULT_SITE_EVENT_BANNER };
