export interface NormalizedReadingSessionMetrics {
  readSeconds: number;
  scrollPercentage: number;
}

/** Keep reader-session metrics compatible with INTEGER database columns. */
export function normalizeReadingSessionMetrics(
  readSeconds: unknown,
  scrollPercentage: unknown,
  maximumReadSeconds = 60,
): NormalizedReadingSessionMetrics {
  const parsedReadSeconds = Number(readSeconds || 0);
  const parsedScroll = Number(scrollPercentage || 0);

  return {
    readSeconds: Number.isFinite(parsedReadSeconds)
      ? Math.max(0, Math.min(Math.floor(parsedReadSeconds), maximumReadSeconds))
      : 0,
    scrollPercentage: Number.isFinite(parsedScroll)
      ? Math.max(0, Math.min(Math.round(parsedScroll), 100))
      : 0,
  };
}
