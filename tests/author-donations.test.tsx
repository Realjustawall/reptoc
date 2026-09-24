import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the donate platform is accepted by the server alongside the social links", () => {
  const server = readFileSync(new URL("../server/api/index.ts", import.meta.url), "utf8");

  assert.match(server, /supportedAuthorLinkPlatforms = new Set\(\["patreon", "youtube", "tiktok", "x", "instagram", "donate"\]\)/);
  // The rejection message must mention the new option.
  assert.match(server, /حمایت مالی، Patreon، YouTube، TikTok، X یا Instagram/);
});

test("donation links reuse the existing URL and quota guards", () => {
  const server = readFileSync(new URL("../server/api/index.ts", import.meta.url), "utf8");

  // normalizeAuthorLinkUrl strips credentials and rejects non-HTTP schemes;
  // the donate entry must not bypass it.
  assert.match(server, /const url = normalizeAuthorLinkUrl\(req\.body\?\.url\)/);
  // One row per platform, five connections per profile.
  assert.match(server, /لینک \$\{label\} از قبل در این پروفایل وجود دارد/);
  assert.match(server, /هر پروفایل حداکثر 5 اتصال می‌تواند داشته باشد/);
});

test("authors can add a financial-support link from their own panel", () => {
  const panel = readFileSync(new URL("../src/components/AuthorSocialLinksPanel.tsx", import.meta.url), "utf8");

  assert.match(panel, /\{ value: "donate", label: "حمایت مالی", icon: HandCoins \}/);
  // It is the default selection, since it is the entry authors want most.
  assert.match(panel, /useState\(\{ platform: "donate", label: "حمایت مالی", url: "" \}\)/);
  assert.match(panel, /حمایت مالی و شبکه‌های اجتماعی/);
});

test("readers see the support link first, on both the novel and chapter pages", () => {
  const display = readFileSync(new URL("../src/components/AuthorLinksDisplay.tsx", import.meta.url), "utf8");
  const novel = readFileSync(new URL("../src/components/NovelDetails.tsx", import.meta.url), "utf8");
  const reader = readFileSync(new URL("../src/components/Reader.tsx", import.meta.url), "utf8");

  assert.match(display, /donate: \{ icon: HandCoins/);
  // Sorted so the donate entry leads the grid.
  assert.match(display, /Number\(right\.platform === "donate"\) - Number\(left\.platform === "donate"\)/);
  // External links must stay untrusted.
  assert.match(display, /rel="noopener noreferrer nofollow"/);
  assert.match(display, /target="_blank"/);
  assert.match(novel, /<AuthorLinksDisplay/);
  assert.match(reader, /<AuthorLinksDisplay/);
});
