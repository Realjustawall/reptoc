import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, useEditorState, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Node as TiptapNode, ResizableNodeView, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { CharacterCount, Focus, Placeholder } from "@tiptap/extensions";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, CaseSensitive, Check,
  ChevronDown, ChevronUp, FileText, Heading1, Heading2, Heading3, ImagePlus, Italic,
  Keyboard, Languages, Link2, List, ListOrdered, Loader2, Maximize2, Minimize2, Minus,
  Quote, Redo, Replace, ScanEye, Search, Shuffle, Sparkles, Strikethrough, Trash2, Type,
  Underline as UnderlineIcon, Undo, Upload, Wand2, X,
} from "lucide-react";
import { api } from "../utils/api";
import { looksLikeMarkdown, markdownToTiptapContent } from "../utils/markdownPaste";
import { uploadImageBlob } from "../utils/imageUpload";

export const EDITOR_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;
export const EDITOR_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Persian prose averages ~200 words per minute for comfortable reading. */
export const READING_WORDS_PER_MINUTE = 200;

export type EditorImageAlignment = "start" | "center" | "end";
export type EditorImageWidth = "small" | "medium" | "full";
/**
 * Text wrapping around an illustration.
 *
 * "none" keeps the image on its own line (the default, and what a scene
 * illustration usually wants); "start"/"end" float it so prose wraps around it
 * the way a printed novel sets a small inline plate.
 */
export type EditorImageFloat = "none" | "start" | "end";

/**
 * Display widths for chapter illustrations.
 *
 * Sizing is expressed through the `data-width` attribute and applied with CSS,
 * never with an inline `style`/`width` attribute: the server chapter sanitizer
 * and the reader sanitizer both strip styles, so a data attribute is the only
 * form that survives the round trip from editor to published chapter.
 */
export const IMAGE_WIDTHS: Record<EditorImageWidth, string> = {
  small: "40%",
  medium: "70%",
  full: "100%",
};

export interface EditorImageRejection {
  reason: "type" | "size";
  message: string;
}

/**
 * Validate a picked/pasted/dropped file before it is uploaded.
 *
 * Doing this in the browser keeps the author from waiting on a multi-megabyte
 * upload that the server would reject anyway, and gives a precise message.
 */
export function validateEditorImage(file: { type?: string; size?: number; name?: string }): EditorImageRejection | null {
  const type = String(file.type || "").toLowerCase();
  if (!(EDITOR_IMAGE_MIME_TYPES as readonly string[]).includes(type)) {
    return { reason: "type", message: "فقط تصویر با قالب JPEG، PNG، WebP، GIF یا AVIF پذیرفته می‌شود." };
  }
  if (Number(file.size || 0) > EDITOR_IMAGE_MAX_BYTES) {
    return { reason: "size", message: "حجم هر تصویر باید کمتر از ۵ مگابایت باشد." };
  }
  return null;
}

/** Images that may be referenced directly without being re-uploaded. */
export function isDisplayableImageSource(value: unknown): boolean {
  const source = String(value || "").trim();
  if (!source) return false;
  if (/^\/(?:uploads\/|api\/(?:files|upload)\/)/i.test(source)) return true;
  try {
    return new URL(source).protocol === "https:";
  } catch {
    return false;
  }
}

export function estimatedReadingMinutes(words: number): number {
  if (!Number.isFinite(words) || words <= 0) return 0;
  return Math.max(1, Math.round(words / READING_WORDS_PER_MINUTE));
}

/** Writing canvas typography, persisted per author across chapters. */
export type EditorCanvasFont = "estedad" | "vazirmatn" | "serif" | "amiri";
export type EditorPaperStyle = "plain" | "ruled" | "grid";
export type EditorPageMargin = "compact" | "standard" | "wide";
export interface EditorCanvasPreferences {
  font: EditorCanvasFont;
  fontSize: number;
  lineHeight: number;
  /** Present the canvas as a page sheet even outside full-screen focus mode. */
  pageView: boolean;
  /** Dim everything except the paragraph being written. */
  spotlight: boolean;
  /** Keep the caret vertically centred, like a typewriter. */
  typewriter: boolean;
  /** Paper guide drawn behind the manuscript without entering saved content. */
  paperStyle: EditorPaperStyle;
  pageMargin: EditorPageMargin;
  twoPage: boolean;
  pageNumbers: boolean;
  /** Physical spread dimensions used by the book preview. */
  bookWidth: number;
  bookHeight: number;
}

export const CANVAS_PREFERENCES_STORAGE_KEY = "reptoc-editor-canvas";
export const CANVAS_FONT_STACKS: Record<EditorCanvasFont, string> = {
  estedad: '"Estedad", "Vazirmatn", system-ui, sans-serif',
  vazirmatn: '"Vazirmatn", "Estedad", system-ui, sans-serif',
  serif: '"Playfair Display", "Estedad", Georgia, serif',
  amiri: '"Amiri", "Noto Naskh Arabic Variable", serif',
};
export const CANVAS_FONT_SIZE_RANGE = { min: 14, max: 26 } as const;
export const CANVAS_LINE_HEIGHT_RANGE = { min: 1.6, max: 2.8 } as const;
export const CANVAS_BOOK_WIDTH_RANGE = { min: 720, max: 1400 } as const;
export const CANVAS_BOOK_HEIGHT_RANGE = { min: 480, max: 1100 } as const;

export const DEFAULT_CANVAS_PREFERENCES: EditorCanvasPreferences = {
  font: "estedad",
  fontSize: 17,
  lineHeight: 2.1,
  pageView: true,
  spotlight: false,
  typewriter: false,
  paperStyle: "ruled",
  pageMargin: "standard",
  twoPage: true,
  pageNumbers: true,
  bookWidth: 1040,
  bookHeight: 640,
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

export function normalizeCanvasPreferences(value: unknown): EditorCanvasPreferences {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<EditorCanvasPreferences>;
  return {
    font: raw.font === "vazirmatn" || raw.font === "serif" || raw.font === "amiri" ? raw.font : "estedad",
    fontSize: Math.round(clampNumber(raw.fontSize, CANVAS_FONT_SIZE_RANGE.min, CANVAS_FONT_SIZE_RANGE.max, DEFAULT_CANVAS_PREFERENCES.fontSize)),
    lineHeight: Math.round(clampNumber(raw.lineHeight, CANVAS_LINE_HEIGHT_RANGE.min, CANVAS_LINE_HEIGHT_RANGE.max, DEFAULT_CANVAS_PREFERENCES.lineHeight) * 10) / 10,
    pageView: raw.pageView !== false,
    spotlight: raw.spotlight === true,
    typewriter: raw.typewriter === true,
    paperStyle: (["plain", "ruled", "grid"] as string[]).includes(String(raw.paperStyle)) ? raw.paperStyle as EditorPaperStyle : DEFAULT_CANVAS_PREFERENCES.paperStyle,
    pageMargin: (["compact", "standard", "wide"] as string[]).includes(String(raw.pageMargin)) ? raw.pageMargin as EditorPageMargin : DEFAULT_CANVAS_PREFERENCES.pageMargin,
    twoPage: raw.twoPage !== false,
    pageNumbers: raw.pageNumbers !== false,
    bookWidth: Math.round(clampNumber(raw.bookWidth, CANVAS_BOOK_WIDTH_RANGE.min, CANVAS_BOOK_WIDTH_RANGE.max, DEFAULT_CANVAS_PREFERENCES.bookWidth)),
    bookHeight: Math.round(clampNumber(raw.bookHeight, CANVAS_BOOK_HEIGHT_RANGE.min, CANVAS_BOOK_HEIGHT_RANGE.max, DEFAULT_CANVAS_PREFERENCES.bookHeight)),
  };
}

function readStoredCanvasPreferences(): EditorCanvasPreferences {
  if (typeof window === "undefined") return DEFAULT_CANVAS_PREFERENCES;
  try {
    return normalizeCanvasPreferences(JSON.parse(window.localStorage.getItem(CANVAS_PREFERENCES_STORAGE_KEY) || "null"));
  } catch {
    return DEFAULT_CANVAS_PREFERENCES;
  }
}

export interface EditorOutlineEntry {
  id: string;
  /** 1-3 for headings; 0 marks a scene divider. */
  level: number;
  text: string;
  position: number;
  words: number;
}

/**
 * Chapter outline.
 *
 * Long chapters are hard to navigate by scrolling alone, so headings and scene
 * dividers are collected into a jump list with the word count of each section.
 * That count is what tells an author a scene has run long, which is exactly the
 * feedback a manuscript view gives.
 */
export function buildEditorOutline(doc: ProseMirrorNode): EditorOutlineEntry[] {
  const entries: EditorOutlineEntry[] = [];
  const wordsSince: number[] = [];

  doc.descendants((node, position) => {
    if (node.type.name === "heading") {
      entries.push({
        id: `outline-${position}`,
        level: Math.min(3, Math.max(1, Number(node.attrs.level) || 1)),
        text: node.textContent.trim() || "بدون عنوان",
        position,
        words: 0,
      });
      wordsSince.push(0);
      return false;
    }
    if (node.type.name === "horizontalRule") {
      entries.push({ id: `outline-${position}`, level: 0, text: "جداکنندهٔ صحنه", position, words: 0 });
      wordsSince.push(0);
      return false;
    }
    if (node.type.name === "bookPageBreak") {
      entries.push({ id: `outline-${position}`, level: 0, text: "آغاز صفحهٔ جدید", position, words: 0 });
      wordsSince.push(0);
      return false;
    }
    if (node.isTextblock) {
      const words = countWords(node.textContent);
      if (wordsSince.length) wordsSince[wordsSince.length - 1] += words;
      return false;
    }
    return true;
  });

  return entries.map((entry, index) => ({ ...entry, words: wordsSince[index] || 0 }));
}

export interface FindMatch {
  from: number;
  to: number;
}

/**
 * Every occurrence of `query` in the document, as document positions.
 *
 * Searching the flattened text of each text block (rather than the whole doc's
 * `textBetween`) keeps positions exact, which is what makes "replace" safe: a
 * mismatch of even one position would corrupt the surrounding markup.
 */
export function findMatchesInDoc(doc: ProseMirrorNode, query: string, caseSensitive: boolean): FindMatch[] {
  const needle = caseSensitive ? query : query.toLowerCase();
  if (!needle) return [];
  const matches: FindMatch[] = [];

  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    const haystack = caseSensitive ? node.textContent : node.textContent.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      const from = position + 1 + index;
      matches.push({ from, to: from + needle.length });
      index = haystack.indexOf(needle, index + Math.max(1, needle.length));
    }
    return false;
  });

  return matches;
}

export const IMAGE_MIN_PIXELS = 80;
export const IMAGE_MAX_PIXELS = 1600;

/** Clamp a free-form pixel width to something a chapter column can show. */
export function clampImageWidth(value: unknown): number | null {
  const pixels = Math.round(Number(value));
  if (!Number.isFinite(pixels) || pixels <= 0) return null;
  return Math.min(IMAGE_MAX_PIXELS, Math.max(IMAGE_MIN_PIXELS, pixels));
}

/**
 * Chapter illustrations.
 *
 * Extends the stock image node with what a novel editor needs:
 *   - `displayWidth` / `alignment` presets, kept as inert `data-*` attributes
 *     because the server and reader sanitizers both strip inline styles;
 *   - a free `width` in pixels set by dragging a corner handle, which takes
 *     precedence over the preset;
 *   - `draggable`, so the author can pick the image up and drop it between
 *     paragraphs the way a word processor allows.
 */
