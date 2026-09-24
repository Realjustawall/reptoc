import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PREMIUM_PLAN_PRICING,
  assertPricingMatchesStripeAmount,
  formatUsd,
  normalizePremiumDuration,
  normalizePremiumPlanType,
  quotePremium,
} from "../shared/premiumPricing";

test("reader is $2/month and writer is $2 discounted to $1.50", () => {
  assert.equal(PREMIUM_PLAN_PRICING.reader.baseMonthlyCents, 200);
  assert.equal(PREMIUM_PLAN_PRICING.writer.baseMonthlyCents, 200);
  assert.equal(PREMIUM_PLAN_PRICING.writer.promotionalMonthlyCents, 150);

  const reader = quotePremium("reader", 1);
  assert.equal(reader.effectiveMonthlyCents, 200);
  assert.equal(reader.totalCents, 200);
  assert.equal(reader.hasPromotion, false);
  assert.equal(reader.savingsCents, 0);

  const writer = quotePremium("writer", 1);
  assert.equal(writer.effectiveMonthlyCents, 150);
  assert.equal(writer.totalCents, 150);
  assert.equal(writer.hasPromotion, true);
  // The struck-through list price is what makes the discount legible.
  assert.equal(writer.baseMonthlyCents, 200);
  assert.equal(writer.savingsCents, 50);
});

test("the promotion and the multi-month discount both apply", () => {
  // 150 × 3 × 0.87 = 391.5 → 392, versus a 600 list price.
  const threeMonths = quotePremium("writer", 3);
  assert.equal(threeMonths.totalCents, 392);
  assert.equal(threeMonths.baseTotalCents, 600);
  assert.equal(threeMonths.durationDiscountPercent, 13);

  // 150 × 6 × 0.80 = 720.
  const sixMonths = quotePremium("writer", 6);
  assert.equal(sixMonths.totalCents, 720);
  assert.equal(sixMonths.savingsCents, 480);

  // Reader has no promotion, so only the duration discount applies.
  assert.equal(quotePremium("reader", 6).totalCents, 960);
});

test("the monthly figure shown always multiplies back to the advertised total", () => {
  for (const planType of ["reader", "writer"] as const) {
    for (const months of [1, 3, 6] as const) {
      const quote = quotePremium(planType, months);
      // Rounding on the total (not per month) keeps the two consistent, which is
      // what stops the page advertising a total the monthly price contradicts.
      assert.ok(Math.abs(quote.effectiveMonthlyCents * months - quote.totalCents) <= months);
    }
  }
});

test("plan and duration inputs are normalised rather than trusted", () => {
  assert.equal(normalizePremiumPlanType("writer"), "writer");
  assert.equal(normalizePremiumPlanType("WRITER"), "writer");
  assert.equal(normalizePremiumPlanType("owner"), "reader");
  assert.equal(normalizePremiumPlanType(undefined), "reader");
  assert.equal(normalizePremiumDuration(6), 6);
  assert.equal(normalizePremiumDuration(99), 1);
  assert.equal(normalizePremiumDuration("3"), 3);
  assert.equal(normalizePremiumDuration(null), 1);
});

test("prices are formatted without a redundant decimal", () => {
  assert.equal(formatUsd(200), "$2");
  assert.equal(formatUsd(150), "$1.50");
  assert.equal(formatUsd(392), "$3.92");
  assert.equal(formatUsd(0), "$0");
});

test("a Stripe price that disagrees with the quote blocks the checkout", () => {
  const quote = quotePremium("writer", 1);
  assert.equal(assertPricingMatchesStripeAmount(quote, 150).ok, true);
  // One cent of currency rounding is tolerated.
  assert.equal(assertPricingMatchesStripeAmount(quote, 151).ok, true);
  // A stale Stripe Price would otherwise bill an amount never shown.
  const mismatch = assertPricingMatchesStripeAmount(quote, 499);
  assert.equal(mismatch.ok, false);
  if (mismatch.ok === false) assert.match(mismatch.message, /یکسان نیست/);
  // Some Price types report no amount; that cannot be verified, so it passes.
  assert.equal(assertPricingMatchesStripeAmount(quote, null).ok, true);
});

test("the plan page and the checkout endpoint quote from the same table", () => {
  const page = readFileSync(new URL("../src/components/Premium.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../server/api/index.ts", import.meta.url), "utf8");

  assert.match(page, /quotePremium\(premiumType, duration\)/);
  // The old hard-coded table is gone.
  assert.doesNotMatch(page, /\$4\.99/);
  assert.doesNotMatch(page, /هم‌قیمت هستند/);
  assert.match(api, /const quote = quotePremium\(premiumType, months\)/);
  assert.match(api, /PREMIUM_PRICE_MISMATCH/);
  // Per-plan Stripe Prices, with the shared one as a fallback.
  assert.match(api, /STRIPE_PRICE_PREMIUM_\$\{planSuffix\}_\$\{months\}M/);
});
