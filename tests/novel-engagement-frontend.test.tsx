import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthorLinkBoxes } from "../src/components/AuthorLinksDisplay";
import { applyChapterLikeToNovel } from "../src/utils/novelEngagement";
import type { Novel } from "../src/types";

test("chapter like updates remain visible when returning to the novel page", () => {
  const novel = {
    id: "novel-1",
    likesCount: 2,
    chapters: [
      { id: "chapter-1", likesCount: 0 },
      { id: "chapter-3", likesCount: 0, likedByCurrentUser: false },
    ],
  } as Novel;

  const updated = applyChapterLikeToNovel(novel, "chapter-3", true, 1, 3);
  assert.equal(updated.likesCount, 3);
  assert.equal(updated.chapters[1].likesCount, 1);
  assert.equal(updated.chapters[1].likedByCurrentUser, true);
  assert.equal(novel.likesCount, 2, "the state helper does not mutate the previous render");

  const unchanged = applyChapterLikeToNovel(updated, "chapter-3", true, 1, 3);
  assert.equal(unchanged, updated, "identical server like state preserves the active novel render identity");
});

test("public Patreon and social boxes render on novel and chapter surfaces", () => {
  const links = [
    { id: "patreon-1", platform: "patreon", label: "Support on Patreon", url: "https://patreon.com/example" },
    { id: "instagram-1", platform: "instagram", label: "Instagram", url: "https://instagram.com/example" },
  ];
  const novelHtml = renderToStaticMarkup(<AuthorLinkBoxes links={links} authorName="Author" placement="novel" />);
  const chapterHtml = renderToStaticMarkup(<AuthorLinkBoxes links={links} authorName="Author" placement="chapter" />);

  assert.match(novelHtml, /data-author-links="novel"/);
  assert.match(novelHtml, /data-author-link-platform="patreon"/);
  assert.match(chapterHtml, /data-author-links="chapter"/);
  assert.match(chapterHtml, /حمایت از Author/);
  assert.equal(renderToStaticMarkup(<AuthorLinkBoxes links={[]} authorName="Author" />), "");
});
