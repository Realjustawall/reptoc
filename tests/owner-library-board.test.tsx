import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OwnerLibraryBoard from "../src/components/admin/OwnerLibraryBoard";
import type { Novel } from "../src/types";

function novel(overrides: Partial<Novel> & { id: string; title: string }): Novel {
  return {
    author: "نویسنده", description: "", genre: "فانتزی", cover: "/uploads/c.webp",
    rating: 4.5, bookmarksCount: 0, viewsCount: 1200, createdAt: "2026-01-01",
    chapters: [], reviews: [], approvalStatus: "approved", ...overrides,
  } as Novel;
}

test("owner board renders totals, search, filters and per-row moderation", () => {
  const html = renderToStaticMarkup(
    <OwnerLibraryBoard
      novels={[
        novel({ id: "n1", title: "رمان تأییدشده" }),
        novel({ id: "n2", title: "در انتظار", approvalStatus: "pending_approval" }),
        novel({ id: "n3", title: "مانگا", contentKind: "manga" } as any),
      ]}
      theme="dark"
      borderClass="border-x" cardClass="card-x" shadowClass="shadow-x" controlClass="ctrl-x"
      selectStyle={{}}
      onApprove={() => {}} onReject={() => {}} onDelete={() => {}}
    />,
  );
  assert.match(html, /data-owner-library-board/);
  assert.match(html, /کل آثار/);
  assert.match(html, /در انتظار بررسی/);
  assert.match(html, /aria-label="جست‌وجو در کتابخانه"/);
  assert.match(html, /aria-label="ترتیب فهرست"/);
  assert.match(html, /مانگا/);
  assert.match(html, /رد \/ یادداشت/);
  assert.match(html, /aria-label="حذف رمان تأییدشده"/);
});

test("an empty library explains itself instead of showing a bare table", () => {
  const html = renderToStaticMarkup(
    <OwnerLibraryBoard
      novels={[]} theme="dark"
      borderClass="b" cardClass="c" shadowClass="s" controlClass="ct" selectStyle={{}}
      onApprove={() => {}} onReject={() => {}} onDelete={() => {}}
    />,
  );
  assert.match(html, /هنوز اثری در کتابخانه ثبت نشده است/);
});

test("the owner dashboard gives user management the full width", () => {
  const panel = readFileSync(new URL("../src/components/AuthorityCenter.tsx", import.meta.url), "utf8");

  // The role editor, bulk toolbar and user rows used to be crushed into a 5-of-12
  // sidebar next to the library table, which is what pushed their controls
  // outside the card. Both sections are full width and stacked now.
  assert.doesNotMatch(panel, /2xl:col-span-5/);
  assert.doesNotMatch(panel, /activeSegment === "users" \? "2xl:col-span-12"/);
  assert.match(panel, /Both sections span the full width and stack/);
});

test("bulk user controls are labelled and paired with their action button", () => {
  const panel = readFileSync(new URL("../src/components/AuthorityCenter.tsx", import.meta.url), "utf8");

  // Unlabelled selects in one long flex row were impossible to tell apart and
  // overflowed on anything narrower than a desktop.
  assert.match(panel, /aria-label="نقش گروهی"/);
  assert.match(panel, /aria-label="دستاورد گروهی"/);
  assert.match(panel, /aria-label="عملیات گروهی پرمیوم"/);
  assert.match(panel, /وضعیت پرمیوم/);
  assert.match(panel, /منبع دسترسی/);
});

test("long permission keys and user metadata wrap instead of escaping their card", () => {
  const panel = readFileSync(new URL("../src/components/AuthorityCenter.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

  // A truncated permission key is ambiguous; it now wraps in full.
  assert.match(panel, /break-all font-mono leading-relaxed/);
  // Account facts are chips, not one unbreakable pipe-joined sentence.
  assert.doesNotMatch(panel, /بدون نام مستعار"} \| \{user\.phone/);
  // RTL: `text-left` and physical margins fought the layout direction.
  assert.match(css, /\.authority-panel \.text-left \{\s*text-align: start;/);
  assert.doesNotMatch(panel, /className="w-4 h-4 mr-2"/);
});
