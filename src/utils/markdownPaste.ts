export interface TiptapPasteMark {
  type: "bold" | "italic" | "strike" | "code" | "link";
  attrs?: Record<string, unknown>;
}

export interface TiptapPasteNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapPasteNode[];
  marks?: TiptapPasteMark[];
  text?: string;
}

const MARKDOWN_BLOCK = /(^|\n)[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-+*][ \t]+|\d+[.)][ \t]+|```|~~~|(?:-{3,}|\*{3,}|_{3,})[ \t]*(?:\n|$))/m;
const MARKDOWN_INLINE = /(?:\*\*\S(?:[^\n]*?\S)?\*\*|__\S(?:[^\n]*?\S)?__|~~\S(?:[^\n]*?\S)?~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)|(?:^|[\s(])\*[^*\n]+\*(?=$|[\s.,!?;)])|(?:^|[\s(])_[^_\n]+_(?=$|[\s.,!?;)]))/m;

export function looksLikeMarkdown(value: string): boolean {
  const text = String(value || "").replace(/\r\n?/g, "\n");
  return MARKDOWN_BLOCK.test(text) || MARKDOWN_INLINE.test(text);
}

function marksMatch(left: TiptapPasteMark[] | undefined, right: TiptapPasteMark[] | undefined) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function appendText(nodes: TiptapPasteNode[], text: string, marks?: TiptapPasteMark[]) {
  if (!text) return;
  const previous = nodes[nodes.length - 1];
  if (previous?.type === "text" && marksMatch(previous.marks, marks)) {
    previous.text = `${previous.text || ""}${text}`;
    return;
  }
  nodes.push({ type: "text", text, ...(marks?.length ? { marks } : {}) });
}

function withMark(nodes: TiptapPasteNode[], mark: TiptapPasteMark): TiptapPasteNode[] {
  return nodes.map((node) => {
    if (node.type !== "text") return node;
    const marks = node.marks || [];
    return marks.some((candidate) => candidate.type === mark.type)
      ? node
      : { ...node, marks: [...marks, mark] };
  });
}

function safeMarkdownHref(value: string): string | null {
  const href = value.trim();
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return null;
  if (/^(?:https?:|mailto:)/i.test(href) || /^(?:#|\/|\.\/|\.\.\/)/.test(href)) return href;
  return /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//") ? null : href;
}

function closingDelimiter(source: string, delimiter: string, from: number) {
  let index = source.indexOf(delimiter, from);
  while (index >= 0) {
    if (index > from && !/\s/.test(source[index - 1])) return index;
    index = source.indexOf(delimiter, index + delimiter.length);
  }
  return -1;
}

function parseInlineMarkdown(source: string, depth = 0): TiptapPasteNode[] {
  if (!source || depth > 20) return source ? [{ type: "text", text: source }] : [];

  const nodes: TiptapPasteNode[] = [];
  let buffer = "";
  let index = 0;
  const flush = () => {
    appendText(nodes, buffer);
    buffer = "";
  };

  while (index < source.length) {
    if (source[index] === "\n") {
      const hardBreak = buffer.endsWith("  ") || buffer.endsWith("\\");
      if (hardBreak) {
        buffer = buffer.slice(0, buffer.endsWith("  ") ? -2 : -1);
        flush();
        nodes.push({ type: "hardBreak" });
      } else if (!buffer.endsWith(" ")) {
        buffer += " ";
      }
      index += 1;
      continue;
    }

    if (source[index] === "\\" && index + 1 < source.length && /[\\`*_[\]{}()#+.!>|~-]/.test(source[index + 1])) {
      buffer += source[index + 1];
      index += 2;
      continue;
    }

    const triple = source.startsWith("***", index) ? "***" : source.startsWith("___", index) ? "___" : "";
    if (triple && !/\s/.test(source[index + 3] || "")) {
      const close = closingDelimiter(source, triple, index + triple.length);
      if (close >= 0) {
        flush();
        const inner = parseInlineMarkdown(source.slice(index + triple.length, close), depth + 1);
        nodes.push(...withMark(withMark(inner, { type: "italic" }), { type: "bold" }));
        index = close + triple.length;
        continue;
      }
    }

    const paired = source.startsWith("**", index)
      ? { delimiter: "**", mark: { type: "bold" } as TiptapPasteMark }
      : source.startsWith("__", index)
        ? { delimiter: "__", mark: { type: "bold" } as TiptapPasteMark }
        : source.startsWith("~~", index)
          ? { delimiter: "~~", mark: { type: "strike" } as TiptapPasteMark }
          : null;
    if (paired && !/\s/.test(source[index + paired.delimiter.length] || "")) {
      const close = closingDelimiter(source, paired.delimiter, index + paired.delimiter.length);
      if (close >= 0) {
        flush();
        nodes.push(...withMark(parseInlineMarkdown(source.slice(index + paired.delimiter.length, close), depth + 1), paired.mark));
        index = close + paired.delimiter.length;
        continue;
      }
    }

    if (source[index] === "`") {
      const close = source.indexOf("`", index + 1);
      if (close > index + 1) {
        flush();
        appendText(nodes, source.slice(index + 1, close).replace(/\s+/g, " "), [{ type: "code" }]);
        index = close + 1;
        continue;
      }
    }

    if (source[index] === "[") {
      const link = source.slice(index).match(/^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/);
      if (link) {
        const href = safeMarkdownHref(link[2]);
        if (href) {
          flush();
          nodes.push(...withMark(parseInlineMarkdown(link[1], depth + 1), { type: "link", attrs: { href } }));
          index += link[0].length;
          continue;
        }
      }
    }

    if (source[index] === "<") {
      const autoLink = source.slice(index).match(/^<(https?:\/\/[^>\s]+|mailto:[^>\s]+)>/i);
      if (autoLink) {
        flush();
        appendText(nodes, autoLink[1], [{ type: "link", attrs: { href: autoLink[1] } }]);
        index += autoLink[0].length;
        continue;
      }
    }

    const delimiter = source[index] === "*" || source[index] === "_" ? source[index] : "";
    const previous = index > 0 ? source[index - 1] : "";
    const next = source[index + 1] || "";
    const canOpen = delimiter && !/\s/.test(next) && (delimiter !== "_" || !/[\p{L}\p{N}]/u.test(previous));
    if (canOpen) {
      let close = source.indexOf(delimiter, index + 1);
      while (close > index + 1) {
        const after = source[close + 1] || "";
        if (!/\s/.test(source[close - 1]) && (delimiter !== "_" || !/[\p{L}\p{N}]/u.test(after))) break;
        close = source.indexOf(delimiter, close + 1);
      }
      if (close > index + 1) {
        flush();
        nodes.push(...withMark(parseInlineMarkdown(source.slice(index + 1, close), depth + 1), { type: "italic" }));
        index = close + 1;
        continue;
      }
    }

    buffer += source[index];
    index += 1;
  }

  flush();
  return nodes;
}

