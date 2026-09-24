import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Reader from "../src/components/Reader";
import type { Chapter, Novel } from "../src/types";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("story and chapter protection are stored and exposed end to end", () => {
  const migration = read("migrations/081_content_protection.sql");
  const server = read("server/api/index.ts");
  const api = read("src/utils/api.ts");
  const writer = read("src/components/Writer.tsx");

  assert.match(migration, /ALTER TABLE novels ADD COLUMN IF NOT EXISTS prevent_copy/);
  assert.match(migration, /ALTER TABLE chapters ADD COLUMN IF NOT EXISTS prevent_screenshot/);
  assert.match(server, /prevent_copy: req\.body\.preventCopy/);
  assert.match(server, /preventScreenshot: chapter\.prevent_screenshot === true/);
  assert.match(api, /preventCopy: novel\.preventCopy === true/);
  assert.match(writer, /محافظت محتوای کل داستان/);
  assert.match(writer, /محافظت اختصاصی این فصل/);
  assert.match(writer, /قفل کپی این فصل/);
  assert.match(writer, /id: "security", label: "ضد کپی"/);
  assert.match(writer, /فعال‌کردن ضد کپی برای کل داستان/);
  assert.match(writer, /قفل جداگانهٔ فصل‌ها/);
  assert.match(writer, /saveStoryProtection/);
  assert.match(writer, /saveChapterProtection/);
  assert.match(writer, /مسدودسازی صددرصدی سیستم‌عامل نیست/);
});

test("protected reader disables selection and renders an identified watermark", () => {
  const chapter: Chapter = {
    id: "protected-chapter",
    novelId: "protected-novel",
    title: "فصل محافظت‌شده",
    content: "<p>متن محافظت‌شده</p>",
    chapterNumber: 1,
    createdAt: "2026-09-06",
    wordCount: 2,
    preventCopy: true,
    preventScreenshot: true,
  };
  const novel = {
    id: "protected-novel",
    title: "داستان محافظت‌شده",
    author: "نویسنده",
    chapters: [chapter],
    reviews: [],
  } as Novel;
  const html = renderToStaticMarkup(
    <Reader
      novel={novel}
      chapter={chapter}
      currentUser={{ username: "reader-watermark" }}
      onBackToNovel={() => {}}
      onNavigateChapter={() => {}}
      onUpdateScroll={() => {}}
      theme="dark"
    />,
  );
  const reader = read("src/components/Reader.tsx");
  const css = read("src/index.css");

  assert.match(html, /reader-copy-protected/);
  assert.match(html, /reader-content-protected/);
  assert.match(html, /reader-protected-prose/);
  assert.match(html, /reader-watermark/);
  assert.match(reader, /addEventListener\("copy"/);
  assert.match(reader, /addEventListener\("contextmenu"/);
  assert.match(reader, /event\.key === "PrintScreen"/);
  assert.match(css, /-webkit-touch-callout: none/);
  assert.match(css, /@media print/);
});
