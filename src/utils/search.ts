import { Novel } from "../types";
import { filterTaxonomyList } from "../data";

export function normalizeSearchText(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: unknown): string[] {
  return normalizeSearchText(value).split(" ").filter((token) => token.length > 0);
}

function editDistanceAtMost(a: string, b: string, maxDistance: number): boolean {
  if (Math.abs(a.length - b.length) > maxDistance) return false;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > maxDistance) return false;
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length] <= maxDistance;
}

function scoreField(rawValue: unknown, query: string, queryTokens: string[], weight: number) {
  const value = normalizeSearchText(rawValue);
  if (!value) return 0;
  let score = 0;

  if (value === query) score += weight * 12;
  if (value.startsWith(query)) score += weight * 7;
  if (value.includes(query)) score += weight * 4;

  const valueTokens = tokenize(value);
  for (const token of queryTokens) {
    if (valueTokens.includes(token)) score += weight * 2.4;
    else if (valueTokens.some((fieldToken) => fieldToken.startsWith(token))) score += weight * 1.6;
    else if (value.includes(token)) score += weight;
    else if (token.length >= 4 && valueTokens.some((fieldToken) => editDistanceAtMost(token, fieldToken, token.length > 7 ? 2 : 1))) {
      score += weight * 0.8;
    }
  }

  if (queryTokens.length > 1 && queryTokens.every((token) => value.includes(token))) score += weight * 2;
  return score;
}

export function scoreNovelSearch(novel: Novel, queryValue: unknown): number {
  const query = normalizeSearchText(queryValue);
  if (query.length < 2) return 0;
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  const categoryText = filterTaxonomyList([
    novel.genre,
    ...(novel.mainCategories || []),
    ...(novel.subCategories || []),
    ...(novel.tags || [])
  ]).join(" ");

  let score = 0;
  score += scoreField(novel.title, query, queryTokens, 120);
  score += scoreField(novel.author, query, queryTokens, 105);
  score += scoreField(categoryText, query, queryTokens, 28);
  score += scoreField(novel.description, query, queryTokens, 12);
  score += Math.min(15, Number(novel.viewsCount || 0) / 100);
  score += Math.min(12, Number(novel.rating || 0) * 2);
  return score;
}

export function searchNovelsLocal(novels: Novel[], query: unknown, limit = 80): Novel[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return [];
  return novels
    .map((novel) => ({ novel, score: scoreNovelSearch(novel, normalizedQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.novel.title || "").localeCompare(String(b.novel.title || "")))
    .slice(0, limit)
    .map((item) => item.novel);
}
