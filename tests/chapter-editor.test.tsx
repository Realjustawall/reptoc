import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TiptapEditor, {
  CANVAS_FONT_SIZE_RANGE,
  CANVAS_LINE_HEIGHT_RANGE,
  DEFAULT_CANVAS_PREFERENCES,
  IMAGE_MAX_PIXELS,
  IMAGE_MIN_PIXELS,
  buildEditorOutline,
  clampImageWidth,
  EDITOR_IMAGE_MAX_BYTES,
  EDITOR_IMAGE_MIME_TYPES,
  findMatchesInDoc,
  IMAGE_WIDTHS,
  estimatedReadingMinutes,
  isDisplayableImageSource,
  normalizeCanvasPreferences,
  validateEditorImage,
} from "../src/components/TiptapEditor";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { sanitizeStoryHtml } from "../server/utils/content";
import { normalizeStoredImageReference } from "../server/utils/images";

test("only supported image formats under the size cap reach the upload endpoint", () => {
  assert.equal(validateEditorImage({ type: "image/png", size: 1024 }), null);
  assert.equal(validateEditorImage({ type: "image/webp", size: EDITOR_IMAGE_MAX_BYTES }), null);
  assert.equal(validateEditorImage({ type: "image/svg+xml", size: 1024 })?.reason, "type");
  assert.equal(validateEditorImage({ type: "application/pdf", size: 1024 })?.reason, "type");
  assert.equal(validateEditorImage({ type: "image/png", size: EDITOR_IMAGE_MAX_BYTES + 1 })?.reason, "size");
  // SVG can carry script payloads and is deliberately excluded.
  assert.ok(!(EDITOR_IMAGE_MIME_TYPES as readonly string[]).includes("image/svg+xml"));
});

test("image sources are limited to HTTPS and Reptoc-hosted uploads", () => {
  assert.equal(isDisplayableImageSource("/uploads/story-1.webp"), true);
  assert.equal(isDisplayableImageSource("/api/files/abc-1/content"), true);
  assert.equal(isDisplayableImageSource("/api/upload/abc-1/content"), true);
  assert.equal(isDisplayableImageSource("https://cdn.example.test/a.png"), true);
  assert.equal(isDisplayableImageSource("http://cdn.example.test/a.png"), false);
  assert.equal(isDisplayableImageSource("javascript:alert(1)"), false);
  assert.equal(isDisplayableImageSource("data:image/png;base64,AAAA"), false);
  assert.equal(isDisplayableImageSource(""), false);
});

test("illustration layout survives the chapter sanitizer as inert data attributes", () => {
  const authored = '<p>متن</p><img src="/uploads/scene.webp" alt="صحنه" data-width="medium" data-align="start">';
  const stored = sanitizeStoryHtml(authored);

  assert.match(stored, /data-width="medium"/);
  assert.match(stored, /data-align="start"/);
  assert.match(stored, /loading="lazy"/);
  assert.match(stored, /alt="صحنه"/);
  // Styles never survive, which is why sizing is expressed as a data attribute.
  assert.doesNotMatch(stored, /style=/);

  // Unknown values fall back to the safe default rather than being echoed.
  const tampered = sanitizeStoryHtml('<img src="/uploads/a.webp" data-width="9999px" data-align="../etc">');
  assert.match(tampered, /data-width="full"/);
  assert.match(tampered, /data-align="center"/);
});

test("the sanitizer keeps every width key the editor can produce", () => {
  for (const key of Object.keys(IMAGE_WIDTHS)) {
    const stored = sanitizeStoryHtml(`<img src="/uploads/a.webp" data-width="${key}">`);
    assert.match(stored, new RegExp(`data-width="${key}"`));
  }
});

test("chapter markup keeps safe links and drops dangerous ones", () => {
  const stored = sanitizeStoryHtml('<a href="https://reptoc.ir/novels/x">فصل</a><a href="javascript:alert(1)">بد</a>');
  assert.match(stored, /<a href="https:\/\/reptoc\.ir\/novels\/x" target="_blank" rel="noopener noreferrer">/);
  assert.doesNotMatch(stored, /javascript:/);
});

