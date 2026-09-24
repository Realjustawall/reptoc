import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("startup renders the shell without a network-blocking splash", () => {
  assert.doesNotMatch(app, /loadingInitial && \(/);
  assert.doesNotMatch(app, /await checkServerStatus\(\)/);
  assert.match(app, /Render the application shell immediately/);
  assert.match(app, /void api\.getNovels\(\)/);
  assert.match(app, /void api\.getSettings\(\)/);
});

test("non-home routes are downloaded on demand", () => {
  for (const component of [
    "Discover", "Reader", "NovelDetails", "UserProfile", "Forums",
    "DailyChallenges", "EditorPanel", "Bookmarks", "Premium",
  ]) {
    assert.match(app, new RegExp(`lazy\\(\\(\\) => import\\(\"\\./components/${component}\"\\)\\)`));
  }
});

test("anonymous startup does not request private social data", () => {
  const authPosition = app.indexOf("if (authData?.success && authData.user)");
  const socialPosition = app.indexOf("void api.getSocial()", authPosition);
  assert.ok(authPosition >= 0 && socialPosition > authPosition);
});

test("background refresh work is visibility-aware and low frequency", () => {
  assert.match(app, /setInterval\(refreshWhenVisible, 30_000\)/);
  assert.match(app, /document\.visibilityState === "visible"/);
  assert.doesNotMatch(app, /setInterval\(refresh, 4000\)/);
});

test("large DOM compatibility scans are batched outside the render commit", () => {
  const brand = readFileSync(new URL("../src/utils/brandName.ts", import.meta.url), "utf8");
  assert.match(brand, /window\.requestAnimationFrame\(flush\)/);
  assert.match(brand, /const pendingNodes = new Set<Node>\(\)/);
});

test("offscreen shelves and full-page transitions avoid expensive paint work", () => {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf8");
  assert.match(css, /\.mobile-home-dashboard \.mobile-home-deferred[\s\S]{0,100}content-visibility: auto/);
  assert.match(css, /\.app-view-stage > div[\s\S]{0,60}filter: none !important/);
  assert.match(css, /\.reptoc-app\[data-ui-motion="reduced"\]/);
  assert.doesNotMatch(dashboard, /layout=\{!disableMotion\}/);
});
