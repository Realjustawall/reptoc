export interface ParagraphIdentity {
  id: string;
  ordinal: number;
  fingerprint: string;
  deleted?: boolean;
}

export interface ParagraphBlock {
  ordinal: number;
  text: string;
  fingerprint: string;
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'");
}

export function normalizeParagraphText(value: unknown): string {
  return decodeBasicEntities(String(value || "").replace(/<[^>]*>/g, " "))
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractParagraphBlocks(content: unknown): ParagraphBlock[] {
  const source = String(content || "");
  const blocks: string[] = [];
  if (/<[a-z][\s\S]*>/i.test(source)) {
    const expression = /<(p|h[1-6]|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    for (const match of source.matchAll(expression)) {
      const text = normalizeParagraphText(match[2]);
      if (text) blocks.push(text);
    }
  }
  if (blocks.length === 0) {
    blocks.push(...source.split(/\n\s*\n|\r?\n/).map(normalizeParagraphText).filter(Boolean));
  }
  return blocks.map((text, ordinal) => ({ ordinal, text, fingerprint: text.toLowerCase() }));
}

function similarity(left: string, right: string): number {
  if (left === right) return 1;
  const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
  const rightTokens = new Set(right.split(/\s+/).filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap++;
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

export function alignParagraphIdentities(
  previous: ParagraphIdentity[],
  nextBlocks: ParagraphBlock[],
  createId: () => string,
): { active: ParagraphIdentity[]; removed: ParagraphIdentity[] } {
  const available = previous.filter((item) => !item.deleted);
  const used = new Set<string>();
  const active: ParagraphIdentity[] = [];

  for (const block of nextBlocks) {
    let best = available.find((item) => !used.has(item.id) && item.fingerprint === block.fingerprint);
    if (!best) {
      let score = 0;
      for (const candidate of available) {
        if (used.has(candidate.id)) continue;
        const distancePenalty = Math.min(0.25, Math.abs(candidate.ordinal - block.ordinal) * 0.04);
        const candidateScore = similarity(candidate.fingerprint, block.fingerprint) - distancePenalty;
        if (candidateScore >= 0.42 && candidateScore > score) {
          score = candidateScore;
          best = candidate;
        }
      }
    }
    const id = best?.id || createId();
    used.add(id);
    active.push({ id, ordinal: block.ordinal, fingerprint: block.fingerprint });
  }

  return {
    active,
    removed: available.filter((item) => !used.has(item.id)).map((item) => ({ ...item, deleted: true })),
  };
}