test("script and style payloads never reach a published chapter", () => {
  const stored = sanitizeStoryHtml('<p>ok</p><script>alert(1)</script><img src="/uploads/a.webp" onerror="alert(1)">');
  assert.doesNotMatch(stored, /<script/i);
  assert.doesNotMatch(stored, /onerror/i);
  assert.match(stored, /<p>ok<\/p>/);
});

test("uploaded chapter illustrations resolve through the stored-reference normalizer", () => {
  assert.equal(normalizeStoredImageReference("/uploads/story-1.webp"), "/uploads/story-1.webp");
  assert.equal(normalizeStoredImageReference("/api/upload/abc-1/content"), "/api/upload/abc-1/content");
  assert.equal(normalizeStoredImageReference("/api/files/abc-1/content"), "/api/files/abc-1/content");
  assert.throws(() => normalizeStoredImageReference("blob:https://reptoc.ir/1"), /blob/);
});

test("reading time is derived from the live word count", () => {
  assert.equal(estimatedReadingMinutes(0), 0);
  assert.equal(estimatedReadingMinutes(-5), 0);
  assert.equal(estimatedReadingMinutes(50), 1);
  assert.equal(estimatedReadingMinutes(400), 2);
  assert.equal(estimatedReadingMinutes(2000), 10);
});

test("the editor uploads illustrations as public files and follows the page direction", () => {
  const source = readFileSync(new URL("../src/components/TiptapEditor.tsx", import.meta.url), "utf8");

  // Private uploads resolve to an authenticated URL and would render as a
  // broken image for readers.
  assert.match(source, /fields:\s*\{\s*visibility:\s*"public"\s*\}/);
  // Persian is right-to-left; the old editor hard-coded dir="ltr".
  assert.match(source, /direction\s*=\s*"rtl"/);
  assert.doesNotMatch(source, /dir="ltr"/);
  // Paste and drop both accept images.
  assert.match(source, /handlePaste/);
  assert.match(source, /handleDrop/);
  // External content replacement must not echo back as an unsaved edit.
  assert.match(source, /setContent\(incoming,\s*\{\s*emitUpdate:\s*false\s*\}\)/);
});

