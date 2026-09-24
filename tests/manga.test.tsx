import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MangaReader, {
  DEFAULT_MANGA_READER_SETTINGS,
  MANGA_ZOOM_RANGE,
  normalizeMangaReaderSettings,
} from "../src/components/MangaReader";
import MangaPageEditor from "../src/components/MangaPageEditor";
import {
  MANGA_MAX_PAGES_PER_CHAPTER,
  MANGA_PAGE_MAX_BYTES,
  buildMangaSpreads,
  clampPageDimension,
  isMangaWork,
  isStorableMangaPageSource,
  mangaPageAltText,
  mangaPageIndexFromPercent,
  mangaProgressPercent,
  normalizeContentKind,
  normalizeMangaPageList,
  normalizeMangaReadingMode,
  normalizeReadingDirection,
  validateMangaPageFile,
  type MangaPage,
} from "../shared/manga";

function page(overrides: Partial<MangaPage> & { pageNumber: number }): MangaPage {
  return {
    id: `page-${overrides.pageNumber}`,
    imageUrl: `/uploads/page-${overrides.pageNumber}.webp`,
    width: 1200,
    height: 1800,
    altText: "",
    isSpread: false,
    ...overrides,
  };
}

test("a work is prose unless it is explicitly a manga", () => {
  assert.equal(normalizeContentKind("manga"), "manga");
  assert.equal(normalizeContentKind("MANGA"), "manga");
  assert.equal(normalizeContentKind("novel"), "novel");
  assert.equal(normalizeContentKind("comic"), "novel");
  assert.equal(normalizeContentKind(undefined), "novel");

  // Both the camelCase client shape and the snake_case database row are accepted.
  assert.equal(isMangaWork({ contentKind: "manga" }), true);
  assert.equal(isMangaWork({ content_kind: "manga" }), true);
  assert.equal(isMangaWork({ contentKind: "novel" }), false);
  assert.equal(isMangaWork(null), false);
});

test("page-turn direction defaults to right-to-left", () => {
  assert.equal(normalizeReadingDirection("ltr"), "ltr");
  assert.equal(normalizeReadingDirection("rtl"), "rtl");
  assert.equal(normalizeReadingDirection("sideways"), "rtl");
  assert.equal(normalizeReadingDirection(undefined), "rtl");
});

test("only Reptoc-hosted uploads and HTTPS URLs may be stored as a page", () => {
  assert.equal(isStorableMangaPageSource("/uploads/page-1.webp"), true);
  assert.equal(isStorableMangaPageSource("/api/files/abc-1/content"), true);
  assert.equal(isStorableMangaPageSource("https://cdn.example.test/p.jpg"), true);
  // A blob URL dies with the tab and a data URL would be inlined into every
  // reader response.
  assert.equal(isStorableMangaPageSource("blob:https://reptoc.ir/1"), false);
  assert.equal(isStorableMangaPageSource("data:image/png;base64,AAAA"), false);
  assert.equal(isStorableMangaPageSource("http://cdn.example.test/p.jpg"), false);
  assert.equal(isStorableMangaPageSource("javascript:alert(1)"), false);
  assert.equal(isStorableMangaPageSource(""), false);
});

test("page numbers are always derived from array order, never trusted", () => {
  const { pages, rejection } = normalizeMangaPageList([
    { imageUrl: "/uploads/b.webp", altText: "  دو   خط  " },
    { imageUrl: "/uploads/a.webp", isSpread: true },
  ]);

  assert.equal(rejection, null);
  assert.deepEqual(pages.map((item) => item.pageNumber), [1, 2]);
  assert.equal(pages[0].imageUrl, "/uploads/b.webp");
  // Whitespace in a caption is collapsed so the alt text stays readable.
  assert.equal(pages[0].altText, "دو خط");
  assert.equal(pages[1].isSpread, true);
});

test("an unusable page source or an oversized chapter is rejected with its index", () => {
  const badSource = normalizeMangaPageList([
    { imageUrl: "/uploads/a.webp" },
    { imageUrl: "blob:https://reptoc.ir/2" },
  ]);
  assert.equal(badSource.pages.length, 0);
  assert.equal(badSource.rejection?.reason, "source");
  assert.equal(badSource.rejection?.index, 1);

  const tooMany = normalizeMangaPageList(
    Array.from({ length: MANGA_MAX_PAGES_PER_CHAPTER + 1 }, () => ({ imageUrl: "/uploads/a.webp" })),
  );
  assert.equal(tooMany.rejection?.reason, "count");
});

