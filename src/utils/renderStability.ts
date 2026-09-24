export function haveSameNotificationSnapshot(current: readonly unknown[], next: readonly unknown[]): boolean {
  if (current === next) return true;
  if (current.length !== next.length) return false;
  return current.every((item, index) => JSON.stringify(item) === JSON.stringify(next[index]));
}

export function shouldPublishReadingProgress(previousPercent: number | undefined, nextPercent: number): boolean {
  if (!Number.isFinite(nextPercent)) return false;
  if (previousPercent === undefined || !Number.isFinite(previousPercent)) return true;
  if (Math.abs(nextPercent - previousPercent) >= 1) return true;
  if (previousPercent < 90 && nextPercent >= 90) return true;
  if (previousPercent < 95 && nextPercent >= 95) return true;
  return previousPercent < 100 && nextPercent >= 100;
}

export function normalizeReadingProgressPercent(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed * 10) / 10));
}

/** Position inside the story body, independent of comments and page chrome. */
export function readingProgressFromContent(
  scrollY: number,
  contentTop: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  const readableDistance = Math.max(1, contentHeight - viewportHeight);
  return normalizeReadingProgressPercent(((scrollY - contentTop) / readableDistance) * 100);
}

/** Convert a persisted story-body percentage back to a document scroll offset. */
export function scrollTopForReadingProgress(
  percent: unknown,
  contentTop: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  const readableDistance = Math.max(0, contentHeight - viewportHeight);
  return Math.max(0, contentTop + (normalizeReadingProgressPercent(percent) / 100) * readableDistance);
}

export function mergeReadingProgressSnapshots<T extends { novelId: string; updatedAt?: string }>(
  local: readonly T[],
  remote: readonly T[],
): T[] {
  const byNovel = new Map<string, T>();
  for (const item of [...remote, ...local]) {
    const existing = byNovel.get(item.novelId);
    const itemTime = Date.parse(item.updatedAt || "") || 0;
    const existingTime = Date.parse(existing?.updatedAt || "") || 0;
    if (!existing || itemTime > existingTime) byNovel.set(item.novelId, item);
  }
  return [...byNovel.values()].sort((left, right) => (
    (Date.parse(right.updatedAt || "") || 0) - (Date.parse(left.updatedAt || "") || 0)
  ));
}
