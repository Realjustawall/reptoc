export function calculateAverageViews(totalViews: unknown, publishedChapterCount: unknown): number {
  const views = Math.max(0, Number(totalViews) || 0);
  const chapters = Math.max(0, Math.floor(Number(publishedChapterCount) || 0));
  if (chapters === 0) return 0;
  return Number((views / chapters).toFixed(2));
}

export function formatAverageViews(value: unknown): string {
  const amount = Math.max(0, Number(value) || 0);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
