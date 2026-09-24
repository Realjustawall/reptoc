import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Reader from "../src/components/Reader";
import type { Chapter, Novel } from "../src/types";

test("mobile reader controls use clear labels and touch-sized buttons", () => {
  const chapter: Chapter = {
    id: "chapter-1",
    novelId: "novel-1",
    title: "A Clear Mobile Chapter",
    content: "<p>Reader content.</p>",
    chapterNumber: 1,
    createdAt: "2026-07-27",
    wordCount: 2,
  };
  const novel = {
    id: "novel-1",
    title: "Mobile Reader Test",
    author: "Author",
    authorUsername: "Author",
    chapters: [chapter],
    reviews: [],
  } as Novel;

  const html = renderToStaticMarkup(
    <Reader
      novel={novel}
      chapter={chapter}
      onBackToNovel={() => {}}
      onNavigateChapter={() => {}}
      onUpdateScroll={() => {}}
      theme="dark"
    />,
  );

  assert.match(html, />همرسانی</);
  assert.match(html, />فصل‌ها</);
  assert.match(html, />تنظیمات</);
  assert.match(html, />آفلاین</);
  assert.match(html, /aria-label="باز کردن فهرست فصل‌ها"/);
  assert.match(html, /aria-label="باز کردن تنظیمات خواندن"/);
  assert.ok((html.match(/min-h-11/g) || []).length >= 4);
  assert.match(html, /grid-cols-5/);
  assert.match(html, /translate="yes"/);
  assert.match(html, /<article[^>]*class="[^"]*select-text/);
  assert.match(html, /data-stable-chapter-heading="1"/);
  assert.match(html, /data-stable-chapter-story="chapter-1:22"/);
  assert.match(html, /data-reader-static-text="paragraph"[\s\S]*>R<\/span>eader content\./);
  assert.doesNotMatch(html, /reader-copy-protected/);

  const readerSource = readFileSync(new URL("../src/components/Reader.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(readerSource, /dangerouslySetInnerHTML/);
  assert.match(readerSource, /const StableChapterStory = React\.memo/);
  assert.match(readerSource, /export default React\.memo\(Reader\)/);
});

test("professional focus mode keeps a visible exit and real reading progress", () => {
  const readerSource = readFileSync(new URL("../src/components/Reader.tsx", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  assert.match(readerSource, /ورود به حالت مطالعه بدون حواس‌پرتی/);
  assert.match(readerSource, /خروج از حالت تمرکز/);
  assert.match(readerSource, /visibleProgress/);
  assert.match(readerSource, /event\.key === "Escape"/);
  assert.match(appSource, /app-footer/);
  assert.match(css, /reader-focus-active/);
  assert.match(readerSource, /reader-book-fullscreen/);
  assert.match(css, /reader-book-fullscreen/);
  assert.match(css, /--reader-line-step/);
  assert.match(readerSource, /اندازه کتاب/);
  assert.match(readerSource, /عرض کتاب در صفحه خواننده/);
  assert.match(readerSource, /ارتفاع کتاب در صفحه خواننده/);
  assert.match(readerSource, /--reader-book-width/);
  assert.match(css, /var\(--reader-book-width/);
  assert.match(css, /var\(--reader-book-height/);
});
