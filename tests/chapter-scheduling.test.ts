import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  futureScheduleIso,
  minimumScheduledDateTimeInput,
  scheduledDateLabel,
  toDateTimeLocalInput,
} from "../src/utils/chapterScheduling";

test("chapter schedules convert the author's local selection to an absolute instant", () => {
  const now = Date.parse("2026-09-05T10:00:00.000Z");
  assert.equal(futureScheduleIso("2026-09-05T14:00:00+03:30", now), "2026-09-05T10:30:00.000Z");
  assert.equal(futureScheduleIso("2026-09-05T09:00:00.000Z", now), null);
  assert.equal(futureScheduleIso("not-a-date", now), null);
});

test("datetime-local values round-trip in the runtime timezone", () => {
  const iso = "2032-04-08T11:20:00.000Z";
  const localInput = toDateTimeLocalInput(iso);
  assert.match(localInput, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(new Date(localInput).toISOString(), iso);
  assert.match(minimumScheduledDateTimeInput(new Date("2032-04-08T11:20:00.000Z")), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.ok(scheduledDateLabel(iso).length > 5);
});

test("scheduled publication completes workflow and announces once to the whole audience", () => {
  const scheduler = readFileSync(new URL("../server/utils/chapters.ts", import.meta.url), "utf8");
  const notifications = readFileSync(new URL("../server/utils/notifications.ts", import.meta.url), "utf8");
  const writer = readFileSync(new URL("../src/components/Writer.tsx", import.meta.url), "utf8");
  assert.match(scheduler, /editorial_status: "published"/);
  assert.match(scheduler, /scheduled_at: null/);
  assert.match(scheduler, /notifyChapterPublishedAudience/);
  assert.match(notifications, /chapter-published:\$\{chapterId\}/);
  assert.match(notifications, /from\("bookmarks"\)/);
  assert.match(notifications, /target_type", "user"/);
  assert.match(notifications, /target_type", "novel"/);
  assert.match(writer, /futureScheduleIso\(chScheduledAt\)/);
  assert.match(writer, /minimumScheduledDateTimeInput\(\)/);
});
