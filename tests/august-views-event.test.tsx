import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HomepageHeroCarousel from "../src/components/HomepageHeroCarousel";
import {
  AUGUST_VIEWS_EVENT,
  getAugustViewsEventPhase,
  isAugustViewsAuthorExcluded,
} from "../shared/augustViewsEvent";

test("August views event uses the complete UTC month with an exclusive end boundary", () => {
  assert.equal(AUGUST_VIEWS_EVENT.startsAt, "2026-08-01T00:00:00.000Z");
  assert.equal(AUGUST_VIEWS_EVENT.endsAt, "2026-09-01T00:00:00.000Z");
  assert.equal(getAugustViewsEventPhase("2026-07-31T23:59:59.999Z"), "upcoming");
  assert.equal(getAugustViewsEventPhase("2026-08-01T00:00:00.000Z"), "active");
  assert.equal(getAugustViewsEventPhase("2026-08-31T23:59:59.999Z"), "active");
  assert.equal(getAugustViewsEventPhase("2026-09-01T00:00:00.000Z"), "completed");
});

test("named staff authors are excluded case-insensitively", () => {
  assert.equal(isAugustViewsAuthorExcluded("The_BestX"), true);
  assert.equal(isAugustViewsAuthorExcluded(" the_lite "), true);
  assert.equal(isAugustViewsAuthorExcluded("ABYSS KID"), true);
  assert.equal(isAugustViewsAuthorExcluded("abyss_kid"), true);
  assert.equal(isAugustViewsAuthorExcluded("Eligible Author"), false);
});

test("a finished event with no ranked novels leaves a single homepage banner", () => {
  const source = readFileSync(new URL("../src/components/HomepageHeroCarousel.tsx", import.meta.url), "utf8");

  // The event slide used to stay in the rotation forever, so the homepage kept
  // showing a second banner that led to an empty leaderboard. It is now driven by
  // whichever event an owner featured, and a completed leaderboard event with no
  // ranked novels is still retired rather than rotated through.
  assert.match(source, /featuredPhase !== "completed" \|\| rankedNovels > 0/);
  assert.match(source, /const slideCount = showEventSlide \? 2 : 1;/);
  // Rotation, arrows and dots all follow the real slide count.
  assert.match(source, /if \(slideCount < 2\) return;/);
  assert.match(source, /\{slideCount > 1 && \(/);
  assert.match(source, /\.slice\(0, slideCount\)/);
});

test("the homepage event banner is administrator-managed, not hard-coded", () => {
  const source = readFileSync(new URL("../src/components/HomepageHeroCarousel.tsx", import.meta.url), "utf8");

  // Promoting an event used to require a deployment because the slide's copy,
  // artwork and dates were literals in this component. They now come from the
  // featured event row.
  assert.match(source, /api\.getFeaturedEventBanner\(\)/);
  assert.match(source, /featured\.banner\.headline \|\| featured\.title/);
  assert.match(source, /BANNER_THEME_GRADIENTS\[bannerTheme\]/);
  assert.doesNotMatch(source, /پرخواننده‌ترین داستان‌ها به صدر می‌رسند/);
});

test("homepage hero renders the discover banner and stays single-slide with no featured event", () => {
  const html = renderToStaticMarkup(
    <HomepageHeroCarousel
      theme="dark"
      activeTheme={{ border: "border-slate-800", shadow: "shadow-xl" }}
      onOpenWriter={() => {}}
      onOpenEvent={() => {}}
    />,
  );

  assert.match(html, /رمان‌های شگفت‌انگیز را کشف کنید/);
  assert.match(html, /ساخت رمان جدید/);
  // Nothing is featured until the banner request resolves, so the carousel must
  // not paint arrows or dots for a slide that does not exist.
  assert.doesNotMatch(html, /aria-label="بنر بعدی"/);
  assert.doesNotMatch(html, /aria-label="بنر قبلی"/);
});

test("homepage banner occupies a full slide and shows all uploaded artwork", () => {
  const source = readFileSync(new URL("../src/components/HomepageHeroCarousel.tsx", import.meta.url), "utf8");

  // The page is RTL, but carousel transforms are calculated left-to-right.
  // Isolating the track direction prevents a slide from landing half outside
  // the clipped viewport.
  assert.match(source, /dir="ltr"[\s\S]{0,120}flex w-full items-stretch/);
  assert.match(source, /flex-\[0_0_100%\]/);
  // A cover layer may fill empty margins, while the foreground copy of the
  // artwork uses contain so no side of the actual banner is cropped.
  assert.match(source, /object-contain opacity-55/);
  assert.match(source, /object-contain opacity-50/);
});

test("event view persistence is attached to the normal unique-view insertion", () => {
  const source = readFileSync(new URL("../server/utils/viewCounting.ts", import.meta.url), "utf8");
  assert.match(source, /INSERT INTO novel_event_views/);
  assert.match(source, /FROM inserted/);
  assert.match(source, /CURRENT_TIMESTAMP >= \$5::timestamptz/);
  assert.match(source, /CURRENT_TIMESTAMP < \$6::timestamptz/);
  assert.match(source, /ON CONFLICT \(novel_id, viewer_key\) DO NOTHING/);
});

test("event migration and public route preserve staff exclusions and leaderboard paging", () => {
  const migration = readFileSync(new URL("../migrations/052_august_views_event.sql", import.meta.url), "utf8");
  const route = readFileSync(new URL("../server/api/routes/events.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(migration, /PRIMARY KEY \(event_id, novel_id, viewer_key\)/);
  assert.match(migration, /novel_event_excluded_authors/);
  assert.match(migration, /2026-08-01 00:00:00\+00/);
  assert.match(migration, /2026-09-01 00:00:00\+00/);
  assert.match(route, /WHERE rank > 3/);
  assert.match(route, /OFFSET \$5 LIMIT \$6/);
  assert.match(route, /username_history/);
  assert.match(app, /\/eventstatus/);
  assert.match(app, /activeView === "event-status"/);
});
