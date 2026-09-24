import test from "node:test";
import assert from "node:assert/strict";
import { buildChapterRenderBlocks } from "../src/components/Reader";
import {
  haveSameNotificationSnapshot,
  mergeReadingProgressSnapshots,
  normalizeReadingProgressPercent,
  readingProgressFromContent,
  scrollTopForReadingProgress,
  shouldPublishReadingProgress,
} from "../src/utils/renderStability";

test("unchanged notification polls preserve application render state", () => {
  const current = [{ id: "one", read: false, metadata: { chapterId: "chapter-1" } }];
  const same = [{ id: "one", read: false, metadata: { chapterId: "chapter-1" } }];
  assert.equal(haveSameNotificationSnapshot(current, same), true);
  assert.equal(haveSameNotificationSnapshot(current, [{ ...same[0], read: true }]), false);
  assert.equal(haveSameNotificationSnapshot(current, [...same, { id: "two" }]), false);
});

test("reading progress ignores scroll jitter but preserves meaningful milestones", () => {
  assert.equal(shouldPublishReadingProgress(undefined, 12.4), true);
  assert.equal(shouldPublishReadingProgress(12.4, 12.9), false);
  assert.equal(shouldPublishReadingProgress(12.4, 13.4), true);
  assert.equal(shouldPublishReadingProgress(89.6, 90), true);
  assert.equal(shouldPublishReadingProgress(94.8, 95), true);
  assert.equal(shouldPublishReadingProgress(99.7, 100), true);
  assert.equal(shouldPublishReadingProgress(50, Number.NaN), false);
});

test("prose reading position is measured and restored inside the story body", () => {
  assert.equal(normalizeReadingProgressPercent(-10), 0);
  assert.equal(normalizeReadingProgressPercent(120), 100);
  assert.equal(normalizeReadingProgressPercent("42.26"), 42.3);
  assert.equal(readingProgressFromContent(1100, 100, 3000, 1000), 50);
  assert.equal(scrollTopForReadingProgress(50, 100, 3000, 1000), 1100);
  assert.equal(scrollTopForReadingProgress(Number.NaN, 100, 3000, 1000), 100);
});

test("cross-device progress keeps the newest snapshot per novel", () => {
  const local = [{ novelId: "n1", scrollPercent: 31, updatedAt: "2026-09-05T10:00:00Z" }];
  const remote = [
    { novelId: "n1", scrollPercent: 70, updatedAt: "2026-09-05T10:05:00Z" },
    { novelId: "n2", scrollPercent: 20, updatedAt: "2026-09-05T09:00:00Z" },
  ];
  assert.deepEqual(mergeReadingProgressSnapshots(local, remote).map((item) => [item.novelId, item.scrollPercent]), [
    ["n1", 70],
    ["n2", 20],
  ]);
  assert.equal(mergeReadingProgressSnapshots(
    [{ novelId: "n1", scrollPercent: 71, updatedAt: "2026-09-05T10:06:00Z" }],
    remote,
  )[0].scrollPercent, 71);
});

test("chapter render blocks are derived only from chapter content", () => {
  assert.deepEqual(buildChapterRenderBlocks("First paragraph.\n\nSecond paragraph."), [
    { html: "", text: "First paragraph." },
    { html: "", text: "Second paragraph." },
  ]);
  assert.deepEqual(buildChapterRenderBlocks("<p>Rich chapter text.</p>"), [
    { html: "", text: "Rich chapter text." },
  ]);
});
