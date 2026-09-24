import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ParagraphCommentPanel, {
  PARAGRAPH_COMMENT_FOCUS_OPTIONS,
} from "../src/components/ParagraphCommentPanel";

test("paragraph comment composer is inline, responsive, and preserves scroll while focusing", () => {
  const html = renderToStaticMarkup(
    <ParagraphCommentPanel
      novelId="novel-1"
      chapterId="chapter-1"
      paragraphId="paragraph-2"
      paragraphNumber={2}
      currentUser={{ id: "reader-1" }}
      onClose={() => {}}
      onCountChange={() => {}}
    />,
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, /class="[^"]*\brelative\b[^"]*\bmt-3\b/);
  assert.doesNotMatch(html, /class="[^"]*\bfixed\b/);
  assert.match(html, /id="paragraph-comment-draft"/);
  assert.match(html, />پاراگراف 2</);
  assert.deepEqual(PARAGRAPH_COMMENT_FOCUS_OPTIONS, { preventScroll: true });
});
