import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeMarkdown, markdownToTiptapContent } from "../src/utils/markdownPaste";

test("Markdown paste detection ignores ordinary chapter prose", () => {
  assert.equal(looksLikeMarkdown("A quiet paragraph.\nAnother ordinary line."), false);
  assert.equal(looksLikeMarkdown("# Chapter One\n\nA **bold** opening."), true);
  assert.equal(looksLikeMarkdown("Visit [the archive](https://example.test/archive)."), true);
});

test("Markdown paste becomes rich Tiptap block and inline content", () => {
  const content = markdownToTiptapContent([
    "# Chapter One",
    "",
    "The **bold** and *italic* [traveler](https://example.test/traveler) arrived.",
    "",
    "> A quoted **warning**.",
    "",
    "- First item",
    "- Second `coded` item",
    "",
    "3. Third",
    "4. Fourth",
  ].join("\n"));

  assert.equal(content[0].type, "heading");
  assert.deepEqual(content[0].attrs, { level: 1 });
  assert.equal(content[1].type, "paragraph");
  assert.ok(content[1].content?.some((node) => node.text === "bold" && node.marks?.some((mark) => mark.type === "bold")));
  assert.ok(content[1].content?.some((node) => node.text === "italic" && node.marks?.some((mark) => mark.type === "italic")));
  assert.ok(content[1].content?.some((node) => node.text === "traveler" && node.marks?.some((mark) => mark.type === "link" && mark.attrs?.href === "https://example.test/traveler")));
  assert.equal(content[2].type, "blockquote");
  assert.equal(content[3].type, "bulletList");
  assert.equal(content[3].content?.length, 2);
  assert.equal(content[4].type, "orderedList");
  assert.deepEqual(content[4].attrs, { start: 3 });
});

test("Markdown paste supports fenced code and rejects unsafe link marks", () => {
  const content = markdownToTiptapContent("```ts\nconst answer = 42;\n```\n\n[unsafe](javascript:alert(1))");
  assert.deepEqual(content[0], {
    type: "codeBlock",
    content: [{ type: "text", text: "const answer = 42;" }],
  });
  assert.equal(content[1].type, "paragraph");
  assert.equal(content[1].content?.some((node) => node.marks?.some((mark) => mark.type === "link")), false);
});
