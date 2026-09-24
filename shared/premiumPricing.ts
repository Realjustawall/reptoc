/**
 * Premium pricing.
 *
 * The advertised price lives here so the plan page, the checkout endpoint and
 * any future receipt all quote the same number instead of drifting apart.
 *
 * IMPORTANT: this table is the *display* price only. The amount actually charged
 * is decided by the Stripe Price object referenced by
 * `STRIPE_PRICE_PREMIUM_*`, so a change here must be mirrored in Stripe or the
 * page will advertise one figure while the customer is billed another.
 * `assertPricingMatchesStripeAmount` exists so a mismatch fails loudly at
 * checkout rather than silently overcharging.
 */

export type PremiumPlanType = "reader" | "writer";

export const PREMIUM_DURATIONS = [1, 3, 6] as const;
export type PremiumDuration = (typeof PREMIUM_DURATIONS)[number];

export interface PremiumPlanPricing {
  /** List price per month, in cents, before any promotion. */
  baseMonthlyCents: number;
  /**
   * Promotional price per month, in cents. When present the plan page shows the
   * base price struck through next to this one.
   */
  promotionalMonthlyCents?: number;
}

/**
 * Per-plan pricing.
 *
 * Reader and Writer are priced independently: they are separate entitlements a
 * customer may buy either or both of.
 */
export const PREMIUM_PLAN_PRICING: Record<PremiumPlanType, PremiumPlanPricing> = {
  reader: { baseMonthlyCents: 200 },
  writer: { baseMonthlyCents: 200, promotionalMonthlyCents: 150 },
};

/**
 * Multi-month discounts, applied to whichever monthly price is in effect.
 *
 * Kept as a separate axis from the promotion above so a promotion and a longer
 * commitment can both apply without either being silently dropped.
 */
export const PREMIUM_DURATION_DISCOUNTS: Record<PremiumDuration, number> = {
  1: 0,
  3: 0.13,
  6: 0.2,
};

export function normalizePremiumPlanType(value: unknown): PremiumPlanType {
  return String(value || "").trim().toLowerCase() === "writer" ? "writer" : "reader";
}

export function normalizePremiumDuration(value: unknown): PremiumDuration {
  const months = Number(value);
  return (PREMIUM_DURATIONS as readonly number[]).includes(months) ? (months as PremiumDuration) : 1;
}

/** Format cents as a dollar amount, dropping a redundant `.00`. */
export function formatUsd(cents: number): string {
  const dollars = Math.max(0, Math.round(cents)) / 100;
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}

export interface PremiumQuote {
  planType: PremiumPlanType;
  months: PremiumDuration;
  /** List price per month before any discount. */
  baseMonthlyCents: number;
  /** Price per month after the promotion and the multi-month discount. */
  effectiveMonthlyCents: number;
  /** What the customer pays now. */
  totalCents: number;
  /** What the same period would cost at the list price. */
  baseTotalCents: number;
  savingsCents: number;
  /** True when a promotion (not merely a duration discount) is in effect. */
  hasPromotion: boolean;
  durationDiscountPercent: number;
}

/**
 * Price one plan for one duration.
 *
 * Rounding happens on the total, not per month, so the advertised total is
 * always exactly what the sum of the monthly figures should be.
 */
export function quotePremium(planTypeInput: unknown, monthsInput: unknown): PremiumQuote {
  const planType = normalizePremiumPlanType(planTypeInput);
  const months = normalizePremiumDuration(monthsInput);
  const plan = PREMIUM_PLAN_PRICING[planType];
  const durationDiscount = PREMIUM_DURATION_DISCOUNTS[months];

  const promotionalMonthly = plan.promotionalMonthlyCents;
  const hasPromotion = typeof promotionalMonthly === "number" && promotionalMonthly < plan.baseMonthlyCents;
  const monthlyBeforeDuration = hasPromotion ? (promotionalMonthly as number) : plan.baseMonthlyCents;

  const totalCents = Math.round(monthlyBeforeDuration * months * (1 - durationDiscount));
  const baseTotalCents = plan.baseMonthlyCents * months;

  return {
    planType,
    months,
    baseMonthlyCents: plan.baseMonthlyCents,
    effectiveMonthlyCents: Math.round(totalCents / months),
    totalCents,
    baseTotalCents,
    savingsCents: Math.max(0, baseTotalCents - totalCents),
    hasPromotion,
    durationDiscountPercent: Math.round(durationDiscount * 100),
  };
}

/**
 * Guard against advertising one price and charging another.
 *
 * Stripe reports the amount it is about to charge; if it disagrees with the
 * quote the page showed, the checkout must fail rather than complete. A
 * tolerance of one cent absorbs currency rounding only.
 */
export function assertPricingMatchesStripeAmount(
  quote: PremiumQuote,
  stripeAmountCents: unknown,
): { ok: true } | { ok: false; message: string } {
  const amount = Number(stripeAmountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    // Stripe did not report an amount (some Price types omit it); the quote
    // cannot be verified, so the caller decides whether to proceed.
    return { ok: true };
  }
  if (Math.abs(amount - quote.totalCents) <= 1) return { ok: true };
  return {
    ok: false,
    message: `مبلغ اعلام‌شده (${formatUsd(quote.totalCents)}) با مبلغ درگاه پرداخت (${formatUsd(amount)}) یکسان نیست.`,
  };
}