test("the writing workspace never autosaves an unhydrated chapter body", () => {
  const writer = readFileSync(new URL("../src/components/Writer.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  // The catalogue feed strips chapter bodies; saving that blank canvas back
  // would erase the author's real text.
  assert.match(writer, /activeNovelChaptersHydrated/);
  assert.match(writer, /if \(!activeNovelChaptersHydrated\) return;/);
  assert.match(writer, /readOnly=\{!activeNovelChaptersHydrated\}/);
  // The workspace hydrates owned novels with the full payload on entry.
  assert.match(app, /activeView !== "writer"/);
  assert.match(app, /catalogueOnly/);
  // The workspace follows the site's right-to-left direction.
  assert.match(writer, /<div className=\{`space-y-8 pb-16/);
  assert.match(writer, /dir="rtl"/);
});

test("no advertisement surface remains anywhere in the client", () => {
  // Advertising was removed platform-wide: no slots, no provider, no admin
  // panel, and no ad-blocked iframe left to paint a white rectangle.
  for (const file of ["Dashboard.tsx", "NovelDetails.tsx", "Reader.tsx"]) {
    const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /AdSlot|advertisement/i, `${file} still references advertising`);
  }
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /Advertisement|advertisements/);
  assert.doesNotMatch(main, /AdvertisementProvider|legacyAdCleanup/);
});

test("the editor renders an accessible placeholder before the client takes over", () => {
  // `immediatelyRender: false` keeps Tiptap from measuring a zero-size
  // container inside the animated workspace panel, so the first paint is the
  // placeholder below rather than a crash.
  const markup = renderToStaticMarkup(
    React.createElement(TiptapEditor, { content: "<p>سلام</p>", onChange: () => {}, theme: "dark" }),
  );
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /aria-label="در حال آماده‌سازی ویرایشگر"/);
});

test("the editor schema provides every node and mark the toolbar exposes", () => {
  // Guards against a Tiptap upgrade quietly dropping an extension the toolbar
  // still offers, which would leave a button that silently does nothing.
  const ChapterImage = Image.extend({
    name: "image",
    addAttributes() {
      return { ...this.parent?.(), displayWidth: { default: "full" }, alignment: { default: "center" } };
    },
  }).configure({ inline: false, allowBase64: false });

  const schema = getSchema([StarterKit, ChapterImage, Placeholder, CharacterCount]);

  for (const node of ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "horizontalRule", "image"]) {
    assert.ok(schema.nodes[node], `missing node: ${node}`);
  }
  for (const mark of ["bold", "italic", "underline", "strike", "link"]) {
    assert.ok(schema.marks[mark], `missing mark: ${mark}`);
  }

  const imageAttributes = Object.keys(schema.nodes.image.spec.attrs || {});
  assert.ok(imageAttributes.includes("displayWidth"));
  assert.ok(imageAttributes.includes("alignment"));
});

test("autosave covers every chapter status and never silently unpublishes", () => {
  const writer = readFileSync(new URL("../src/components/Writer.tsx", import.meta.url), "utf8");

  // Autosave used to bail out unless the chapter was a draft, so every edit to
  // a published chapter was lost when the tab closed.
  assert.doesNotMatch(writer, /if \(chStatus !== "Draft"\) return;/);
  // ...and it must persist the real status, not force "Draft".
  assert.doesNotMatch(writer, /status: "Draft",\n\s+isAuxiliary: isAuxiliaryChapter,/);
  assert.match(writer, /status: chStatus,/);
});

test("the workspace warns about unsaved work and supports Ctrl+S", () => {
  const writer = readFileSync(new URL("../src/components/Writer.tsx", import.meta.url), "utf8");

  assert.match(writer, /addEventListener\("beforeunload", warn\)/);
  assert.match(writer, /hasUnsavedChanges/);
  assert.match(writer, /event\.key\.toLowerCase\(\) !== "s"/);
  // A failed write must not be reported as saved.
  assert.match(writer, /setSaveState\("failed"\)/);
  assert.match(writer, /aria-live="polite"/);
});

test("the authoring stack is code-split out of the reader bundle", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  // Writer pulls in Tiptap and recharts; readers must not download it.
  assert.match(app, /const Writer = lazy\(\(\) => import\("\.\/components\/Writer"\)\);/);
  assert.doesNotMatch(app, /^import Writer from/m);
});

test("the workspace uses logical text alignment under RTL", () => {
  const writer = readFileSync(new URL("../src/components/Writer.tsx", import.meta.url), "utf8");

  // `text-left` fought the RTL container and depended on a global override.
  assert.doesNotMatch(writer, /text-left/);
});

test("lazy route chunks fail loudly instead of blanking the page", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const boundary = readFileSync(new URL("../src/components/LazyRouteBoundary.tsx", import.meta.url), "utf8");

  // A bare <Suspense> around React.lazy unmounts the tree when the chunk
  // rejects, which is exactly what happens to a tab still running the previous
  // build after a deployment: the old hashed filename now 404s.
  assert.doesNotMatch(app, /<Suspense\b/);
  assert.match(app, /<LazyRouteBoundary label="کارگاه نویسنده"/);
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /Failed to fetch dynamically imported module/);
  // Recovery reloads at most once so a persistent failure cannot loop.
  assert.match(boundary, /sessionStorage/);
  assert.match(boundary, /if \(!alreadyReloaded\) window\.location\.reload\(\)/);
});

test("a dragged image width is clamped to a sane range", () => {
  assert.equal(clampImageWidth(500), 500);
  assert.equal(clampImageWidth(10), IMAGE_MIN_PIXELS);
  assert.equal(clampImageWidth(99999), IMAGE_MAX_PIXELS);
  assert.equal(clampImageWidth("420"), 420);
  assert.equal(clampImageWidth("abc"), null);
  assert.equal(clampImageWidth(0), null);
  assert.equal(clampImageWidth(-5), null);
  assert.equal(clampImageWidth(null), null);
});

test("images can be dragged and resized, and the width survives the sanitizer", () => {
  const source = readFileSync(new URL("../src/components/TiptapEditor.tsx", import.meta.url), "utf8");

  // Corner handles come from Tiptap's ResizableNodeView; the committed size is
  // written back to the node so it round-trips as a plain width attribute.
  assert.match(source, /new ResizableNodeView\(/);
  assert.match(source, /preserveAspectRatio: true/);
  assert.match(source, /draggable: true/);
  assert.match(source, /updateAttributes\("image", \{ width: next \}\)/);

  // A width attribute must survive to the published chapter.
  const stored = sanitizeStoryHtml('<img src="/uploads/a.webp" width="640" data-width="medium">');
  assert.match(stored, /width="640"/);
  assert.match(stored, /data-width="medium"/);

  // Both the editor and the reader let an explicit width win over the preset.
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  assert.match(css, /img\[width\]/);
  assert.match(source, /img\[width\] \{ width: auto/);
});

test("choosing a size preset clears a previously dragged width", () => {
  const source = readFileSync(new URL("../src/components/TiptapEditor.tsx", import.meta.url), "utf8");
  // Otherwise the explicit pixel width keeps winning and the preset button
  // silently does nothing.
  assert.match(source, /attributes\.displayWidth !== undefined && attributes\.width === undefined/);
  assert.match(source, /\{ \.\.\.attributes, width: null \}/);
});

test("focus mode presents a page-like writing sheet", () => {
  const source = readFileSync(new URL("../src/components/TiptapEditor.tsx", import.meta.url), "utf8");
  assert.match(source, /reptoc-page-sheet/);
  assert.match(source, /max-width: 820px/);
  assert.match(source, /writer-book-fullscreen/);
  assert.match(source, /نوع کاغذ و خط‌بندی/);
  assert.match(source, /نمای دوصفحه‌ای/);
  assert.match(source, /شماره صفحه/);
});

/**
 * Build a document with the editor's own schema.
 *
 * Nodes are constructed directly rather than parsed from an HTML string: these
 * tests run in Node, which has no DOM, and building from the schema also proves
 * the outline/search helpers work on the real node types the editor produces.
 */
function buildEditorDoc(blocks: Array<{ type: "paragraph" | "heading" | "hr"; text?: string; level?: 1 | 2 | 3 }>) {
  const schema = getSchema([StarterKit, Image, Placeholder, CharacterCount]);
  const nodes = blocks.map((block) => {
    if (block.type === "hr") return schema.nodes.horizontalRule.create();
    const content = block.text ? schema.text(block.text) : undefined;
    if (block.type === "heading") {
      return schema.nodes.heading.create({ level: block.level || 1 }, content);
    }
    return schema.nodes.paragraph.create(null, content);
  });
  return schema.nodes.doc.create(null, nodes);
}

test("the chapter outline lists headings and scene dividers with section word counts", () => {
  const doc = buildEditorDoc([
    { type: "heading", level: 1, text: "بخش یک" },
    { type: "paragraph", text: "یک دو سه" },
    { type: "heading", level: 2, text: "صحنه" },
    { type: "paragraph", text: "چهار پنج" },
    { type: "hr" },
    { type: "paragraph", text: "شش" },
  ]);
  const outline = buildEditorOutline(doc);

  assert.deepEqual(outline.map((entry) => entry.level), [1, 2, 0]);
  assert.deepEqual(outline.map((entry) => entry.text), ["بخش یک", "صحنه", "جداکنندهٔ صحنه"]);
  // Words are attributed to the section they follow, which is what tells an
  // author a scene has run long.
  assert.deepEqual(outline.map((entry) => entry.words), [3, 2, 1]);
  // Positions are document positions, so jumping to one is exact.
  assert.ok(outline[0].position < outline[1].position);
});

test("prose with no headings produces an empty outline rather than a fake one", () => {
  assert.deepEqual(buildEditorOutline(buildEditorDoc([{ type: "paragraph", text: "فقط متن" }])), []);
});

test("find locates every occurrence as exact document positions", () => {
  const doc = buildEditorDoc([
    { type: "paragraph", text: "باران بارید" },
    { type: "paragraph", text: "باران ایستاد" },
  ]);
  const matches = findMatchesInDoc(doc, "باران", false);

  assert.equal(matches.length, 2);
  for (const match of matches) {
    assert.equal(doc.textBetween(match.from, match.to), "باران");
  }
  // Positions must be usable for replacement, so they never overlap.
  assert.ok(matches[0].to <= matches[1].from);
});

test("find honours the case-sensitivity toggle and ignores an empty query", () => {
  const doc = buildEditorDoc([{ type: "paragraph", text: "Rain rain RAIN" }]);
  assert.equal(findMatchesInDoc(doc, "rain", false).length, 3);
  assert.equal(findMatchesInDoc(doc, "rain", true).length, 1);
  assert.equal(findMatchesInDoc(doc, "", false).length, 0);
  assert.equal(findMatchesInDoc(doc, "missing", false).length, 0);
});

test("canvas typography preferences are clamped before being applied", () => {
  assert.deepEqual(normalizeCanvasPreferences(null), DEFAULT_CANVAS_PREFERENCES);
  assert.equal(normalizeCanvasPreferences({ fontSize: 999 }).fontSize, CANVAS_FONT_SIZE_RANGE.max);
  assert.equal(normalizeCanvasPreferences({ fontSize: 2 }).fontSize, CANVAS_FONT_SIZE_RANGE.min);
  assert.equal(normalizeCanvasPreferences({ lineHeight: 99 }).lineHeight, CANVAS_LINE_HEIGHT_RANGE.max);
  assert.equal(normalizeCanvasPreferences({ font: "serif" }).font, "serif");
  assert.equal(normalizeCanvasPreferences({ font: "comic" as any }).font, "estedad");
  assert.equal(normalizeCanvasPreferences({ spotlight: true }).spotlight, true);
  // The page view is on unless it is explicitly turned off.
  assert.equal(normalizeCanvasPreferences({}).pageView, true);
  assert.equal(normalizeCanvasPreferences({ pageView: false }).pageView, false);
  assert.equal(normalizeCanvasPreferences({}).paperStyle, "ruled");
  assert.equal(normalizeCanvasPreferences({ paperStyle: "grid" }).paperStyle, "grid");
  assert.equal(normalizeCanvasPreferences({ paperStyle: "invalid" as any }).paperStyle, "ruled");
  assert.equal(normalizeCanvasPreferences({ pageMargin: "wide" }).pageMargin, "wide");
  assert.equal(normalizeCanvasPreferences({ pageMargin: "invalid" as any }).pageMargin, "standard");
  assert.equal(normalizeCanvasPreferences({}).twoPage, true);
  assert.equal(normalizeCanvasPreferences({ twoPage: false }).twoPage, false);
  assert.equal(normalizeCanvasPreferences({}).pageNumbers, true);
  assert.equal(normalizeCanvasPreferences({ pageNumbers: false }).pageNumbers, false);
  assert.equal(normalizeCanvasPreferences({}).bookWidth, 1040);
  assert.equal(normalizeCanvasPreferences({ bookWidth: 9999 }).bookWidth, 1400);
  assert.equal(normalizeCanvasPreferences({ bookWidth: 1 }).bookWidth, 720);
  assert.equal(normalizeCanvasPreferences({}).bookHeight, 640);
  assert.equal(normalizeCanvasPreferences({ bookHeight: 9999 }).bookHeight, 1100);
  assert.equal(normalizeCanvasPreferences({ bookHeight: 1 }).bookHeight, 480);
});

test("the author can customize the physical book dimensions", () => {
  const source = readFileSync(new URL("../src/components/TiptapEditor.tsx", import.meta.url), "utf8");
  assert.match(source, /اندازه و ابعاد کتاب/);
  assert.match(source, /عرض کتاب در پنل نویسندگی/);
  assert.match(source, /ارتفاع کتاب در پنل نویسندگی/);
  assert.match(source, /max-width: \$\{canvas\.bookWidth\}px/);
  assert.match(source, /min-height: \$\{canvas\.bookHeight\}px/);
});

test("book writing keeps Enter inside the editor and supports independent selectable pages", () => {
  const source = readFileSync(new URL("../src/components/TiptapEditor.tsx", import.meta.url), "utf8");
  const sanitizer = readFileSync(new URL("../server/utils/content.ts", import.meta.url), "utf8");

  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /Enter: خط بعد/);
  assert.match(source, /انتخاب صفحهٔ کتاب/);
  assert.match(source, /\+ صفحهٔ جدید/);
  assert.match(source, /name: "bookPageBreak"/);
  assert.match(source, /column-fill: auto/);
  assert.match(source, /break-before: column/);
  assert.match(sanitizer, /hr: \["data-page-break", "class"\]/);
  assert.match(sanitizeStoryHtml('<hr data-page-break="true" class="reptoc-book-page-break">'), /data-page-break="true"/);
});

test("an illustration can wrap text, and the wrap survives the sanitizer", () => {
  const source = readFileSync(new URL("../src/components/TiptapEditor.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

  // The wrap is an inert data attribute, like the size and alignment: styles are
  // stripped by both sanitizers, so a data attribute is the only durable form.
  assert.match(source, /data-float/);
  assert.match(source, /float: inline-start/);
  assert.match(css, /img\[data-float="start"\]/);

  const stored = sanitizeStoryHtml('<img src="/uploads/a.webp" data-float="start" data-width="small">');
  assert.match(stored, /data-float="start"/);
  assert.doesNotMatch(stored, /style=/);

  // An unknown value falls back to "none" rather than being echoed.
  const tampered = sanitizeStoryHtml('<img src="/uploads/a.webp" data-float="../etc">');
  assert.match(tampered, /data-float="none"/);

  // Wrapping is disabled on phone-width columns, where the remaining ribbon of
  // prose would be unreadable.
  assert.match(css, /img\[data-float\] \{ float: none/);
});

test("a selected illustration can be moved between blocks without dragging", () => {
  const source = readFileSync(new URL("../src/components/TiptapEditor.tsx", import.meta.url), "utf8");

  // Dragging is imprecise on a phone and impossible from the keyboard, so the
  // same reordering exists as explicit up/down actions.
  assert.match(source, /const moveSelectedImage/);
  assert.match(source, /NodeSelection\.create/);
  assert.match(source, /aria-label="انتقال تصویر به بالا"/);
  assert.match(source, /aria-label="انتقال تصویر به پایین"/);
  // Alt text is editable in place, not only at insert time.
  assert.match(source, /متن جانشین:/);
});

test("the editor exposes find, outline and typography without re-reading the document on every keystroke", () => {
  const source = readFileSync(new URL("../src/components/TiptapEditor.tsx", import.meta.url), "utf8");

  assert.match(source, /panel === "find"/);
  assert.match(source, /panel === "outline"/);
  assert.match(source, /panel === "typography"/);
  assert.match(source, /panel === "shortcuts"/);
  // Whole-document work is scoped to the open panel.
  assert.match(source, /panel === "outline"\n?\s*\? \{ entries: buildEditorOutline/);
  assert.match(source, /panel === "find" && findQuery\.trim\(\)/);
  // Typewriter scrolling listens to the editor rather than routing the caret
  // through React state.
  assert.match(source, /editor\.on\("selectionUpdate", centreActiveLine\)/);
});
