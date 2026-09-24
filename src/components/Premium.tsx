import React, { useState } from "react";
import { Sparkles, Crown, Check, ShieldAlert, Ticket } from "lucide-react";
import { api } from "../utils/api";
import {
  PREMIUM_DURATIONS,
  formatUsd,
  quotePremium,
  type PremiumPlanType,
} from "../../shared/premiumPricing";

interface PremiumProps {
  theme: "light" | "dark";
  /** Opens a pre-filled support ticket for manual VIP purchase. */
  onBuyVip?: () => void;
}

export default function Premium({ theme, onBuyVip }: PremiumProps) {
  const [duration, setDuration] = useState<number>(1);
  const [premiumType, setPremiumType] = useState<PremiumPlanType>("reader");
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");

  // Pricing comes from the shared table so this page and the checkout endpoint
  // can never quote different figures. Reader and Writer are priced separately.
  const quote = quotePremium(premiumType, duration);

  const handlePurchase = async () => {
    const token = api.getToken();
    if (!token) {
      setCheckoutError("لطفاً پیش از شروع فرایند پرداخت پریمیوم، وارد حساب خود شوید.");
      return;
    }
    setIsStartingCheckout(true);
    setCheckoutError("");
    const result = await api.startPremiumCheckout(token, duration, premiumType);
    setIsStartingCheckout(false);
    if (result?.success && result.checkoutUrl) {
      window.location.href = result.checkoutUrl;
      return;
    }
    setCheckoutError(result?.error || "سیستم پرداخت پریمیوم موقتاً در دسترس نیست.");
  };

  return (
    <div className="space-y-8 pb-16 max-w-4xl mx-auto">
      {/* Hero Header */}
      <section className={`p-8 md:p-10 rounded-3xl border text-center ${
        theme === "dark" 
          ? "bg-gradient-to-br from-black via-[#080718] to-violet-950/20 border-violet-900/40 shadow-[0_0_20px_rgba(139,92,246,0.15)]" 
          : "bg-gradient-to-br from-amber-50/50 to-white border-[#E7DEC8] shadow-sm"
      }`}>
        <div className="space-y-4 flex flex-col items-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-medium border border-violet-500/20 bg-violet-500/10 text-violet-400">
            <Crown className="w-3.5 h-3.5" />
            <span>تجربه پریمیوم</span>
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight">تجربه پریمیوم مورد نیاز خود را انتخاب کنید.</h1>
          <p className="text-sm md:text-base text-slate-400 leading-relaxed max-w-lg">
            پریمیوم خواننده و پریمیوم نویسنده کاملاً از هم مستقل‌اند و جداگانه قیمت‌گذاری می‌شوند؛ می‌توانید یکی یا هر دو را تهیه کنید.
          </p>
        </div>
      </section>

      {/* Main Single Plan Card */}
      <div className={`max-w-xl mx-auto p-8 rounded-3xl border relative transition-all ${
        theme === "dark" 
          ? "bg-[#0c0d23] ring-1 ring-purple-500 border-purple-500/30 shadow-2xl shadow-purple-500/10" 
          : "bg-white ring-1 ring-amber-500 border-amber-500/30 shadow-xl"
      }`}>
        
        <div className="space-y-6">
          <div className="text-center">
            {/* Each plan advertises its own price, so a visitor can compare the
                two without switching tabs and re-reading the figure. */}
            <div className="mb-5 grid grid-cols-2 gap-2">
              {([
                { id: "reader" as PremiumPlanType, title: "پریمیوم خواننده", subtitle: "مطالعه بدون تبلیغات" },
                { id: "writer" as PremiumPlanType, title: "پریمیوم نویسنده", subtitle: "ابزارهای جهان‌سازی" },
              ]).map((plan) => {
                const planQuote = quotePremium(plan.id, duration);
                const selected = premiumType === plan.id;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setPremiumType(plan.id)}
                    aria-pressed={selected}
                    className={`rounded-xl border p-3 text-center transition-all ${
                      selected ? "border-purple-500 bg-purple-500/15" : "border-slate-700 hover:border-purple-500/50"
                    }`}
                  >
                    <strong className="block text-sm">{plan.title}</strong>
                    <small className="block text-[10px] opacity-70">{plan.subtitle}</small>
                    <span className="mt-1.5 flex items-center justify-center gap-1">
                      {planQuote.hasPromotion && (
                        <span className="text-[10px] text-slate-500 line-through">{formatUsd(planQuote.baseMonthlyCents)}</span>
                      )}
                      <span className={`text-xs font-black ${planQuote.hasPromotion ? "text-rose-400" : "text-purple-300"}`}>
                        {formatUsd(planQuote.effectiveMonthlyCents)}
                      </span>
                      <span className="text-[9px] text-slate-500">/ماه</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="text-[10px] uppercase font-mono tracking-wider text-purple-500 font-bold block mb-2">{premiumType==='reader'?'پلن خواننده':'پلن نویسنده'}</span>
            <h3 className="font-extrabold text-2xl md:text-3xl flex items-center justify-center gap-2">
              <Sparkles className="w-6 h-6 text-purple-400" />
              {premiumType==='reader'?'خواننده بدون تبلیغات':'نویسنده جهان‌سازی'}
            </h3>
            <p className="text-sm text-slate-500 mt-2">{premiumType==='reader'?'تجربه مطالعه 100% بدون تبلیغات':'ابزارهای پیشرفته نگارش و مدیریت'}</p>
          </div>

          <div className="flex flex-col gap-3 pt-4">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider text-center">انتخاب مدت اشتراک</span>
            <div className="grid grid-cols-3 gap-3">
              {PREMIUM_DURATIONS.map((months) => (
                <button
                  key={months}
                  onClick={() => setDuration(months)}
                  className={`p-3 rounded-xl border flex flex-col items-center justify-center transition-all ${
                    duration === months
                      ? theme === "dark" 
                        ? "bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-500/20"
                        : "bg-purple-50 border-purple-500 text-purple-700 ring-1 ring-purple-500"
                      : theme === "dark"
                        ? "bg-[#0b0716] border-slate-800 text-slate-400 hover:bg-slate-800"
                        : "bg-stone-50 border-stone-200 text-stone-600 hover:bg-stone-100"
                  }`}
                >
                  <span className="text-lg font-black">{months}</span>
                  <span className={`text-[10px] font-bold uppercase ${duration === months ? "opacity-90" : "opacity-60"}`}>
                    {months === 1 ? "ماه" : "ماه"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="py-6 text-center border-y border-slate-800/20 dark:border-violet-950/40">
            <div className="flex flex-wrap items-end justify-center gap-x-2 gap-y-1">
              {/* A promotion shows the list price struck through, so the discount
                  is legible rather than merely asserted. */}
              {quote.hasPromotion && (
                <span className="mb-1.5 text-lg font-bold text-slate-500 line-through decoration-rose-500/70">
                  {formatUsd(quote.baseMonthlyCents)}
                </span>
              )}
              <span className="text-4xl md:text-5xl font-extrabold">{formatUsd(quote.effectiveMonthlyCents)}</span>
              <span className="mb-1 text-sm font-medium text-slate-500">/ماه</span>
            </div>

            {quote.hasPromotion && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-3 py-1 text-[11px] font-black text-rose-400">
                <Sparkles className="h-3 w-3" />
                <span>قیمت ویژه — به‌جای {formatUsd(quote.baseMonthlyCents)} ماهانه</span>
              </div>
            )}

            {quote.months > 1 && (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs font-bold text-emerald-500">
                <span>مبلغ قابل پرداخت: {formatUsd(quote.totalCents)}</span>
                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5">
                  {quote.durationDiscountPercent.toLocaleString("fa-IR")}% تخفیف دوره
                </span>
              </div>
            )}

            {quote.months === 1 && !quote.hasPromotion && (
              <p className="mt-2 text-xs font-bold text-slate-500">مبلغ قابل پرداخت: {formatUsd(quote.totalCents)}</p>
            )}

            {quote.savingsCents > 0 && (
              <p className="mt-1 text-[11px] font-bold text-emerald-400">
                در این انتخاب {formatUsd(quote.savingsCents)} صرفه‌جویی می‌کنید.
              </p>
            )}
          </div>

          {/* Features */}
          <div className="space-y-3 text-sm font-medium text-slate-400 max-w-sm mx-auto">
            <div className="flex items-center gap-3">
              <Check className="w-5 h-5 text-emerald-500 shrink-0" />
              <span>{premiumType==='reader'?'حذف کامل تمام تبلیغات از بخش مطالعه':'ساخت و مدیریت فضای کار جهان‌سازی برای همه رمان‌ها'}</span>
            </div>
            <div className="flex items-center gap-3">
              <Check className="w-5 h-5 text-emerald-500 shrink-0" />
              <span>{premiumType==='reader'?'بدون پاپ‌آپ و وقفه‌های تبلیغاتی حامیان مالی':'نمودارها، نقشه‌ها، پس‌زمینه داستان، مصنوع‌ها، سیستم‌های قدرت و خطوط زمانی تعاملی'}</span>
            </div>
            <div className="flex items-center gap-3">
              <Check className="w-5 h-5 text-emerald-500 shrink-0" />
              <span>{premiumType==='reader'?'بارگذاری سریع‌تر صفحه‌ها و رابط کاربری تمیزتر':'انتشار، مدیریت نمایش، پیوندها، بازنگری‌ها و ویرایش گرافیکی'}</span>
            </div>
          </div>

          <button
            onClick={handlePurchase}
            disabled={isStartingCheckout}
            className={`w-full mt-4 py-3.5 rounded-xl text-sm font-bold transition-all bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 text-white shadow-lg shadow-purple-500/20 cursor-pointer`}
          >
            {isStartingCheckout ? "در حال انتقال به پرداخت امن..." : "شروع پرداخت امن"}
          </button>

          {onBuyVip && (
            <button
              onClick={onBuyVip}
              className="w-full mt-2 py-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs font-bold text-amber-400 hover:bg-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Ticket className="w-4 h-4" />
              خرید مستقیم VIP — ارسال تیکت به مدیران
            </button>
          )}

          {checkoutError && (
            <p className="text-xs text-rose-400 text-center font-medium leading-relaxed">{checkoutError}</p>
          )}
        </div>
      </div>
    </div>
  );
}