test("page dimensions are clamped and optional", () => {
  assert.equal(clampPageDimension(1200), 1200);
  assert.equal(clampPageDimension("2400"), 2400);
  assert.equal(clampPageDimension(999999), 20000);
  assert.equal(clampPageDimension(0), null);
  assert.equal(clampPageDimension(-5), null);
  assert.equal(clampPageDimension("abc"), null);
});

test("page uploads are limited to raster formats under the page ceiling", () => {
  assert.equal(validateMangaPageFile({ type: "image/jpeg", size: 1024 }), null);
  assert.equal(validateMangaPageFile({ type: "image/webp", size: MANGA_PAGE_MAX_BYTES }), null);
  // SVG can carry script payloads and GIF is not a page format.
  assert.equal(validateMangaPageFile({ type: "image/svg+xml", size: 10 })?.reason, "type");
  assert.equal(validateMangaPageFile({ type: "application/pdf", size: 10 })?.reason, "type");
  assert.equal(validateMangaPageFile({ type: "image/png", size: MANGA_PAGE_MAX_BYTES + 1 })?.reason, "size");
});

test("two-page layout keeps the cover and every spread standing alone", () => {
  const pages = [
    page({ pageNumber: 1 }),
    page({ pageNumber: 2 }),
    page({ pageNumber: 3 }),
    page({ pageNumber: 4, isSpread: true }),
    page({ pageNumber: 5 }),
    page({ pageNumber: 6 }),
  ];

  // Single and strip layouts show one page per step.
  assert.deepEqual(buildMangaSpreads(pages, "single").map((group) => group.length), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(buildMangaSpreads(pages, "strip").map((group) => group.length), [1, 1, 1, 1, 1, 1]);

  // The first page opens alone (like a printed cover), pages pair up, and a
  // double-page spread is never squeezed next to an unrelated page.
  const doubles = buildMangaSpreads(pages, "double");
  assert.deepEqual(doubles.map((group) => group.map((item) => item.pageNumber)), [[1], [2, 3], [4], [5, 6]]);
});

test("spreads are built from page order even when the input is shuffled", () => {
  const shuffled = [page({ pageNumber: 3 }), page({ pageNumber: 1 }), page({ pageNumber: 2 })];
  assert.deepEqual(
    buildMangaSpreads(shuffled, "single").map((group) => group[0].pageNumber),
    [1, 2, 3],
  );
});

test("reading progress reaches 100% only on the last page", () => {
  assert.equal(mangaProgressPercent(0, 4), 25);
  assert.equal(mangaProgressPercent(3, 4), 100);
  // An out-of-range index is clamped rather than producing >100%.
  assert.equal(mangaProgressPercent(99, 4), 100);
  assert.equal(mangaProgressPercent(0, 0), 0);
});

test("persisted manga progress resumes on the corresponding page", () => {
  assert.equal(mangaPageIndexFromPercent(0, 10), 0);
  assert.equal(mangaPageIndexFromPercent(10, 10), 0);
  assert.equal(mangaPageIndexFromPercent(50, 10), 4);
  assert.equal(mangaPageIndexFromPercent(100, 10), 9);
  assert.equal(mangaPageIndexFromPercent(120, 10), 9);
  assert.equal(mangaPageIndexFromPercent(50, 0), 0);
});

test("a page without a caption still announces its number to screen readers", () => {
  assert.equal(mangaPageAltText(page({ pageNumber: 2, altText: "نبرد پایانی" }), "فصل ۱"), "نبرد پایانی");
  assert.match(mangaPageAltText(page({ pageNumber: 2 }), "فصل ۱"), /فصل ۱/);
});

test("reader layout preferences are validated before use", () => {
  assert.deepEqual(normalizeMangaReaderSettings(null), DEFAULT_MANGA_READER_SETTINGS);
  assert.equal(normalizeMangaReaderSettings({ mode: "double" }).mode, "double");
  assert.equal(normalizeMangaReaderSettings({ mode: "nonsense" }).mode, "single");
  assert.equal(normalizeMangaReaderSettings({ fit: "width" }).fit, "width");
  assert.equal(normalizeMangaReaderSettings({ fit: "nonsense" }).fit, "height");
  assert.equal(normalizeMangaReaderSettings({ zoom: 99 }).zoom, MANGA_ZOOM_RANGE.max);
  assert.equal(normalizeMangaReaderSettings({ zoom: 0.01 }).zoom, MANGA_ZOOM_RANGE.min);
  assert.equal(normalizeMangaReaderSettings({ zoom: "x" }).zoom, 1);
  assert.equal(normalizeMangaReadingMode("strip"), "strip");
  assert.equal(normalizeMangaReadingMode("grid"), "single");
});

test("the manga reader renders pages with progress, page turning and layout controls", () => {
  const html = renderToStaticMarkup(
    <MangaReader
      pages={[page({ pageNumber: 1, altText: "جلد" }), page({ pageNumber: 2 })]}
      chapterTitle="نبرد نخست"
      chapterNumber={1}
      novelTitle="مانگای آزمایشی"
      readingDirection="rtl"
      theme="dark"
    />,
  );

  assert.match(html, /data-manga-reader="single"/);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /aria-label="نمای دوصفحه‌ای"/);
  assert.match(html, /aria-label="نمای نواری پیوسته"/);
  assert.match(html, /aria-label="پیمایش صفحه‌ها"/);
  // The forward click zone is labelled for the direction the work reads in.
  assert.match(html, /aria-label="صفحهٔ بعد"/);
  assert.match(html, /aria-label="صفحهٔ قبل"/);
  assert.match(html, /alt="جلد"/);
  // Pages are never inlined as data URLs.
  assert.doesNotMatch(html, /src="data:/);
});

test("an empty or loading manga chapter never renders a blank viewer", () => {
  const empty = renderToStaticMarkup(
    <MangaReader pages={[]} chapterTitle="خالی" chapterNumber={2} novelTitle="مانگا" readingDirection="rtl" theme="dark" />,
  );
  assert.match(empty, /این فصل هنوز صفحه‌ای ندارد/);

  const loading = renderToStaticMarkup(
    <MangaReader pages={[]} chapterTitle="خالی" chapterNumber={2} novelTitle="مانگا" readingDirection="rtl" theme="dark" loading />,
  );
  assert.match(loading, /aria-busy="true"/);
});

test("the page editor exposes upload, bulk actions and accessibility fields", () => {
  const html = renderToStaticMarkup(
    <MangaPageEditor
      novelId="novel-1"
      chapterId={null}
      chapterTitle="فصل ۱"
      theme="dark"
      readingDirection="rtl"
      ensureChapter={async () => null}
    />,
  );

  assert.match(html, /data-manga-page-editor="new"/);
  assert.match(html, /افزودن صفحه‌ها/);
  // With no chapter yet, the editor explains that the first upload creates it.
  assert.match(html, /پس از افزودن نخستین صفحه/);
});

test("the page writer renumbers atomically and keeps derived state correct", () => {
  const source = readFileSync(new URL("../server/utils/manga.ts", import.meta.url), "utf8");

  // Reordering swaps page numbers between existing rows, so every row is parked
  // above an offset before being written to its final position: a single-phase
  // update would trip the (chapter_id, page_number) unique index mid-statement.
  assert.match(source, /PAGE_NUMBER_PARK_OFFSET/);
  assert.match(source, /page_number = page_number - \$2/);
  // The whole rewrite is one transaction.
  assert.match(source, /db\.withTransaction/);
  assert.match(source, /FOR UPDATE/);
  // Removing a page frees its upload, and the denormalised count is maintained.
  assert.match(source, /releaseUnreferencedNovelFiles/);
  assert.match(source, /UPDATE chapters SET page_count/);
});

test("manga page endpoints require ownership and reject prose novels", () => {
  const route = readFileSync(new URL("../server/api/routes/manga.ts", import.meta.url), "utf8");

  assert.match(route, /NOT_A_MANGA/);
  assert.match(route, /فقط نویسنده یا تیم تحریریه/);
  assert.match(route, /requireVerifiedEmailForWriting/);
  assert.match(route, /publishing_blocked/);
  // Reads go through the same visibility rules as prose chapters.
  assert.match(route, /canUserViewNovel/);
  assert.match(route, /isChapterVisibleToUser/);
});

test("an empty manga chapter cannot be published", () => {
  const api = readFileSync(new URL("../server/api/index.ts", import.meta.url), "utf8");
  assert.match(api, /MANGA_CHAPTER_EMPTY/);
  // The work's kind is immutable once created.
  assert.match(api, /NOVEL_KIND_IMMUTABLE/);
});

test("the work kind is persisted and surfaced to the client", () => {
  const api = readFileSync(new URL("../server/api/index.ts", import.meta.url), "utf8");
  assert.match(api, /content_kind: resolvedContentKind/);
  assert.match(api, /reading_direction: resolvedReadingDirection/);
  assert.match(api, /contentKind: novelContentKind/);
  assert.match(api, /readingDirection: normalizeReadingDirection/);
});

test("manga page scans get their own upload ceiling, and only when owned", () => {
  const upload = readFileSync(new URL("../server/api/routes/upload.ts", import.meta.url), "utf8");
  const limiters = readFileSync(new URL("../server/api/limiters.ts", import.meta.url), "utf8");

  // The larger ceiling requires both an explicit purpose and a manga the caller
  // owns; the declared purpose alone must never widen the limit.
  assert.match(upload, /const isMangaPageUpload = quotaIsManga && requestedPurpose === "manga-page"/);
  assert.match(upload, /maxImageBytes: isMangaPageUpload \? MANGA_PAGE_MAX_BYTES : undefined/);
  assert.match(upload, /MANGA_PAGE_DIMENSIONS/);

  // A chapter is dozens of scans, so page uploads use a bulk request-rate
  // bucket. Byte quotas and the malware scan are unaffected by the bucket.
  assert.match(limiters, /mangaPageUploadLimiter/);
  assert.match(upload, /function imageUploadLimiter/);
  assert.match(upload, /router\.post\("\/upload", \[imageUploadLimiter/);
  assert.match(upload, /scanForMalware\(buffer, originalname\)/);
  // Claiming the bulk bucket without owning a manga fails, so the looser
  // request-rate allowance cannot be repurposed for ordinary uploads.
  assert.match(upload, /MANGA_PAGE_PURPOSE_INVALID/);
});

test("deleting a manga frees its page scans", () => {
  const deletion = readFileSync(new URL("../server/utils/novelDeletion.ts", import.meta.url), "utf8");
  const media = readFileSync(new URL("../server/utils/mediaLifecycle.ts", import.meta.url), "utf8");

  assert.match(deletion, /deleteWhere\("manga_pages", "novel_id", id\)/);
  // A page shared with another manga must not be unlinked.
  assert.match(deletion, /FROM manga_pages WHERE image_url LIKE ANY/);
  assert.match(media, /FROM manga_pages page/);
});

test("the footer carries the maker credit and a year that cannot go stale", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(app, /ساخته شده با <span role="img" aria-label="عشق">❤️<\/span> توسط یک دیوار/);
  // A hard-coded year silently becomes wrong every January.
  assert.match(app, /© \{new Date\(\)\.getFullYear\(\)\} رپتوک/);
  assert.doesNotMatch(app, /© 20\d\d رپتوک/);
  // The splash build stamp is derived, not frozen at a past date.
  assert.match(app, /const BUILD_STAMP = new Date\(\)/);
  assert.doesNotMatch(app, /نسخه ساخت 20\d\d\.\d\d\.\d\d/);
});

test("the brand is spelled one way everywhere, with no misspelled variant left", () => {
  const roots = ["src", "server", "shared", "tests"];
  const ACCEPTED_BRAND = "\u0631\u067E\u062A\u0648\u06A9";
  const brandVariant = /ر[\u0620-\u064A\u066E-\u06D3]{0,3}ت[\u0648\u0624]\s?[\u06A9\u0643]/g;
  const offenders: string[] = [];

  const walk = (directory: URL) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      if (!/\.(ts|tsx|css|html)$/.test(entry.name)) continue;
      const text = readFileSync(child, "utf8");
      for (const match of text.match(brandVariant) || []) {
        // "رپتوک" is the only accepted spelling; anything else this pattern can
        // reach (a different Yeh/Kaf codepoint, a missing Peh) is a typo.
        if (match !== ACCEPTED_BRAND) offenders.push(`${child.pathname}: ${match}`);
      }
    }
  };
  for (const root of roots) walk(new URL(`../${root}/`, import.meta.url));

  assert.deepEqual(offenders, []);
});

test("moderators review manga pages instead of an empty prose pane", () => {
  const route = readFileSync(new URL("../server/api/routes/editor.ts", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/components/EditorPanel.tsx", import.meta.url), "utf8");

  // The review payload carries the pages, so a manga chapter is reviewable.
  assert.match(route, /const mangaPages = contentKind === "manga" \? await loadChapterPages\(chapterId\) : \[\]/);
  assert.match(route, /pages: mangaPages/);
  // `null` means prose; an empty array is a manga chapter with no pages yet.
  assert.match(panel, /const reviewMangaPages: MangaPage\[\] \| null/);
  assert.match(panel, /<MangaReader/);
});

test("catalogue surfaces flag a comic before the reader opens it", () => {
  const dashboard = readFileSync(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf8");
  const discover = readFileSync(new URL("../src/components/Discover.tsx", import.meta.url), "utf8");

  for (const source of [dashboard, discover]) {
    assert.match(source, /isMangaWork\(novel\)/);
    assert.match(source, /مانگا/);
  }
});