function paragraphNode(source: string): TiptapPasteNode {
  const content = parseInlineMarkdown(source);
  return { type: "paragraph", ...(content.length ? { content } : {}) };
}

function isMarkdownBlockStart(line: string) {
  return /^(?:[ \t]{0,3}#{1,6}[ \t]+|[ \t]{0,3}>[ \t]?|[ \t]{0,3}(?:[-+*]|\d+[.)])[ \t]+|[ \t]{0,3}(?:```|~~~)|[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*)/.test(line);
}

export function markdownToTiptapContent(value: string): TiptapPasteNode[] {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const nodes: TiptapPasteNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(?:[ \t]*[^\s`~]+)?[ \t]*$/);
    if (fence) {
      const fenceCharacter = fence[1][0];
      const fenceLength = fence[1].length;
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^[ \\t]{0,3}${fenceCharacter}{${fenceLength},}[ \\t]*$`).test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const text = code.join("\n");
      nodes.push({ type: "codeBlock", ...(text ? { content: [{ type: "text", text }] } : {}) });
      continue;
    }

    const heading = line.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (heading) {
      nodes.push({
        type: "heading",
        attrs: { level: Math.min(3, heading[1].length) },
        content: parseInlineMarkdown(heading[2]),
      });
      index += 1;
      continue;
    }

    if (/^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)) {
      nodes.push({ type: "horizontalRule" });
      index += 1;
      continue;
    }

    if (/^[ \t]{0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^[ \t]{0,3}>[ \t]?(.*)$/);
        if (!match) break;
        quoted.push(match[1]);
        index += 1;
      }
      const content = markdownToTiptapContent(quoted.join("\n"));
      nodes.push({ type: "blockquote", content: content.length ? content : [paragraphNode("")] });
      continue;
    }

    const firstListItem = line.match(/^[ \t]{0,3}([-+*]|(\d+)[.)])[ \t]+(.*)$/);
    if (firstListItem) {
      const ordered = !!firstListItem[2];
      const listItems: TiptapPasteNode[] = [];
      const start = ordered ? Number(firstListItem[2]) : undefined;

      while (index < lines.length) {
        const item = lines[index].match(/^[ \t]{0,3}([-+*]|(\d+)[.)])[ \t]+(.*)$/);
        if (!item || !!item[2] !== ordered) break;
        const itemLines = [item[3]];
        index += 1;
        while (index < lines.length && lines[index].trim() && /^[ \t]{2,}/.test(lines[index]) && !isMarkdownBlockStart(lines[index])) {
          itemLines.push(lines[index].trim());
          index += 1;
        }
        listItems.push({ type: "listItem", content: [paragraphNode(itemLines.join(" "))] });
      }

      nodes.push({
        type: ordered ? "orderedList" : "bulletList",
        ...(ordered ? { attrs: { start } } : {}),
        content: listItems,
      });
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    nodes.push(paragraphNode(paragraphLines.join("\n")));
  }

  return nodes.length ? nodes : [paragraphNode("")];
}