const ChapterImage = Image.extend({
  name: "image",
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null as number | null,
        parseHTML: (element) => clampImageWidth(element.getAttribute("width")),
        renderHTML: (attributes) => (attributes.width ? { width: String(attributes.width) } : {}),
      },
      displayWidth: {
        default: "full" as EditorImageWidth,
        parseHTML: (element) => {
          const stored = element.getAttribute("data-width");
          return stored === "small" || stored === "medium" || stored === "full" ? stored : "full";
        },
        renderHTML: (attributes) => ({
          "data-width": (attributes.displayWidth || "full") as EditorImageWidth,
        }),
      },
      alignment: {
        default: "center" as EditorImageAlignment,
        parseHTML: (element) => {
          const stored = element.getAttribute("data-align");
          return stored === "start" || stored === "center" || stored === "end" ? stored : "center";
        },
        renderHTML: (attributes) => ({ "data-align": attributes.alignment || "center" }),
      },
      float: {
        default: "none" as EditorImageFloat,
        parseHTML: (element) => {
          const stored = element.getAttribute("data-float");
          return stored === "start" || stored === "end" ? stored : "none";
        },
        renderHTML: (attributes) => ({ "data-float": attributes.float || "none" }),
      },
    };
  },

  /**
   * Drag-to-resize.
   *
   * `ResizableNodeView` (Tiptap core) draws corner handles and reports the new
   * size; the committed width is written back to the node so it round-trips
   * through the sanitizers as a plain `width` attribute. Aspect ratio is locked
   * so an illustration can never be squashed.
   */
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const image = document.createElement("img");
      image.src = String(node.attrs.src || "");
      image.alt = String(node.attrs.alt || "تصویر فصل");
      image.loading = "lazy";
      image.decoding = "async";
      if (node.attrs.width) image.setAttribute("width", String(node.attrs.width));
      if (node.attrs.displayWidth) image.setAttribute("data-width", String(node.attrs.displayWidth));
      if (node.attrs.alignment) image.setAttribute("data-align", String(node.attrs.alignment));
      image.setAttribute("data-float", String(node.attrs.float || "none"));

      return new ResizableNodeView({
        element: image,
        node,
        editor,
        getPos,
        onResize: (width) => {
          // Live feedback while dragging; not yet persisted.
          image.style.width = `${Math.round(width)}px`;
        },
        onCommit: (width) => {
          const next = clampImageWidth(width);
          image.style.width = "";
          if (next === null) return;
          editor.commands.updateAttributes("image", { width: next });
        },
        onUpdate: (updated) => {
          if (updated.type.name !== node.type.name) return false;
          image.src = String(updated.attrs.src || "");
          image.alt = String(updated.attrs.alt || "تصویر فصل");
          if (updated.attrs.width) image.setAttribute("width", String(updated.attrs.width));
          else image.removeAttribute("width");
          image.setAttribute("data-width", String(updated.attrs.displayWidth || "full"));
          image.setAttribute("data-align", String(updated.attrs.alignment || "center"));
          image.setAttribute("data-float", String(updated.attrs.float || "none"));
          return true;
        },
        options: {
          directions: ["bottom-left", "bottom-right", "top-left", "top-right"],
          min: { width: IMAGE_MIN_PIXELS, height: IMAGE_MIN_PIXELS },
          max: { width: IMAGE_MAX_PIXELS },
          preserveAspectRatio: true,
          className: {
            container: "reptoc-image-resizer",
            wrapper: "reptoc-image-resizer-wrapper",
            handle: "reptoc-image-handle",
            resizing: "is-resizing",
          },
        },
      });
    };
  },
}).configure({ inline: false, allowBase64: false });

/** A persisted, explicit page boundary for the author's book canvas. */
const BookPageBreak = TiptapNode.create({
  name: "bookPageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'hr[data-page-break="true"]' }],
  renderHTML: ({ HTMLAttributes }) => ["hr", mergeAttributes(HTMLAttributes, { "data-page-break": "true", class: "reptoc-book-page-break" })],
});

export interface TiptapEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  theme: "light" | "dark";
  readOnly?: boolean;
  internalLinks?: Array<{ id: string; name: string; href: string }>;
  /** Persian prose is right-to-left; set "ltr" for English-only surfaces. */
  direction?: "rtl" | "ltr";
  /** Optional word goal shown in the status bar progress meter. */
  targetWordCount?: number;
  /** Present the writing canvas as a two-page open book on wide screens. */
  bookMode?: boolean;
}

function insertPlainTextPreservingLines(editor: Editor, text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const paragraphs = lines.map((line) => ({
    type: "paragraph",
    ...(line ? { content: [{ type: "text", text: line }] } : {}),
  }));

  editor.chain().focus().insertContent(paragraphs).run();
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
}

export default function TiptapEditor({
  content,
  onChange,
  placeholder = "داستان خود را اینجا بنویسید…",
  theme,
  readOnly = false,
  internalLinks = [],
  direction = "rtl",
  targetWordCount,
  bookMode = false,
}: TiptapEditorProps) {
  const isDark = theme === "dark";
  const [focusMode, setFocusMode] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; message: string } | null>(null);
  const [statistics, setStatistics] = useState({ words: 0, characters: 0 });
  const [panel, setPanel] = useState<"link" | "image" | "internal" | "import" | "find" | "typography" | "outline" | "shortcuts" | null>(null);
  const [linkValue, setLinkValue] = useState("");
  const [imageUrlValue, setImageUrlValue] = useState("");
  const [imageAltValue, setImageAltValue] = useState("");
  const [uploadingImages, setUploadingImages] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const [showAIPrompt, setShowAIPrompt] = useState(false);
  const [aiPromptText, setAiPromptText] = useState("");
  const [isAILoading, setIsAILoading] = useState(false);
  const [aiButtonVisible, setAiButtonVisible] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importLoading, setImportLoading] = useState(false);

  // Manuscript comforts: canvas typography, find & replace, chapter outline.
  const [canvas, setCanvas] = useState<EditorCanvasPreferences>(readStoredCanvasPreferences);
  const [findQuery, setFindQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findCursor, setFindCursor] = useState(0);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bookModeRef = useRef(bookMode);
  const readOnlyRef = useRef(readOnly);
  bookModeRef.current = bookMode;
  readOnlyRef.current = readOnly;

  const updateCanvas = useCallback((changes: Partial<EditorCanvasPreferences>) => {
    setCanvas((current) => {
      const next = normalizeCanvasPreferences({ ...current, ...changes });
      try {
        window.localStorage.setItem(CANVAS_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // A private-mode browser refusing storage must not break the editor.
      }
      return next;
    });
  }, []);

  const announce = useCallback((message: string, tone: "info" | "error" = "info") => {
    setNotice({ tone, message });
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  /**
   * Upload one image and return the stored URL.
   *
   * Chapter illustrations are uploaded as `public` so every reader can fetch
   * them from `/uploads/...`; private uploads are only readable by their owner
   * and would render as a broken image for the audience.
   */
  const uploadEditorImage = useCallback(async (file: File): Promise<string | null> => {
    const rejection = validateEditorImage(file);
    if (rejection) {
      announce(rejection.message, "error");
      return null;
    }
    setUploadingImages((count) => count + 1);
    try {
      const body = await uploadImageBlob(file, {
        fileName: file.name || "illustration.jpg",
        csrfToken: api.getToken(),
        fields: { visibility: "public" },
      });
      const url = String(body.url || "").trim();
      if (!url) throw new Error("بارگذاری تصویر بدون نشانی قابل استفاده پایان یافت.");
      return url;
    } catch (error: any) {
      announce(error?.message || "بارگذاری تصویر ناموفق بود.", "error");
      return null;
    } finally {
      setUploadingImages((count) => Math.max(0, count - 1));
    }
  }, [announce]);

  const insertImages = useCallback(async (files: File[]) => {
    const editor = editorRef.current;
    if (!editor || readOnly || files.length === 0) return;
    let inserted = 0;
    for (const file of files.slice(0, 10)) {
      const url = await uploadEditorImage(file);
      if (!url) continue;
      editor
        .chain()
        .focus()
        .setImage({ src: url, alt: file.name?.replace(/\.[^.]+$/, "") || "تصویر فصل" } as any)
        .run();
      inserted += 1;
    }
    if (inserted > 0) announce(inserted === 1 ? "تصویر در فصل درج شد." : `${inserted} تصویر در فصل درج شد.`);
  }, [announce, readOnly, uploadEditorImage]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer" } },
      }),
      ChapterImage,
      BookPageBreak,
      Placeholder.configure({ placeholder }),
      CharacterCount,
      // Marks the paragraph under the caret so spotlight/typewriter mode can
      // dim everything else and keep the active line centred.
      Focus.configure({ className: "reptoc-focus-line", mode: "shallowest" }),
    ],
    content: content || "",
    editable: !readOnly,
    // The workspace mounts inside an animated panel; deferring the first render
    // keeps Tiptap from measuring a zero-size container.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "reptoc-prose",
        dir: direction,
        spellcheck: "true",
        "aria-label": "ویرایشگر متن فصل",
      },
      handlePaste: (_view, event) => {
        const currentEditor = editorRef.current;
        if (!currentEditor) return false;
        const clipboard = event.clipboardData;
        if (!clipboard) return false;

        // Images pasted straight from a screenshot tool or another page.
        const files = Array.from(clipboard.files || []).filter((file) => file.type.startsWith("image/"));
        if (files.length > 0) {
          event.preventDefault();
          void insertImages(files);
          return true;
        }

        const explicitMarkdown = clipboard.getData("text/markdown");
        const text = explicitMarkdown || clipboard.getData("text/plain");
        if (!text) return false;

        if (explicitMarkdown || looksLikeMarkdown(text)) {
          event.preventDefault();
          currentEditor.chain().focus().insertContent(markdownToTiptapContent(text)).run();
          return true;
        }

        // Rich text from Word/Docs/another editor keeps its formatting; Tiptap's
        // schema already discards anything it cannot represent.
        if (clipboard.getData("text/html")) return false;

        event.preventDefault();
        insertPlainTextPreservingLines(currentEditor, text);
        return true;
      },
      handleDrop: (_view, event) => {
        const dropped = Array.from((event as DragEvent).dataTransfer?.files || []).filter((file) => file.type.startsWith("image/"));
        if (dropped.length === 0) return false;
        event.preventDefault();
        void insertImages(dropped);
        return true;
      },
      handleKeyDown: (_view, event) => {
        if (!bookModeRef.current || event.key !== "Enter") return false;
        // Keep Enter inside ProseMirror. Outer workspace/form shortcuts must
        // never interpret a paragraph break as navigation to another section.
        event.stopPropagation();
        if ((event.ctrlKey || event.metaKey) && !readOnlyRef.current) {
          event.preventDefault();
          editorRef.current?.chain().focus().insertContent([{ type: "bookPageBreak" }, { type: "paragraph" }]).run();
          announce("صفحهٔ جدید ساخته شد؛ نوشتن از خط اول همین صفحه ادامه دارد.");
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChange(instance.getHTML());
      const storage = instance.storage.characterCount;
      setStatistics({
        words: typeof storage?.words === "function" ? storage.words() : countWords(instance.getText()),
        characters: typeof storage?.characters === "function" ? storage.characters() : instance.getText().length,
      });
    },
  });

  editorRef.current = editor;

  /**
   * Toolbar state.
   *
   * Tiptap v3 no longer re-renders the React tree on every transaction, so the
   * active-mark highlights and the selected-image controls must be selected
   * explicitly. `useEditorState` re-renders only when one of these values
   * actually changes, which keeps typing smooth in long chapters.
   */
  const toolbar = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (!instance) return null;
      const imageAttributes = instance.isActive("image") ? instance.getAttributes("image") : null;
      return {
        bold: instance.isActive("bold"),
        italic: instance.isActive("italic"),
        underline: instance.isActive("underline"),
        strike: instance.isActive("strike"),
        heading1: instance.isActive("heading", { level: 1 }),
        heading2: instance.isActive("heading", { level: 2 }),
        heading3: instance.isActive("heading", { level: 3 }),
        bulletList: instance.isActive("bulletList"),
        orderedList: instance.isActive("orderedList"),
        blockquote: instance.isActive("blockquote"),
        link: instance.isActive("link"),
        linkHref: String(instance.getAttributes("link").href || ""),
        canUndo: instance.can().undo(),
        canRedo: instance.can().redo(),
        image: imageAttributes
          ? {
              width: (imageAttributes.displayWidth as EditorImageWidth) || "full",
              align: (imageAttributes.alignment as EditorImageAlignment) || "center",
              float: (imageAttributes.float as EditorImageFloat) || "none",
              alt: String(imageAttributes.alt || ""),
              pixels: clampImageWidth(imageAttributes.width),
            }
          : null,
      };
    },
  });

  /**
   * The outline and the search results both read the whole document, so they are
   * derived only while their panel is open. Selecting them unconditionally would
   * traverse the document — and re-render this toolbar — on every keystroke,
   * which is exactly what makes a long chapter feel sluggish.
   */
  const outlineState = useEditorState({
    editor,
    selector: ({ editor: instance }) => (
      instance && panel === "outline"
        ? { entries: buildEditorOutline(instance.state.doc), caret: instance.state.selection.from }
        : null
    ),
  });
  const outline = outlineState?.entries || [];

  const findMatches = useEditorState({
    editor,
    selector: ({ editor: instance }) => (
      instance && panel === "find" && findQuery.trim()
        ? findMatchesInDoc(instance.state.doc, findQuery, findCaseSensitive)
        : []
    ),
  }) || [];

  const bookPagination = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (!instance || !bookMode) return { current: 1, count: 1 };
      let count = 1;
      let current = 1;
      instance.state.doc.forEach((node, offset) => {
        if (node.type.name !== "bookPageBreak") return;
        count += 1;
        if (instance.state.selection.from > offset + 1) current += 1;
      });
      return { current: Math.min(current, count), count };
    },
  }) || { current: 1, count: 1 };

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor) return;
    const incoming = content || "";
    if (incoming === editor.getHTML()) return;
    // Replacing the document externally (chapter switch, version restore) must
    // not fire onUpdate: that would immediately echo the value back and mark a
    // freshly loaded chapter as unsaved.
    editor.commands.setContent(incoming, { emitUpdate: false });
    const storage = editor.storage.characterCount;
    setStatistics({
      words: typeof storage?.words === "function" ? storage.words() : countWords(editor.getText()),
      characters: typeof storage?.characters === "function" ? storage.characters() : editor.getText().length,
    });
  }, [content, editor]);

  useEffect(() => {
    let active = true;
    fetch("/api/ai/public-settings", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((settings) => {
        if (!active || !settings) return;
        const visible = settings.enabled !== false && settings.button_visible !== false;
        setAiButtonVisible(visible);
        setAiConfigured(settings.configured === true);
        if (!visible) setShowAIPrompt(false);
      })
      .catch(() => {
        if (active) setAiButtonVisible(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Escape closes the open panel first, then leaves full-screen focus mode, so a
  // single key always undoes the most recent thing the author opened.
  useEffect(() => {
    if (!focusMode && !panel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (panel) {
        setPanel(null);
        return;
      }
      if (focusMode) setFocusMode(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode, panel]);

  /**
   * Editor keyboard shortcuts.
   *
   * These are bound on the container rather than through Tiptap's keymap so they
   * also work while the focus is in one of the panels (search field, alt-text
   * field). Ctrl/Cmd+S is deliberately not handled here: the workspace owns
   * saving and already binds it.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container || !container.contains(event.target as Node)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();

      if (key === "f") {
        event.preventDefault();
        setPanel("find");
        window.setTimeout(() => findInputRef.current?.focus(), 0);
        return;
      }
      if (key === "h" && !readOnly) {
        event.preventDefault();
        setPanel("find");
        window.setTimeout(() => findInputRef.current?.focus(), 0);
        return;
      }
      if (event.shiftKey && key === "f") {
        event.preventDefault();
        setFocusMode((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly]);

  /**
   * Typewriter scrolling.
   *
   * Keeps the line being written near the vertical middle of the canvas instead
   * of letting it crawl to the bottom edge. This listens to the editor directly
   * rather than to React state: routing the caret position through a hook would
   * re-render the whole toolbar on every keystroke.
   */
  useEffect(() => {
    if (!canvas.typewriter || !editor) return;
    const centreActiveLine = () => {
      const scroller = scrollerRef.current;
      const active = scroller?.querySelector<HTMLElement>(".reptoc-focus-line");
      if (!scroller || !active) return;
      const target = active.offsetTop - scroller.clientHeight / 2 + active.offsetHeight / 2;
      scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    };
    centreActiveLine();
    editor.on("selectionUpdate", centreActiveLine);
    editor.on("update", centreActiveLine);
    return () => {
      editor.off("selectionUpdate", centreActiveLine);
      editor.off("update", centreActiveLine);
    };
  }, [canvas.typewriter, editor]);

  // A new search resets the cursor and jumps to the first hit.
  useEffect(() => {
    if (panel !== "find" || findMatches.length === 0) return;
    setFindCursor((current) => (current < findMatches.length ? current : 0));
  }, [findMatches.length, panel]);

  const handleGenerateAI = async () => {
    const currentEditor = editorRef.current;
    if (!aiPromptText.trim() || !currentEditor) return;
    setIsAILoading(true);
    try {
      const token = api.getToken();
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "X-CSRF-Token": token } : {}) },
        credentials: "same-origin",
        body: JSON.stringify({ prompt: aiPromptText, context: currentEditor.getText().slice(-1000) }),
      });
      const data = await response.json();
      if (data.content) {
        currentEditor.chain().focus().insertContent(markdownToTiptapContent(String(data.content))).run();
        setShowAIPrompt(false);
        setAiPromptText("");
        announce("متن پیشنهادی هوش مصنوعی درج شد.");
      } else {
        announce(`خطای هوش مصنوعی: ${data.error || "تولید متن ناموفق بود"}`, "error");
      }
    } catch {
      announce("خطا در اتصال به سرویس هوش مصنوعی.", "error");
    } finally {
      setIsAILoading(false);
    }
  };

  const importDocument = async (file: File) => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    setImportLoading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const token = api.getToken();
      const response = await fetch("/api/files/extract-text", {
        method: "POST",
        headers: { ...(token ? { "X-CSRF-Token": token } : {}) },
        credentials: "same-origin",
        body: form,
      });
      const data = await response.json();
      if (data.success && data.content) {
        currentEditor.chain().focus().insertContent(data.content).run();
        announce("متن سند استخراج و درج شد.");
        setPanel(null);
      } else {
        announce(`خطا: ${data.error || "استخراج متن ناموفق بود."}`, "error");
      }
    } catch {
      announce("خطای اتصال در حین استخراج سند.", "error");
    } finally {
      setImportLoading(false);
      if (documentInputRef.current) documentInputRef.current.value = "";
    }
  };

  const importFromUrl = async () => {
    const currentEditor = editorRef.current;
    if (!currentEditor || !importUrl.trim()) return;
    setImportLoading(true);
    try {
      const token = api.getToken();
      const response = await fetch("/api/files/extract-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "X-CSRF-Token": token } : {}) },
        credentials: "same-origin",
        body: JSON.stringify({ url: importUrl }),
      });
      const data = await response.json();
      if (data.success && data.content) {
        currentEditor.chain().focus().insertContent(data.content).run();
        announce("محتوای پیوند استخراج و درج شد.");
        setImportUrl("");
        setPanel(null);
      } else {
        announce(`خطا: ${data.error || "استخراج متن ناموفق بود."}`, "error");
      }
    } catch {
      announce("خطای اتصال در حین استخراج پیوند.", "error");
    } finally {
      setImportLoading(false);
    }
  };

  const pasteWithoutFormatting = async () => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        announce("کلیپ‌بورد خالی است.", "error");
        return;
      }
      insertPlainTextPreservingLines(currentEditor, text);
      announce("متن بدون قالب‌بندی درج شد.");
    } catch {
      announce("دسترسی به کلیپ‌بورد ممکن نشد. از Ctrl+Shift+V استفاده کنید.", "error");
    }
  };

  /**
   * Persian typography cleanup.
   *
   * Fixes the mistakes that make Persian web novels look unpolished: Arabic
   * ي/ك instead of the Persian ی/ک, Arabic-Indic digits, missing ZWNJ in
   * می‌/نمی‌ prefixes and در حال plurals, spaces before punctuation, and
   * repeated spaces. Only text nodes are touched, so tags and image
   * attributes are never rewritten.
   */
  const applyPersianTypography = () => {
    const currentEditor = editorRef.current;
    if (!currentEditor || readOnly) return;
    const html = currentEditor.getHTML();
    const polished = html.replace(/>([^<]+)</g, (_match, text: string) => {
      const fixed = text
        .replace(/\u064A/g, "\u06CC")
        .replace(/\u0643/g, "\u06A9")
        .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
        .replace(/\u0640+/g, "")
        .replace(/(^|[\s(«"'])(ن?می) +(?=[\u0600-\u06FF])/g, "$1$2\u200C")
        .replace(/([\u0600-\u06FF]) +(ها|های|هایی|تر|ترین)(?=$|[\s.,!?؛،:)»"'])/g, "$1\u200C$2")
        .replace(/ +([.,!?؛،:])/g, "$1")
        .replace(/([.,!?؛،:])(?=[^\s.,!?؛،:)»"'\d])/g, "$1 ")
        .replace(/[ \t]{2,}/g, " ");
      return `>${fixed}<`;
    });
    if (polished === html) {
      announce("متن پیش‌تر آراسته شده بود؛ تغییری لازم نبود.");
      return;
    }
    currentEditor.commands.setContent(polished);
    announce("نگارش فارسی، نیم‌فاصله و نشانه‌گذاری اصلاح شد.");
  };

  const applyImageAttributes = (
    attributes: Partial<{
      displayWidth: EditorImageWidth;
      alignment: EditorImageAlignment;
      float: EditorImageFloat;
      alt: string;
      width: number | null;
    }>,
  ) => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    // Picking a preset clears any dragged pixel width; otherwise the explicit
    // width keeps winning and the preset button looks broken.
    const next = attributes.displayWidth !== undefined && attributes.width === undefined
      ? { ...attributes, width: null }
      : attributes;
    currentEditor.chain().focus().updateAttributes("image", next).run();
  };

  /**
   * Move the selected illustration one block up or down.
   *
   * Dragging works, but it is imprecise on a phone and impossible with a
   * keyboard, so the same reordering is available as two buttons: the image node
   * is cut and re-inserted at the neighbouring block boundary, then reselected so
   * the author can keep nudging it.
   */
  const moveSelectedImage = (direction: -1 | 1) => {
    const currentEditor = editorRef.current;
    if (!currentEditor || readOnly) return;
    const { state } = currentEditor;
    const selection = state.selection;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") return;

    const from = selection.from;
    const node = selection.node;
    const parent = state.doc.resolve(from).parent;
    const indexInParent = state.doc.resolve(from).index();
    const targetIndex = indexInParent + direction;
    if (targetIndex < 0 || targetIndex >= parent.childCount) {
      announce(direction < 0 ? "تصویر در ابتدای فصل است." : "تصویر در پایان فصل است.");
      return;
    }

    // Compute the insertion point before the document is modified.
    const parentStart = state.doc.resolve(from).start();
    let insertAt = parentStart;
    for (let index = 0; index < targetIndex; index += 1) insertAt += parent.child(index).nodeSize;
    if (direction > 0) insertAt += parent.child(targetIndex).nodeSize;

    const transaction = state.tr.delete(from, from + node.nodeSize);
    const mappedInsert = transaction.mapping.map(insertAt);
    transaction.insert(mappedInsert, node);
    transaction.setSelection(NodeSelection.create(transaction.doc, mappedInsert));
    currentEditor.view.dispatch(transaction.scrollIntoView());
    currentEditor.view.focus();
  };

  /** Jump the caret to an outline entry and bring it into view. */
  const jumpToOutlineEntry = (entry: EditorOutlineEntry) => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    const { state } = currentEditor;
    const position = Math.min(state.doc.content.size - 1, Math.max(0, entry.position + 1));
    const transaction = state.tr.setSelection(TextSelection.create(state.doc, position)).scrollIntoView();
    currentEditor.view.dispatch(transaction);
    currentEditor.view.focus();
  };

  /** Select the nth match of the current search and scroll to it. */
  const focusFindMatch = useCallback((index: number) => {
    const currentEditor = editorRef.current;
    if (!currentEditor || findMatches.length === 0) return;
    const bounded = ((index % findMatches.length) + findMatches.length) % findMatches.length;
    const match = findMatches[bounded];
    setFindCursor(bounded);
    const transaction = currentEditor.state.tr
      .setSelection(TextSelection.create(currentEditor.state.doc, match.from, match.to))
      .scrollIntoView();
    currentEditor.view.dispatch(transaction);
    currentEditor.view.focus();
  }, [findMatches]);

  const replaceCurrentMatch = () => {
    const currentEditor = editorRef.current;
    if (!currentEditor || readOnly || findMatches.length === 0) return;
    const match = findMatches[Math.min(findCursor, findMatches.length - 1)];
    currentEditor
      .chain()
      .focus()
      .insertContentAt({ from: match.from, to: match.to }, replaceValue)
      .run();
    announce("یک مورد جای‌گزین شد.");
  };

  const replaceAllMatches = () => {
    const currentEditor = editorRef.current;
    if (!currentEditor || readOnly || findMatches.length === 0) return;
    // Replace from the end backwards so earlier positions stay valid.
    const chain = currentEditor.chain().focus();
    for (const match of [...findMatches].reverse()) {
      chain.insertContentAt({ from: match.from, to: match.to }, replaceValue);
    }
    chain.run();
    announce(`${findMatches.length.toLocaleString("fa-IR")} مورد جای‌گزین شد.`);
    setFindCursor(0);
  };

  const jumpToBookPage = (page: number) => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    const bounded = Math.max(1, Math.min(bookPagination.count, page));
    const starts = [1];
    currentEditor.state.doc.forEach((node, offset) => {
      if (node.type.name === "bookPageBreak") starts.push(Math.min(currentEditor.state.doc.content.size, offset + node.nodeSize + 1));
    });
    const position = starts[bounded - 1] ?? 1;
    currentEditor.view.dispatch(currentEditor.state.tr.setSelection(TextSelection.near(currentEditor.state.doc.resolve(position), 1)).scrollIntoView());
    currentEditor.view.focus();
  };

  const insertBookPage = () => {
    const currentEditor = editorRef.current;
    if (!currentEditor || readOnly) return;
    currentEditor.chain().focus().insertContent([{ type: "bookPageBreak" }, { type: "paragraph" }]).run();
    announce("صفحهٔ جدید ساخته شد؛ نوشتن از خط اول همین صفحه ادامه دارد.");
  };

  const words = statistics.words;
  const readingMinutes = estimatedReadingMinutes(words);
  const goal = Number(targetWordCount || 0);
  const goalPercent = goal > 0 ? Math.min(100, Math.round((words / goal) * 100)) : 0;

  const bookEditorClass = bookMode
    ? `writer-book-editor writer-paper-${canvas.paperStyle} writer-margin-${canvas.pageMargin} ${canvas.twoPage ? "writer-book-two-page" : ""} ${canvas.pageNumbers ? "writer-book-page-numbers" : ""}`
    : "";
  const containerClass = focusMode
    ? `fixed inset-0 z-[60] flex flex-col ${bookEditorClass} ${bookMode ? "writer-book-fullscreen" : ""} ${isDark ? "bg-[#060409]" : "bg-white"}`
    : `flex flex-col overflow-hidden rounded-2xl border shadow-md ${bookEditorClass} ${isDark ? "border-violet-950/50" : "border-stone-200"}`;

  const toolButton = (active: boolean) =>
    `inline-flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
      active
        ? "bg-violet-600 text-white shadow-sm shadow-violet-600/30"
        : isDark
          ? "text-slate-400 hover:bg-slate-800/80 hover:text-white"
          : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
    } disabled:cursor-not-allowed disabled:opacity-40`;

  const chipButton = (active: boolean) =>
    `rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
      active ? "bg-violet-600 text-white" : isDark ? "bg-slate-800/70 text-slate-300 hover:bg-slate-700" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
    }`;

  const inputClass = `w-full rounded-xl border px-3 py-2 text-xs outline-none transition-colors ${
    isDark
      ? "border-violet-950 bg-[#0b0716] text-white focus:border-violet-500"
      : "border-stone-200 bg-white text-stone-900 focus:border-violet-500"
  }`;

  if (!editor) {
    return (
      <div
        className={`min-h-[320px] animate-pulse rounded-2xl border ${isDark ? "border-violet-950/40 bg-slate-900/20" : "border-stone-200 bg-stone-50"}`}
        aria-busy="true"
        aria-label="در حال آماده‌سازی ویرایشگر"
      />
    );
  }

  const openPanel = (next: typeof panel) => {
    setPanel((current) => {
      const target = current === next ? null : next;
      if (target === "link") setLinkValue(toolbar?.linkHref || "");
      if (target !== "image") {
        setImageUrlValue("");
        setImageAltValue("");
      }
      return target;
    });
  };

  const pageSheet = focusMode || canvas.pageView || bookMode;

  return (
    <div className={containerClass} dir={direction} ref={containerRef}>
      <style>{`
        /* The canvas is presented as a page sheet (A4-ish measure, generous
           margins, centred) so long-form writing reads like a manuscript rather
           than a form field. */
        .reptoc-page-sheet {
          margin: 0 auto;
          max-width: 760px;
          border-radius: 10px;
          background: ${isDark ? "#0b0d18" : "#ffffff"};
          box-shadow: ${isDark ? "0 24px 60px -20px rgba(0,0,0,.75)" : "0 18px 45px -18px rgba(15,23,42,.28)"};
        }
        /* Full-screen focus mode gets the wider print measure. */
        .reptoc-page-sheet.is-focus { max-width: 820px; }
        .writer-book-editor .reptoc-page-sheet {
          max-width: ${canvas.bookWidth}px;
          width: calc(100% - 2rem);
          min-height: ${canvas.bookHeight}px;
          position: relative;
          color: #30281f;
          background:
            linear-gradient(90deg, transparent 49.4%, rgba(85,65,42,.16) 50%, transparent 50.6%),
            linear-gradient(90deg, #f7f0df 0 50%, #fbf5e7 50% 100%);
          border: 1px solid #d6c7aa;
          box-shadow: 0 28px 65px -24px rgba(31,24,16,.55), inset 0 0 55px rgba(110,82,45,.06);
          overflow-x: auto;
          overflow-y: hidden;
          scroll-behavior: smooth;
          scrollbar-width: thin;
        }
        .writer-book-editor .reptoc-prose {
          box-sizing: border-box;
          height: ${canvas.bookHeight}px;
          min-height: ${canvas.bookHeight}px;
          column-fill: auto;
          columns: 1;
          overflow: visible;
          font-family: "Amiri", "Noto Naskh Arabic Variable", serif;
          caret-color: #5b21b6;
        }
        .writer-book-editor.writer-book-two-page .reptoc-prose {
          columns: 2;
          column-gap: 5rem;
          column-rule: 1px solid rgba(112,86,52,.14);
        }
        .writer-book-editor .reptoc-book-page-break {
          display: block;
          height: 0;
          margin: 0;
          border: 0;
          break-before: column;
          page-break-before: always;
          user-select: none;
        }
        .writer-book-editor.writer-paper-ruled .reptoc-prose {
          background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(${(canvas.fontSize * canvas.lineHeight).toFixed(1)}px - 1px), rgba(101,126,151,.18) calc(${(canvas.fontSize * canvas.lineHeight).toFixed(1)}px - 1px), rgba(101,126,151,.18) ${(canvas.fontSize * canvas.lineHeight).toFixed(1)}px);
          background-attachment: local;
        }
        .writer-book-editor.writer-paper-grid .reptoc-prose {
          background-image:
            linear-gradient(rgba(101,126,151,.12) 1px, transparent 1px),
            linear-gradient(90deg, rgba(101,126,151,.12) 1px, transparent 1px);
          background-size: ${(canvas.fontSize * canvas.lineHeight).toFixed(1)}px ${(canvas.fontSize * canvas.lineHeight).toFixed(1)}px;
          background-attachment: local;
        }
        .writer-book-editor.writer-margin-compact .reptoc-prose { padding: 1.7rem 2rem 2.6rem; }
        .writer-book-editor.writer-margin-standard .reptoc-prose { padding: 2.8rem 3.4rem 3.8rem; }
        .writer-book-editor.writer-margin-wide .reptoc-prose { padding: 4rem 5rem 5rem; }
        .writer-book-editor .reptoc-prose > * { break-inside: avoid-column; }
        .writer-book-editor.writer-book-page-numbers .reptoc-page-sheet::before,
        .writer-book-editor.writer-book-page-numbers .reptoc-page-sheet::after {
          position: absolute;
          z-index: 2;
          bottom: .8rem;
          color: rgba(74,57,37,.58);
          font: 700 12px "Amiri", serif;
          pointer-events: none;
        }
        .writer-book-editor.writer-book-page-numbers .reptoc-page-sheet::before { content: "۱"; right: 24%; }
        .writer-book-editor.writer-book-page-numbers .reptoc-page-sheet::after { content: "۲"; left: 24%; }
        .writer-book-fullscreen .reptoc-page-sheet {
          min-height: max(${canvas.bookHeight}px, calc(100vh - 10rem));
          animation: reptoc-book-open .45s cubic-bezier(.2,.8,.2,1) both;
        }
        .writer-book-fullscreen .reptoc-canvas-scroller {
          perspective: 1400px;
          background: radial-gradient(ellipse at center top, #6b5946, #2d261f 68%);
        }
        @keyframes reptoc-book-open {
          from { opacity: 0; transform: perspective(1200px) rotateX(5deg) scale(.96); }
          to { opacity: 1; transform: perspective(1200px) rotateX(0) scale(1); }
        }
        @media (max-width: 767px) {
          .writer-book-editor .reptoc-page-sheet { background: #fbf5e7; border-radius: 4px; }
          .writer-book-editor .reptoc-prose { columns: 1 !important; height: max(70vh, 480px); min-height: max(70vh, 480px); padding: 2rem 1.35rem 3rem !important; }
          .writer-book-editor.writer-book-page-numbers .reptoc-page-sheet::before { right: 50%; transform: translateX(50%); }
          .writer-book-editor.writer-book-page-numbers .reptoc-page-sheet::after { display: none; }
        }
        .reptoc-prose {
          outline: none;
          padding: ${focusMode ? "3rem 3.25rem 5rem" : pageSheet ? "2.25rem 2.5rem 3rem" : "1.5rem"};
          min-height: ${focusMode ? "calc(100vh - 210px)" : "260px"};
          font-family: ${CANVAS_FONT_STACKS[canvas.font]};
          font-size: ${canvas.fontSize}px;
          line-height: ${canvas.lineHeight};
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        /* Spotlight: everything except the paragraph under the caret is dimmed,
           which is the single most effective way to keep attention on the line
           being written without hiding the surrounding scene. */
        ${canvas.spotlight ? `
        .reptoc-prose > * { transition: opacity .18s ease, filter .18s ease; opacity: .32; }
        .reptoc-prose > .reptoc-focus-line { opacity: 1; }
        ` : ""}
        .reptoc-prose:focus { outline: none; }
        /* Search hits are painted through a decoration-free selection highlight:
           the browser's own selection is what "find" moves, so no extra markup
           is inserted into the author's document. */
        .reptoc-prose ::selection { background: rgba(139, 92, 246, .35); }
        .reptoc-prose > * + * { margin-top: 1rem; }
        .reptoc-prose p { margin: 0 0 1rem; text-align: justify; }
        .reptoc-prose p:last-child { margin-bottom: 0; }
        .reptoc-prose h1 { font-size: 1.6rem; font-weight: 900; line-height: 1.5; margin: 1.6rem 0 .8rem; }
        .reptoc-prose h2 { font-size: 1.35rem; font-weight: 800; line-height: 1.5; margin: 1.4rem 0 .7rem; }
        .reptoc-prose h3 { font-size: 1.15rem; font-weight: 700; line-height: 1.5; margin: 1.2rem 0 .6rem; }
        .reptoc-prose strong { font-weight: 800; color: ${isDark ? "#c4b5fd" : "#6d28d9"}; }
        .reptoc-prose em { font-style: italic; }
        .reptoc-prose s { text-decoration: line-through; opacity: .75; }
        .reptoc-prose ul,
        .reptoc-prose ol {
          margin: 0 0 1rem;
          padding-inline-start: 1.6rem;
          padding-inline-end: 0;
        }
        .reptoc-prose ul { list-style: disc; }
        .reptoc-prose ol { list-style: decimal; }
        .reptoc-prose li { margin-bottom: .35rem; }
        .reptoc-prose li > p { margin-bottom: .25rem; }
        .reptoc-prose blockquote {
          margin: 1.4rem 0;
          padding: .6rem 1rem;
          border-inline-start: 4px solid #8b5cf6;
          border-radius: .35rem;
          font-style: italic;
          color: ${isDark ? "#94a3b8" : "#475569"};
          background: rgba(139, 92, 246, ${isDark ? ".07" : ".04"});
        }
        .reptoc-prose hr {
          margin: 2rem auto;
          width: 45%;
          border: 0;
          border-top: 2px dashed ${isDark ? "#312e81" : "#d6d3d1"};
        }
        .reptoc-prose a { color: #a78bfa; text-decoration: underline; }
        .reptoc-prose img {
          display: block;
          height: auto;
          max-width: 100%;
          margin: 1.25rem auto;
          border-radius: .85rem;
          border: 1px solid ${isDark ? "rgba(124,58,237,.25)" : "rgba(120,113,108,.2)"};
        }
        .reptoc-prose img[data-width="small"] { width: ${IMAGE_WIDTHS.small}; }
        .reptoc-prose img[data-width="medium"] { width: ${IMAGE_WIDTHS.medium}; }
        .reptoc-prose img[data-width="full"] { width: ${IMAGE_WIDTHS.full}; }
        /* A dragged pixel width always wins over the preset. */
        .reptoc-prose img[width] { width: auto; max-width: 100%; }
        .reptoc-prose img[data-align="start"] { margin-inline-start: 0; margin-inline-end: auto; }
        .reptoc-prose img[data-align="end"] { margin-inline-start: auto; margin-inline-end: 0; }
        /* Text wrapping. A floated illustration sits inside the column and prose
           flows around it, the way a printed novel sets a small plate. */
        .reptoc-prose img[data-float="start"] {
          float: inline-start;
          margin: .35rem 0 1rem 1.25rem;
        }
        .reptoc-prose img[data-float="end"] {
          float: inline-end;
          margin: .35rem 1.25rem 1rem 0;
        }
        .reptoc-prose .reptoc-image-resizer[data-float="start"] { float: inline-start; }
        .reptoc-prose .reptoc-image-resizer[data-float="end"] { float: inline-end; }
        .reptoc-prose hr { clear: both; }

        /* Drag-to-resize chrome. The container is inline-block so the handles
           sit on the image's real box rather than the full column. */
        .reptoc-prose .reptoc-image-resizer {
          position: relative;
          display: block;
          max-width: 100%;
        }
        .reptoc-prose .reptoc-image-resizer-wrapper { position: relative; display: block; }
        .reptoc-prose .reptoc-image-handle {
          position: absolute;
          width: 14px;
          height: 14px;
          border-radius: 999px;
          background: #8b5cf6;
          border: 2px solid #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,.45);
          opacity: 0;
          transition: opacity .15s ease;
          touch-action: none;
        }
        .reptoc-prose .reptoc-image-resizer:hover .reptoc-image-handle,
        .reptoc-prose .reptoc-image-resizer.is-resizing .reptoc-image-handle { opacity: 1; }
        .reptoc-prose .reptoc-image-handle[data-resize-handle="top-left"] { cursor: nwse-resize; }
        .reptoc-prose .reptoc-image-handle[data-resize-handle="top-right"] { cursor: nesw-resize; }
        .reptoc-prose .reptoc-image-handle[data-resize-handle="bottom-left"] { cursor: nesw-resize; }
        .reptoc-prose .reptoc-image-handle[data-resize-handle="bottom-right"] { cursor: nwse-resize; }
        .reptoc-prose .reptoc-image-resizer.is-resizing { outline: 2px dashed #8b5cf6; outline-offset: 4px; }
        /* Images are draggable: show the grab affordance. */
        .reptoc-prose img { cursor: grab; }
        .reptoc-prose .ProseMirror-selectednode { cursor: grabbing; }
        /* Where a dragged image will land. */
        .reptoc-prose .ProseMirror-dropcursor { border-top: 3px solid #8b5cf6 !important; }
        .reptoc-prose img.ProseMirror-selectednode {
          outline: 3px solid #8b5cf6;
          outline-offset: 3px;
        }
        .reptoc-prose p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: ${direction === "rtl" ? "right" : "left"};
          height: 0;
          pointer-events: none;
          font-style: italic;
          color: ${isDark ? "#475569" : "#a8a29e"};
        }
        /* The scroller (not the prose itself) owns the height, so a floated
           illustration and the page sheet share one scrolling context. */
        .reptoc-canvas-scroller {
          max-height: ${focusMode ? "none" : "clamp(320px, 58vh, 720px)"};
        }
        @media (max-width: 767px) {
          .reptoc-prose {
            padding: ${pageSheet ? "1.25rem 1.15rem 2rem" : "1rem"};
            min-height: ${focusMode ? "calc(100vh - 190px)" : "220px"};
          }
          .reptoc-canvas-scroller { max-height: ${focusMode ? "none" : "56vh"}; }
          .reptoc-page-sheet { max-width: 100%; border-radius: 8px; }
          /* A floated illustration in a phone-width column leaves an unreadable
             ribbon of text, so wrapping is disabled below the tablet breakpoint. */
          .reptoc-prose img[data-float] { float: none; margin: 1.25rem auto; }
        }
      `}</style>

      {notice && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 px-4 py-2 text-[11px] font-bold ${
            notice.tone === "error" ? "bg-rose-500/15 text-rose-300" : "bg-violet-600/15 text-violet-200"
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            {notice.tone === "error" ? <X className="h-3.5 w-3.5 shrink-0" /> : <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
            <span className="break-words">{notice.message}</span>
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label="بستن پیام" className="shrink-0 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Toolbar. Groups wrap on phones instead of overflowing the card. */}
      <div
        className={`flex flex-wrap items-center gap-1 border-b p-2 ${
          isDark ? "border-violet-950/50 bg-[#080a15]/95" : "border-stone-200 bg-stone-50"
        }`}
        role="toolbar"
        aria-label="ابزارهای نگارش"
      >
        <button type="button" disabled={readOnly} onClick={() => editor.chain().focus().toggleBold().run()} className={toolButton(!!toolbar?.bold)} title="توپر (Ctrl+B)" aria-label="توپر"><Bold className="h-4 w-4" /></button>
        <button type="button" disabled={readOnly} onClick={() => editor.chain().focus().toggleItalic().run()} className={toolButton(!!toolbar?.italic)} title="مورب (Ctrl+I)" aria-label="مورب"><Italic className="h-4 w-4" /></button>
        <button type="button" disabled={readOnly} onClick={() => editor.chain().focus().toggleUnderline().run()} className={toolButton(!!toolbar?.underline)} title="زیرخط (Ctrl+U)" aria-label="زیرخط"><UnderlineIcon className="h-4 w-4" /></button>
        <button type="button" disabled={readOnly} onClick={() => editor.chain().focus().toggleStrike().run()} className={toolButton(!!toolbar?.strike)} title="خط‌خورده" aria-label="خط‌خورده"><Strikethrough className="h-4 w-4" /></button>

        <span className={`mx-1 h-6 w-px ${isDark ? "bg-slate-800" : "bg-stone-200"}`} aria-hidden="true" />

        <button type="button" disabled={readOnly} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={toolButton(!!toolbar?.heading1)} title="عنوان بزرگ" aria-label="عنوان بزرگ"><Heading1 className="h-4 w-4" /></button>
        <button type="button" disabled={readOnly} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={toolButton(!!toolbar?.heading2)} title="عنوان متوسط" aria-label="عنوان متوسط"><Heading2 className="h-4 w-4" /></button>
        <button type="button" disabled={readOnly} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={toolButton(!!toolbar?.heading3)} title="عنوان کوچک" aria-label="عنوان کوچک"><Heading3 className="h-4 w-4" /></button>

        <span className={`mx-1 h-6 w-px ${isDark ? "bg-slate-800" : "bg-stone-200"}`} aria-hidden="true" />

        <button type="button" disabled={readOnly} onClick={() => editor.chain().focus().toggleBulletList().run()} className={toolButton(!!toolbar?.bulletList)} title="فهرست نقطه‌ای" aria-label="فهرست نقطه‌ای"><List className="h-4 w-4" /></button>
        <button type="button" disabled={readOnly} onClick={() => editor.chain().focus().toggleOrderedList().run()} className={toolButton(!!toolbar?.orderedList)} title="فهرست شماره‌ای" aria-label="فهرست شماره‌ای"><ListOrdered className="h-4 w-4" /></button>
        <button type="button" disabled={readOnly} onClick={() => editor.chain().focus().toggleBlockquote().run()} className={toolButton(!!toolbar?.blockquote)} title="نقل قول" aria-label="نقل قول"><Quote className="h-4 w-4" /></button>
        <button type="button" disabled={readOnly} onClick={() => editor.chain().focus().setHorizontalRule().run()} className={toolButton(false)} title="جداکننده صحنه" aria-label="جداکننده صحنه"><Minus className="h-4 w-4" /></button>

        <span className={`mx-1 h-6 w-px ${isDark ? "bg-slate-800" : "bg-stone-200"}`} aria-hidden="true" />

        {/* Images: upload from the device, or reference an approved HTTPS URL. */}
        <button
          type="button"
          disabled={readOnly || uploadingImages > 0}
          onClick={() => imageInputRef.current?.click()}
          className={toolButton(false)}
          title="بارگذاری تصویر از دستگاه"
          aria-label="بارگذاری تصویر از دستگاه"
        >
          {uploadingImages > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        </button>
        <button type="button" disabled={readOnly} onClick={() => openPanel("image")} className={toolButton(panel === "image")} title="درج تصویر با نشانی" aria-label="درج تصویر با نشانی"><ImagePlus className="h-4 w-4" /></button>
        <button type="button" disabled={readOnly} onClick={() => openPanel("link")} className={toolButton(panel === "link" || !!toolbar?.link)} title="پیوند" aria-label="پیوند"><Link2 className="h-4 w-4" /></button>
        {internalLinks.length > 0 && (
          <button type="button" disabled={readOnly} onClick={() => openPanel("internal")} className={toolButton(panel === "internal")} title="پیوند به موجودیت جهان‌سازی" aria-label="پیوند داخلی"><Shuffle className="h-4 w-4" /></button>
        )}

        <span className={`mx-1 h-6 w-px ${isDark ? "bg-slate-800" : "bg-stone-200"}`} aria-hidden="true" />

        {/* Manuscript tools: jump list, search & replace, canvas typography. */}
        <button
          type="button"
          onClick={() => openPanel("outline")}
          className={toolButton(panel === "outline")}
          title="ساختار فصل: پیمایش میان عنوان‌ها و صحنه‌ها"
          aria-label="ساختار فصل"
        >
          <ScanEye className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            openPanel("find");
            window.setTimeout(() => findInputRef.current?.focus(), 0);
          }}
          className={toolButton(panel === "find")}
          title="جست‌وجو و جای‌گزینی (Ctrl+F)"
          aria-label="جست‌وجو و جای‌گزینی"
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => openPanel("typography")}
          className={toolButton(panel === "typography")}
          title="تنظیمات بوم نگارش: قلم، اندازه و فاصله خطوط"
          aria-label="تنظیمات بوم نگارش"
        >
          <Type className="h-4 w-4" />
        </button>

        <span className={`mx-1 h-6 w-px ${isDark ? "bg-slate-800" : "bg-stone-200"}`} aria-hidden="true" />

        <button type="button" disabled={readOnly || !toolbar?.canUndo} onClick={() => editor.chain().focus().undo().run()} className={toolButton(false)} title="واگرد (Ctrl+Z)" aria-label="واگرد"><Undo className="h-4 w-4" /></button>
        <button type="button" disabled={readOnly || !toolbar?.canRedo} onClick={() => editor.chain().focus().redo().run()} className={toolButton(false)} title="ازنو (Ctrl+Shift+Z)" aria-label="ازنو"><Redo className="h-4 w-4" /></button>

        <div className="ms-auto flex flex-wrap items-center gap-1">
          <button
            type="button"
            disabled={readOnly}
            onClick={applyPersianTypography}
            className={`inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-bold text-emerald-400 transition-colors hover:bg-emerald-500 hover:text-white disabled:opacity-40`}
            title="اصلاح نگارش فارسی: نیم‌فاصله، ی/ک فارسی، ارقام و نشانه‌گذاری"
          >
            <Languages className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">آراستن فارسی</span>
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={pasteWithoutFormatting}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
              isDark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-stone-200 text-stone-700 hover:bg-stone-100"
            } disabled:opacity-40`}
            title="چسباندن متن خالص بدون قالب‌بندی"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">چسباندن ساده</span>
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => openPanel("import")}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
              panel === "import"
                ? "border-violet-500 bg-violet-600 text-white"
                : isDark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-stone-200 text-stone-700 hover:bg-stone-100"
            } disabled:opacity-40`}
            title="ورود متن از PDF، Word یا پیوند"
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">ورود سند</span>
          </button>
          {aiButtonVisible && (
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setShowAIPrompt((value) => !value)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                showAIPrompt ? "border-purple-500/50 bg-purple-500/20 text-purple-300" : "border-transparent text-slate-500 hover:bg-purple-500/10 hover:text-purple-300"
              } disabled:opacity-40`}
              title="دستیار نگارش هوش مصنوعی"
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">دستیار</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setFocusMode((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-orange-500/25 bg-orange-500/10 px-2.5 py-1.5 text-[11px] font-bold text-orange-400 transition-colors hover:bg-orange-500 hover:text-white"
            title={focusMode ? "خروج از حالت تمرکز (Esc)" : "حالت تمرکز تمام‌صفحه"}
          >
            {focusMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{focusMode ? "خروج" : "تمرکز"}</span>
          </button>
        </div>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept={EDITOR_IMAGE_MIME_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          void insertImages(files);
        }}
      />

      {/* Contextual image controls appear only while an image is selected. */}
      {toolbar?.image && !readOnly && (
        <div className={`flex flex-wrap items-center gap-2 border-b px-3 py-2 ${isDark ? "border-violet-950/50 bg-[#0b0716]" : "border-stone-200 bg-stone-50"}`}>
          <span className="text-[10px] font-black uppercase tracking-wider text-violet-400">تصویر انتخاب‌شده</span>
          <span className="hidden text-[10px] text-slate-500 sm:inline">گوشه‌ها را بکشید تا اندازه تغییر کند · تصویر را بگیرید و جابه‌جا کنید</span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-500">اندازه:</span>
            <button type="button" className={chipButton(!toolbar.image.pixels && toolbar.image.width === "small")} onClick={() => applyImageAttributes({ displayWidth: "small" })}>کوچک</button>
            <button type="button" className={chipButton(!toolbar.image.pixels && toolbar.image.width === "medium")} onClick={() => applyImageAttributes({ displayWidth: "medium" })}>متوسط</button>
            <button type="button" className={chipButton(!toolbar.image.pixels && toolbar.image.width === "full")} onClick={() => applyImageAttributes({ displayWidth: "full" })}>تمام‌عرض</button>
          </div>

          {/* Free width, either dragged from a corner handle or typed here. */}
          <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <span>عرض دلخواه:</span>
            <input
              type="number"
              min={IMAGE_MIN_PIXELS}
              max={IMAGE_MAX_PIXELS}
              step={10}
              value={toolbar.image.pixels ?? ""}
              placeholder="خودکار"
              onChange={(event) => {
                const raw = event.target.value.trim();
                applyImageAttributes({ width: raw ? clampImageWidth(raw) : null });
              }}
              className={`w-20 rounded-lg border px-2 py-1 text-[11px] ${
                isDark ? "border-violet-950 bg-[#0b0716] text-white" : "border-stone-200 bg-white text-stone-900"
              }`}
            />
            <span>px</span>
            {toolbar.image.pixels && (
              <button
                type="button"
                onClick={() => applyImageAttributes({ width: null })}
                className="rounded-lg px-1.5 py-0.5 text-[10px] font-bold text-violet-400 hover:bg-violet-500/10"
                title="بازگشت به اندازهٔ پیش‌فرض"
              >
                بازنشانی
              </button>
            )}
          </label>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-500">چیدمان:</span>
            <button type="button" aria-label="چیدمان آغاز" className={chipButton(toolbar.image.align === "start")} onClick={() => applyImageAttributes({ alignment: "start" })}><AlignRight className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="چیدمان میانه" className={chipButton(toolbar.image.align === "center")} onClick={() => applyImageAttributes({ alignment: "center" })}><AlignCenter className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="چیدمان پایان" className={chipButton(toolbar.image.align === "end")} onClick={() => applyImageAttributes({ alignment: "end" })}><AlignLeft className="h-3.5 w-3.5" /></button>
          </div>

          {/* Text wrapping. "بدون گردش" keeps the illustration on its own line. */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-500">گردش متن:</span>
            <button type="button" className={chipButton(toolbar.image.float === "none")} onClick={() => applyImageAttributes({ float: "none" })}>بدون گردش</button>
            <button type="button" className={chipButton(toolbar.image.float === "start")} onClick={() => applyImageAttributes({ float: "start", displayWidth: toolbar.image.width === "full" ? "small" : toolbar.image.width })}>راست</button>
            <button type="button" className={chipButton(toolbar.image.float === "end")} onClick={() => applyImageAttributes({ float: "end", displayWidth: toolbar.image.width === "full" ? "small" : toolbar.image.width })}>چپ</button>
          </div>

          {/* Move the picture between paragraphs without dragging: precise on a
              phone and reachable from the keyboard. */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-500">جابه‌جایی:</span>
            <button type="button" aria-label="انتقال تصویر به بالا" title="انتقال تصویر یک بلوک به بالا" className={chipButton(false)} onClick={() => moveSelectedImage(-1)}><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="انتقال تصویر به پایین" title="انتقال تصویر یک بلوک به پایین" className={chipButton(false)} onClick={() => moveSelectedImage(1)}><ArrowDown className="h-3.5 w-3.5" /></button>
          </div>

          {/* Alt text is what a screen reader announces and what shows when the
              image fails to load, so it is edited in place rather than only on
              insert. */}
          <label className="flex min-w-44 flex-1 items-center gap-1.5 text-[10px] text-slate-500">
            <span className="shrink-0">متن جانشین:</span>
            <input
              type="text"
              value={toolbar.image.alt}
              onChange={(event) => applyImageAttributes({ alt: event.target.value.slice(0, 200) })}
              placeholder="توضیح کوتاه تصویر برای دسترس‌پذیری"
              className={`w-full rounded-lg border px-2 py-1 text-[11px] ${
                isDark ? "border-violet-950 bg-[#0b0716] text-white" : "border-stone-200 bg-white text-stone-900"
              }`}
            />
          </label>

          <button
            type="button"
            onClick={() => editor.chain().focus().deleteSelection().run()}
            className="ms-auto inline-flex items-center gap-1 rounded-lg bg-rose-500/15 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-600 hover:text-white"
          >
            <Trash2 className="h-3.5 w-3.5" /> حذف تصویر
          </button>
        </div>
      )}

      {panel === "link" && (
        <div className={`flex flex-wrap items-end gap-2 border-b p-3 ${isDark ? "border-violet-950/50" : "border-stone-200"}`}>
          <label className="min-w-52 flex-1 text-[11px] font-bold">
            نشانی پیوند
            <input className={inputClass} type="url" value={linkValue} onChange={(event) => setLinkValue(event.target.value)} placeholder="https://…" />
          </label>
          <button
            type="button"
            className="rounded-xl bg-violet-600 px-4 py-2 text-[11px] font-bold text-white disabled:opacity-40"
            disabled={!linkValue.trim()}
            onClick={() => {
              editor.chain().focus().extendMarkRange("link").setLink({ href: linkValue.trim() }).run();
              setLinkValue("");
              setPanel(null);
            }}
          >
            اعمال
          </button>
          {toolbar?.link && (
            <button
              type="button"
              className={`rounded-xl border px-4 py-2 text-[11px] font-bold ${isDark ? "border-slate-700 text-slate-300" : "border-stone-200 text-stone-700"}`}
              onClick={() => { editor.chain().focus().unsetLink().run(); setPanel(null); }}
            >
              حذف پیوند
            </button>
          )}
        </div>
      )}

      {panel === "image" && (
        <div className={`grid gap-2 border-b p-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end ${isDark ? "border-violet-950/50" : "border-stone-200"}`}>
          <label className="text-[11px] font-bold">
            نشانی تصویر (HTTPS یا فایل بارگذاری‌شده)
            <input className={inputClass} type="url" value={imageUrlValue} onChange={(event) => setImageUrlValue(event.target.value)} placeholder="https://…" />
          </label>
          <label className="text-[11px] font-bold">
            متن جانشین
            <input className={inputClass} type="text" value={imageAltValue} onChange={(event) => setImageAltValue(event.target.value)} placeholder="توضیح کوتاه تصویر" />
          </label>
          <button
            type="button"
            className="h-9 rounded-xl bg-violet-600 px-4 text-[11px] font-bold text-white disabled:opacity-40"
            disabled={!imageUrlValue.trim()}
            onClick={() => {
              const source = imageUrlValue.trim();
              if (!isDisplayableImageSource(source)) {
                announce("نشانی تصویر باید HTTPS یا یک فایل بارگذاری‌شده در رپتوک باشد.", "error");
                return;
              }
              editor.chain().focus().setImage({ src: source, alt: imageAltValue.trim() || "تصویر فصل" } as any).run();
              setImageUrlValue("");
              setImageAltValue("");
              setPanel(null);
              announce("تصویر درج شد.");
            }}
          >
            درج
          </button>
        </div>
      )}

      {panel === "internal" && internalLinks.length > 0 && (
        <div className={`flex flex-wrap items-end gap-2 border-b p-3 ${isDark ? "border-violet-950/50" : "border-stone-200"}`}>
          <label className="min-w-52 flex-1 text-[11px] font-bold">
            موجودیت جهان‌سازی
            <select className={inputClass} value={linkValue} onChange={(event) => setLinkValue(event.target.value)}>
              <option value="">انتخاب یک موجودیت</option>
              {internalLinks.map((item) => <option key={item.id} value={item.href}>{item.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="rounded-xl bg-violet-600 px-4 py-2 text-[11px] font-bold text-white disabled:opacity-40"
            disabled={!linkValue}
            onClick={() => {
              editor.chain().focus().extendMarkRange("link").setLink({ href: linkValue }).run();
              setLinkValue("");
              setPanel(null);
            }}
          >
            درج پیوند
          </button>
        </div>
      )}

      {panel === "import" && (
        <div className={`space-y-3 border-b p-3 ${isDark ? "border-violet-950/50" : "border-stone-200"}`}>
          <input
            ref={documentInputRef}
            type="file"
            accept=".pdf,.docx,.doc"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importDocument(file);
            }}
          />
          <button
            type="button"
            disabled={importLoading}
            onClick={() => documentInputRef.current?.click()}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed py-3 text-xs font-bold transition-colors disabled:opacity-50 ${
              isDark ? "border-slate-700 text-slate-300 hover:border-violet-500" : "border-stone-300 text-stone-700 hover:border-violet-500"
            }`}
          >
            {importLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            {importLoading ? "در حال استخراج متن…" : "انتخاب سند PDF یا Word"}
          </button>
          <div className="flex gap-2">
            <input className={inputClass} type="url" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="https://docs.google.com/document/d/…" />
            <button
              type="button"
              disabled={importLoading || !importUrl.trim()}
              onClick={() => void importFromUrl()}
              className="shrink-0 rounded-xl bg-emerald-600 px-4 text-[11px] font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              دریافت
            </button>
          </div>
        </div>
      )}

      {/* Find & replace. The document is never annotated: matches are located by
          position and shown through the ordinary text selection, so searching
          can never alter the author's markup. */}
      {panel === "find" && (
        <div className={`space-y-2 border-b p-3 ${isDark ? "border-violet-950/50 bg-[#0b0716]" : "border-stone-200 bg-stone-50"}`}>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-44 flex-1 text-[11px] font-bold">
              جست‌وجو
              <input
                ref={findInputRef}
                className={inputClass}
                type="search"
                value={findQuery}
                onChange={(event) => {
                  setFindQuery(event.target.value);
                  setFindCursor(0);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  focusFindMatch(event.shiftKey ? findCursor - 1 : findCursor + (findMatches.length && findCursor === 0 ? 0 : 1));
                }}
                placeholder="واژه یا عبارت"
              />
            </label>
            {!readOnly && (
              <label className="min-w-44 flex-1 text-[11px] font-bold">
                جای‌گزینی با
                <input
                  className={inputClass}
                  type="text"
                  value={replaceValue}
                  onChange={(event) => setReplaceValue(event.target.value)}
                  placeholder="متن جانشین (می‌تواند خالی باشد)"
                />
              </label>
            )}
            <div className="flex items-center gap-1 pb-1">
              <button
                type="button"
                className={chipButton(findCaseSensitive)}
                onClick={() => setFindCaseSensitive((value) => !value)}
                title="تفاوت حروف بزرگ و کوچک"
                aria-pressed={findCaseSensitive}
              >
                <CaseSensitive className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={findMatches.length === 0}
                onClick={() => focusFindMatch(findCursor - 1)}
                className={chipButton(false)}
                title="مورد قبلی (Shift+Enter)"
                aria-label="مورد قبلی"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={findMatches.length === 0}
                onClick={() => focusFindMatch(findCursor + 1)}
                className={chipButton(false)}
                title="مورد بعدی (Enter)"
                aria-label="مورد بعدی"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500" role="status">
              {findQuery.trim()
                ? findMatches.length
                  ? `مورد ${(findCursor + 1).toLocaleString("fa-IR")} از ${findMatches.length.toLocaleString("fa-IR")}`
                  : "موردی یافت نشد"
                : "برای یافتن، عبارتی بنویسید"}
            </span>
            {!readOnly && (
              <>
                <button
                  type="button"
                  disabled={findMatches.length === 0}
                  onClick={replaceCurrentMatch}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-violet-500 disabled:opacity-40"
                >
                  <Replace className="h-3.5 w-3.5" /> جای‌گزینی
                </button>
                <button
                  type="button"
                  disabled={findMatches.length === 0}
                  onClick={replaceAllMatches}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-bold disabled:opacity-40 ${
                    isDark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-stone-200 text-stone-700 hover:bg-stone-100"
                  }`}
                >
                  <Replace className="h-3.5 w-3.5" /> جای‌گزینی همه
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => openPanel("shortcuts")}
              className="ms-auto inline-flex items-center gap-1.5 rounded-xl px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-violet-400"
            >
              <Keyboard className="h-3.5 w-3.5" /> کلیدهای میان‌بر
            </button>
          </div>
        </div>
      )}

      {/* Canvas typography. Stored per author, so the writing surface stays the
          same across chapters and sessions. */}
      {panel === "typography" && (
        <div className={`space-y-3 border-b p-3 ${isDark ? "border-violet-950/50 bg-[#0b0716]" : "border-stone-200 bg-stone-50"}`}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold text-slate-500">قلم:</span>
              <button type="button" className={chipButton(canvas.font === "estedad")} onClick={() => updateCanvas({ font: "estedad" })}>استعداد</button>
              <button type="button" className={chipButton(canvas.font === "vazirmatn")} onClick={() => updateCanvas({ font: "vazirmatn" })}>وزیرمتن</button>
              <button type="button" className={chipButton(canvas.font === "serif")} onClick={() => updateCanvas({ font: "serif" })}>سریف کتابی</button>
              <button type="button" className={chipButton(canvas.font === "amiri")} onClick={() => updateCanvas({ font: "amiri" })}>امیری</button>
            </div>

            <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
              <span>اندازه: {canvas.fontSize.toLocaleString("fa-IR")}px</span>
              <input
                type="range"
                min={CANVAS_FONT_SIZE_RANGE.min}
                max={CANVAS_FONT_SIZE_RANGE.max}
                step={1}
                value={canvas.fontSize}
                onChange={(event) => updateCanvas({ fontSize: Number(event.target.value) })}
                className="w-28 accent-violet-500"
                aria-label="اندازه قلم بوم نگارش"
              />
            </label>

            <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
              <span>فاصله خطوط: {canvas.lineHeight.toLocaleString("fa-IR")}</span>
              <input
                type="range"
                min={CANVAS_LINE_HEIGHT_RANGE.min}
                max={CANVAS_LINE_HEIGHT_RANGE.max}
                step={0.1}
                value={canvas.lineHeight}
                onChange={(event) => updateCanvas({ lineHeight: Number(event.target.value) })}
                className="w-28 accent-violet-500"
                aria-label="فاصله خطوط بوم نگارش"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={chipButton(canvas.pageView)} onClick={() => updateCanvas({ pageView: !canvas.pageView })} aria-pressed={canvas.pageView}>
              نمای صفحه‌ای
            </button>
            <button type="button" className={chipButton(canvas.spotlight)} onClick={() => updateCanvas({ spotlight: !canvas.spotlight })} aria-pressed={canvas.spotlight}>
              نورافکن پاراگراف
            </button>
            <button type="button" className={chipButton(canvas.typewriter)} onClick={() => updateCanvas({ typewriter: !canvas.typewriter })} aria-pressed={canvas.typewriter}>
              پیمایش ماشین‌تحریری
            </button>
          </div>

          <div className="grid gap-3 rounded-xl border border-current/10 p-3 sm:grid-cols-2">
            <div>
              <span className="mb-2 block text-[10px] font-black text-slate-500">نوع کاغذ و خط‌بندی</span>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={chipButton(canvas.paperStyle === "plain")} onClick={() => updateCanvas({ paperStyle: "plain" })}>ساده</button>
                <button type="button" className={chipButton(canvas.paperStyle === "ruled")} onClick={() => updateCanvas({ paperStyle: "ruled" })}>خط‌دار</button>
                <button type="button" className={chipButton(canvas.paperStyle === "grid")} onClick={() => updateCanvas({ paperStyle: "grid" })}>شطرنجی</button>
              </div>
            </div>
            <div>
              <span className="mb-2 block text-[10px] font-black text-slate-500">حاشیه صفحه</span>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={chipButton(canvas.pageMargin === "compact")} onClick={() => updateCanvas({ pageMargin: "compact" })}>کم</button>
                <button type="button" className={chipButton(canvas.pageMargin === "standard")} onClick={() => updateCanvas({ pageMargin: "standard" })}>استاندارد</button>
                <button type="button" className={chipButton(canvas.pageMargin === "wide")} onClick={() => updateCanvas({ pageMargin: "wide" })}>عریض</button>
              </div>
            </div>
            <button type="button" className={chipButton(canvas.twoPage)} onClick={() => updateCanvas({ twoPage: !canvas.twoPage })} aria-pressed={canvas.twoPage}>نمای دوصفحه‌ای</button>
            <button type="button" className={chipButton(canvas.pageNumbers)} onClick={() => updateCanvas({ pageNumbers: !canvas.pageNumbers })} aria-pressed={canvas.pageNumbers}>شماره صفحه</button>
          </div>

          <div className="space-y-3 rounded-xl border border-current/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-black text-slate-500">اندازه و ابعاد کتاب</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: "جمع‌وجور", width: 820, height: 560 },
                  { label: "استاندارد", width: 1040, height: 640 },
                  { label: "بزرگ", width: 1320, height: 820 },
                ].map((size) => (
                  <button
                    key={size.label}
                    type="button"
                    className={chipButton(canvas.bookWidth === size.width && canvas.bookHeight === size.height)}
                    onClick={() => updateCanvas({ bookWidth: size.width, bookHeight: size.height })}
                  >
                    {size.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                <span className="min-w-20">عرض: {canvas.bookWidth.toLocaleString("fa-IR")}px</span>
                <input type="range" min={CANVAS_BOOK_WIDTH_RANGE.min} max={CANVAS_BOOK_WIDTH_RANGE.max} step={20} value={canvas.bookWidth} onChange={(event) => updateCanvas({ bookWidth: Number(event.target.value) })} className="min-w-0 flex-1 accent-violet-500" aria-label="عرض کتاب در پنل نویسندگی" />
              </label>
              <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                <span className="min-w-20">ارتفاع: {canvas.bookHeight.toLocaleString("fa-IR")}px</span>
                <input type="range" min={CANVAS_BOOK_HEIGHT_RANGE.min} max={CANVAS_BOOK_HEIGHT_RANGE.max} step={20} value={canvas.bookHeight} onChange={(event) => updateCanvas({ bookHeight: Number(event.target.value) })} className="min-w-0 flex-1 accent-violet-500" aria-label="ارتفاع کتاب در پنل نویسندگی" />
              </label>
            </div>
            <p className="text-[10px] leading-5 text-slate-500">در موبایل، ابعاد به‌صورت خودکار با صفحه سازگار می‌شود تا متن از قاب بیرون نزند.</p>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => updateCanvas(DEFAULT_CANVAS_PREFERENCES)}
              className={`ms-auto rounded-xl border px-3 py-1.5 text-[11px] font-bold ${
                isDark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-stone-200 text-stone-700 hover:bg-stone-100"
              }`}
            >
              بازگشت به پیش‌فرض
            </button>
          </div>
        </div>
      )}

      {/* Chapter outline: headings and scene dividers with the word count of
          each section, which is how an author spots a scene that ran long. */}
      {panel === "outline" && (
        <div className={`space-y-2 border-b p-3 ${isDark ? "border-violet-950/50 bg-[#0b0716]" : "border-stone-200 bg-stone-50"}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-violet-400">ساختار فصل</span>
            <span className="text-[10px] font-bold text-slate-500">
              {outline.length ? `${outline.length.toLocaleString("fa-IR")} بخش` : "بدون عنوان یا جداکننده"}
            </span>
          </div>
          {outline.length === 0 ? (
            <p className="text-[11px] text-slate-500">
              با افزودن عنوان (H1 تا H3) یا جداکنندهٔ صحنه، فهرست پیمایش این فصل ساخته می‌شود.
            </p>
          ) : (
            <ul className="max-h-52 space-y-1 overflow-y-auto pe-1">
              {outline.map((entry) => {
                const isActive = typeof outlineState?.caret === "number" && outlineState.caret >= entry.position;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => jumpToOutlineEntry(entry)}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-start text-[11px] font-bold transition-colors ${
                        isActive
                          ? "bg-violet-600/15 text-violet-300"
                          : isDark ? "text-slate-300 hover:bg-slate-800/70" : "text-stone-700 hover:bg-stone-100"
                      }`}
                      style={{ paddingInlineStart: `${0.6 + Math.max(0, entry.level - 1) * 0.85}rem` }}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {entry.level === 0 ? "— جداکنندهٔ صحنه —" : entry.text}
                      </span>
                      <span className="shrink-0 text-[10px] font-mono text-slate-500">
                        {entry.words.toLocaleString("fa-IR")} واژه
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {panel === "shortcuts" && (
        <div className={`border-b p-3 ${isDark ? "border-violet-950/50 bg-[#0b0716]" : "border-stone-200 bg-stone-50"}`}>
          <div className="grid gap-1.5 text-[11px] sm:grid-cols-2">
            {[
              ["Ctrl/Cmd + B", "توپر"],
              ["Ctrl/Cmd + I", "مورب"],
              ["Ctrl/Cmd + U", "زیرخط"],
              ["Ctrl/Cmd + Z", "واگرد"],
              ["Ctrl/Cmd + Shift + Z", "ازنو"],
              ["Ctrl/Cmd + F", "جست‌وجو"],
              ["Ctrl/Cmd + H", "جای‌گزینی"],
              ["Ctrl/Cmd + Shift + F", "حالت تمرکز"],
              ["Enter / Shift+Enter", "مورد بعدی / قبلی جست‌وجو"],
              ["Esc", "بستن پنل یا خروج از تمرکز"],
            ].map(([keys, description]) => (
              <div key={keys} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1">
                <span className="text-slate-500">{description}</span>
                <kbd className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${isDark ? "border-slate-700 text-slate-300" : "border-stone-300 text-stone-700"}`}>{keys}</kbd>
              </div>
            ))}
          </div>
        </div>
      )}

      {aiButtonVisible && showAIPrompt && (
        <div className={`space-y-2 border-b p-3 ${isDark ? "border-violet-950/50 bg-[#0c0f20]" : "border-stone-200 bg-stone-50"}`}>
          {!aiConfigured ? (
            <p className="text-[11px] font-bold text-amber-500">این بخش از پنل مدیریت تنظیم نشده است.</p>
          ) : (
            <>
              <label className="flex items-center gap-1 text-[10px] font-black uppercase text-slate-400">
                <Sparkles className="h-3 w-3 text-purple-400" /> درخواست شما به هوش مصنوعی
              </label>
              <textarea
                className={`${inputClass} resize-none`}
                rows={2}
                placeholder="مثلاً: این صحنه را با توصیف جنگل جادویی گسترش بده."
                value={aiPromptText}
                onChange={(event) => setAiPromptText(event.target.value)}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleGenerateAI}
                  disabled={isAILoading || !aiPromptText.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-1.5 text-[11px] font-bold text-white hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500"
                >
                  {isAILoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                  {isAILoading ? "در حال تولید…" : "تولید متن"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Writing canvas. Drop an image anywhere on it to upload and insert. */}
      {bookMode && (
        <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-[11px] font-bold ${isDark ? "border-violet-950/50 bg-[#090711] text-slate-300" : "border-stone-200 bg-amber-50 text-stone-700"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span>صفحهٔ فعال</span>
            <button type="button" disabled={bookPagination.current <= 1} onClick={() => jumpToBookPage(bookPagination.current - 1)} className={chipButton(false)} aria-label="صفحه قبلی">قبلی</button>
            <select value={bookPagination.current} onChange={(event) => jumpToBookPage(Number(event.target.value))} className={`rounded-lg border px-2 py-1 outline-none ${isDark ? "border-slate-700 bg-slate-900 text-white" : "border-stone-300 bg-white text-stone-900"}`} aria-label="انتخاب صفحهٔ کتاب">
              {Array.from({ length: bookPagination.count }, (_, index) => <option key={index + 1} value={index + 1}>صفحه {(index + 1).toLocaleString("fa-IR")}</option>)}
            </select>
            <span>از {bookPagination.count.toLocaleString("fa-IR")}</span>
            <button type="button" disabled={bookPagination.current >= bookPagination.count} onClick={() => jumpToBookPage(bookPagination.current + 1)} className={chipButton(false)} aria-label="صفحه بعدی">بعدی</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500">Enter: خط بعد · Ctrl/⌘+Enter: صفحه جدید</span>
            {!readOnly && <button type="button" onClick={insertBookPage} className="rounded-lg bg-amber-600 px-3 py-1.5 font-black text-white hover:bg-amber-500">+ صفحهٔ جدید</button>}
          </div>
        </div>
      )}
      <div
        ref={scrollerRef}
        className={`reptoc-canvas-scroller relative flex-1 overflow-y-auto ${
          focusMode
            ? isDark ? "bg-[#05060c] text-slate-200" : "bg-stone-100 text-stone-900"
            : pageSheet
              ? isDark ? "bg-[#05060c] text-slate-200" : "bg-stone-100 text-stone-900"
              : isDark ? "bg-[#04050e] text-slate-200" : "bg-white text-stone-900"
        }`}
        onDragOver={(event) => {
          if (readOnly || !Array.from(event.dataTransfer?.types || []).includes("Files")) return;
          event.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={() => setDropActive(false)}
      >
        <div className={pageSheet ? `reptoc-page-sheet ${focusMode ? "is-focus my-8" : "my-5"}` : "w-full"}>
          <EditorContent editor={editor} />
        </div>
        {dropActive && !readOnly && (
          <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-violet-500 bg-violet-600/10 text-xs font-bold text-violet-200">
            تصویر را رها کنید تا بارگذاری و در فصل درج شود
          </div>
        )}
        {uploadingImages > 0 && (
          <div className="pointer-events-none absolute bottom-3 end-3 flex items-center gap-2 rounded-full bg-violet-600/90 px-3 py-1.5 text-[11px] font-bold text-white">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            در حال بارگذاری {uploadingImages} تصویر…
          </div>
        )}
      </div>

      {/* Status bar: live counts, reading time, and the chapter word goal. */}
      <div
        className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-4 py-2 text-[11px] font-bold ${
          isDark ? "border-violet-950/50 bg-[#060810] text-slate-400" : "border-stone-200 bg-stone-50 text-stone-500"
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1">
            <FileText className="h-3.5 w-3.5 text-violet-500" />
            {words.toLocaleString("fa-IR")} واژه
          </span>
          <span aria-hidden="true">•</span>
          <span>{statistics.characters.toLocaleString("fa-IR")} نویسه</span>
          <span aria-hidden="true">•</span>
          <span>{readingMinutes > 0 ? `${readingMinutes.toLocaleString("fa-IR")} دقیقه مطالعه` : "بدون محتوا"}</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {goal > 0 && (
            <span className="flex items-center gap-2">
              <span>هدف: {goalPercent.toLocaleString("fa-IR")}%</span>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-700/40">
                <span className="block h-full rounded-full bg-violet-500 transition-all" style={{ width: `${goalPercent}%` }} />
              </span>
            </span>
          )}
          {readOnly ? (
            <span className="text-amber-500">حالت فقط‌خواندنی</span>
          ) : (
            <span className="text-violet-500">ذخیره خودکار پیش‌نویس فعال است</span>
          )}
        </div>
      </div>
    </div>
  );
}
