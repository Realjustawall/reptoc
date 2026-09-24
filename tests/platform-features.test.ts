import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTENT_WARNING_DEFINITIONS,
  normalizeContentWarnings,
} from "../shared/contentWarnings";
import { calculateAverageViews, formatAverageViews } from "../shared/statistics";
import { alignParagraphIdentities, extractParagraphBlocks } from "../shared/paragraphs";
import { sanitizePremiumPresentation } from "../shared/premiumTemplates";
import { isReadingMusicTrackId } from "../shared/readingMusic";
import {
  getReadingMusicTrack,
  READING_MUSIC_DURATION_SECONDS,
  READING_MUSIC_SAMPLE_RATE,
} from "../server/utils/readingMusic";
import { buildSitemapDocument, canonicalSitemapOrigin, sitemapUrl } from "../server/utils/sitemap";
import { normalizeStoredImageReference } from "../server/utils/images";
import { isChapterVisibleToUser } from "../server/utils/chapters";
import { withTransactionSavepoint } from "../server/postgres";
import { currentActivityStreak } from "../server/utils/userActivity";
import {
  dedupeAchievementNotifications,
  findNewAchievementNotification,
  readSeenAchievementNotificationIds,
  rememberAchievementNotificationIds,
} from "../src/utils/achievementNotifications";
import { imageDataUrlToBlob, uploadImageBlob } from "../src/utils/imageUpload";
import { api } from "../src/utils/api";
import { canonicalNotificationPath } from "../src/utils/notificationNavigation";
import { hasNovelModerationUpdate } from "../src/utils/novelModerationNotifications";
import { normalizeMainGenre } from "../src/data";
import {
  isNovelApprovedForDiscovery,
  isNovelPendingEditorialReview,
} from "../src/utils/novelVisibility";

test("new novel main genres never retain an invisible legacy default", () => {
  assert.equal(normalizeMainGenre("فانتزی"), "فانتزی");
  assert.equal(normalizeMainGenre("Action"), "");
  assert.equal(normalizeMainGenre(""), "");
});

test("rejected novels stay out of discovery and pending editorial queues", () => {
  const rejectedWithSubmittedChapter = {
    approvalStatus: "rejected",
    editorial_counts: { submitted: 1 },
  };
  assert.equal(isNovelApprovedForDiscovery(rejectedWithSubmittedChapter), false);
  assert.equal(isNovelPendingEditorialReview(rejectedWithSubmittedChapter), false);
  assert.equal(isNovelPendingEditorialReview({ approval_status: "pending_approval" }), true);
  assert.equal(isNovelPendingEditorialReview({ approval_status: "approved", editorial_counts: { submitted: 1 } }), true);
});

test("legacy novel notification links resolve to the canonical novel route", () => {
  assert.equal(canonicalNotificationPath("/novel/novel%2F1"), "/novels/novel%2F1");
  assert.equal(canonicalNotificationPath("/novels/novel-1"), "/novels/novel-1");
  assert.equal(canonicalNotificationPath("/novelist/example"), "/novelist/example");
});

test("novel moderation notifications trigger one writer-library revalidation", () => {
  const notification = { id: "approval-1", type: "editorial_novel_approved" };
  assert.equal(hasNovelModerationUpdate([notification], null), true);
  assert.equal(hasNovelModerationUpdate([notification], new Set()), true);
  assert.equal(hasNovelModerationUpdate([notification], new Set(["approval-1"])), false);
  assert.equal(hasNovelModerationUpdate([{ id: "reply-1", type: "forum_reply" }], new Set()), false);
});

test("chapter comment requests carry reply targets and explicit like state", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ success: true, liked: true, likesCount: 3 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await api.addChapterComment("csrf", "novel/1", "chapter/2", "A reply", "comment-3");
    await api.setChapterCommentLike("csrf", "novel/1", "chapter/2", "comment/3", true);
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { content: "A reply", parentId: "comment-3" });
    assert.equal(requests[1].url, "/api/novels/novel%2F1/chapters/chapter%2F2/comments/comment%2F3/like");
    assert.equal(requests[1].init?.method, "PUT");
    assert.deepEqual(JSON.parse(String(requests[1].init?.body)), { liked: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notification refresh retries transient gateway failures", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts === 1) return new Response("Bad Gateway", { status: 502 });
    return new Response(JSON.stringify([{
      id: "notification-1",
      title: "بازیابی شد",
      message: "اعلان‌ها دوباره در دسترس هستند.",
      is_read: 0,
    }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const notifications = await api.getNotifications("csrf-test");
    assert.equal(attempts, 2);
    assert.deepEqual(notifications, [{
      id: "notification-1",
      title: "بازیابی شد",
      text: "اعلان‌ها دوباره در دسترس هستند.",
      time: "همین حالا",
      type: "system",
      link: "",
      createdAt: "",
      read: false,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sitemap starts at byte zero with a valid XML declaration and escaped absolute URLs", () => {
  const xml = buildSitemapDocument([
    sitemapUrl("https://reptoc.example", "/novels/a&b", { priority: 0.8 }),
  ]);
  assert.equal(xml.indexOf('<?xml version="1.0" encoding="UTF-8"?>'), 0);
  assert.match(xml, /^<\?xml[^>]+>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /https:\/\/reptoc\.example\/novels\/a&amp;b/);
  assert.match(xml, /<\/urlset>$/);
  assert.equal((xml.match(/<urlset\b/g) || []).length, 1);
  assert.equal((xml.match(/<\/urlset>/g) || []).length, 1);
});

test("sitemap locations use the configured HTTPS origin and canonical path form", () => {
  const origin = canonicalSitemapOrigin(
    "http://reptoc.xyz/old-path/",
    "http://www.reptoc.xyz",
  );
  const xml = buildSitemapDocument([
    sitemapUrl(origin, "/novels/story-id/?utm_source=legacy#chapter"),
    sitemapUrl(origin, "/novels/story-id/chapters/chapter-id/"),
  ]);

  assert.equal(origin, "https://reptoc.xyz");
  assert.match(xml, /<loc>https:\/\/reptoc\.xyz\/novels\/story-id<\/loc>/);
  assert.match(xml, /<loc>https:\/\/reptoc\.xyz\/novels\/story-id\/chapters\/chapter-id<\/loc>/);
  assert.doesNotMatch(xml, /<loc>https:\/\/www\.|<loc>http:\/\/|utm_source|#chapter|chapter-id\/<\/loc>/);
});

test("sitemap origin falls back to the request origin only when APP_URL is absent", () => {
  assert.equal(canonicalSitemapOrigin("", "https://demo.reptoc.example/path"), "https://demo.reptoc.example");
  assert.equal(canonicalSitemapOrigin("", "http://localhost:5174/path"), "http://localhost:5174");
});

test("activity streaks expire after a missed day and profile reads do not advance them", () => {
  const now = "2026-07-25T12:00:00.000Z";
  assert.equal(currentActivityStreak({ streak: 9, last_streak_date: "2026-07-25" }, now), 9);
  assert.equal(currentActivityStreak({ streak: 9, last_streak_date: "2026-07-24" }, now), 9);
  assert.equal(currentActivityStreak({ streak: 9, last_streak_date: "2026-07-23" }, now), 0);
  assert.equal(currentActivityStreak({ streak: 9, last_streak_date: null }, now), 0);
});

test("content warnings canonicalize Dark Themes, whitespace, aliases, and duplicates", () => {
  assert.deepEqual(
    normalizeContentWarnings([" Dark Themes ", "dark_themes", "Strong Language", "Profanity"]).values,
    ["dark_themes", "profanity"],
  );
});

test("several valid warnings and empty warnings remain valid", () => {
  assert.deepEqual(
    normalizeContentWarnings(["graphic_violence", "ai_assisted", "tragic_elements"]).invalid,
    [],
  );
  assert.deepEqual(normalizeContentWarnings([]), { values: [], invalid: [] });
});

test("unsupported warning is identified rather than silently discarded", () => {
  const result = normalizeContentWarnings(["Dark Themes", "Not A Real Warning"]);
  assert.deepEqual(result.values, ["dark_themes"]);
  assert.deepEqual(result.invalid, ["Not A Real Warning"]);
});

test("configured legacy warnings remain backward compatible", () => {
  const result = normalizeContentWarnings(["Older Warning"], [{ id: "Older Warning", label: "Older Warning" }]);
  assert.deepEqual(result, { values: ["Older Warning"], invalid: [] });
  assert.ok(CONTENT_WARNING_DEFINITIONS.some((warning) => warning.id === "dark_themes"));
});

test("average views handles exact, decimal, one chapter, and zero chapters without changing totals", () => {
  const total = 50;
  assert.equal(calculateAverageViews(total, 10), 5);
  assert.equal(calculateAverageViews(total, 0), 0);
  assert.equal(calculateAverageViews(total, 1), 50);
  assert.equal(calculateAverageViews(10, 3), 3.33);
  assert.equal(formatAverageViews(3.5), "3.5");
  assert.equal(total, 50);
});

test("average-view divisor excludes draft, hidden, deleted, and future scheduled chapters", () => {
  const chapters = [
    { status: "Published", moderation_status: "visible" },
    { status: "Draft", moderation_status: "visible" },
    { status: "Published", moderation_status: "hidden" },
    { status: "Deleted", moderation_status: "visible" },
    { status: "Published", moderation_status: "visible", scheduled_at: "2999-01-01T00:00:00.000Z" },
  ];
  const published = chapters.filter((chapter) => isChapterVisibleToUser(chapter, false));
  assert.equal(published.length, 1);
  assert.equal(calculateAverageViews(50, published.length), 50);
});

test("stable paragraph alignment survives an insertion and a modest text edit", () => {
  const original = extractParagraphBlocks("<p>Alpha opens the story.</p><p>Beta follows with more detail.</p>");
  const first = alignParagraphIdentities([], original, (() => {
    let id = 0;
    return () => `p-${++id}`;
  })());
  const edited = extractParagraphBlocks("<p>A short new introduction.</p><p>Alpha opens the story.</p><p>Beta follows with a little more detail.</p>");
  const second = alignParagraphIdentities(first.active, edited, () => "p-new");
  assert.equal(second.active[1].id, first.active[0].id);
  assert.equal(second.active[2].id, first.active[1].id);
  assert.equal(second.active[0].id, "p-new");
});

test("removed paragraphs are retained as deleted identities for comment safety", () => {
  const previous = [
    { id: "keep", ordinal: 0, fingerprint: "keep me" },
    { id: "remove", ordinal: 1, fingerprint: "remove me" },
  ];
  const result = alignParagraphIdentities(previous, extractParagraphBlocks("<p>Keep me</p>"), () => "new");
  assert.equal(result.active[0].id, "keep");
  assert.deepEqual(result.removed.map((item) => item.id), ["remove"]);
});

test("premium configuration rejects unknown templates and malformed colors safely", () => {
  assert.deepEqual(
    sanitizePremiumPresentation({ enabled: true, templateId: "unknown", palette: { primary: "red" } }),
    { enabled: true, templateId: "royal" },
  );
});

test("image references reject temporary browser URLs and retain stable public paths", () => {
  assert.throws(() => normalizeStoredImageReference("blob:https://example.test/temporary"), /موقت مرورگر/);
  assert.equal(normalizeStoredImageReference("/uploads/stable-cover.webp"), "/uploads/stable-cover.webp");
});

test("cover previews convert to uploadable blobs without a data URL fetch", async () => {
  const blob = imageDataUrlToBlob("data:image/png;base64,iVBORw0KGgo=");
  assert.equal(blob.type, "image/png");
  assert.equal(blob.size, 8);
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.throws(() => imageDataUrlToBlob("blob:https://reptoc.xyz/temporary"), /پشتیبانی نمی‌شود/);
});

test("picture upload sends the prepared blob directly to the same-origin endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedBody: FormData | null = null;
  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    requestedBody = init?.body as FormData;
    return new Response(JSON.stringify({ success: true, url: "/uploads/cover.png" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const response = await uploadImageBlob(new Blob(["png"], { type: "image/png" }), {
      fileName: "cover.png",
      csrfToken: "csrf-test",
    });
    assert.equal(requestedUrl, "/api/files/upload");
    assert.equal(requestedBody?.get("file") instanceof Blob, true);
    assert.equal(response.url, "/uploads/cover.png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a failed optional transaction query rolls back to its savepoint before recovery", async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql === "optional query") throw new Error("optional relation is unavailable");
      return { rows: [] };
    },
  };

  const result = await withTransactionSavepoint(
    client as any,
    "optional_lookup",
    () => client.query("optional query"),
    () => ({ rows: ["fallback"] }),
  );

  assert.deepEqual(result.rows, ["fallback"]);
  assert.deepEqual(queries, [
    "SAVEPOINT optional_lookup",
    "optional query",
    "ROLLBACK TO SAVEPOINT optional_lookup",
    "RELEASE SAVEPOINT optional_lookup",
  ]);
});

test("existing-book cover updates send only the uploaded cover URL", async () => {
  const originalFetch = globalThis.fetch;
  const originalGetToken = api.getToken;
  let requestedUrl = "";
  let requestedBody: any = null;
  api.getToken = () => "csrf-test";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(input);
    requestedBody = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await api.updateNovelCover("novel/with spaces", "/uploads/new-cover.jpg");
    assert.equal(requestedUrl, "/api/novels/novel%2Fwith%20spaces");
    assert.deepEqual(requestedBody, { coverUrl: "/uploads/new-cover.jpg" });
  } finally {
    globalThis.fetch = originalFetch;
    api.getToken = originalGetToken;
  }
});

test("only approved reading music track IDs validate", () => {
  assert.equal(isReadingMusicTrackId("quiet-rain"), true);
  assert.equal(isReadingMusicTrackId("remote-url"), false);
});

test("reading music is valid full-quality PCM with a seamless generated duration", () => {
  const audio = getReadingMusicTrack("quiet-rain");
  assert.ok(audio);
  assert.equal(audio.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(audio.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(audio.readUInt32LE(24), READING_MUSIC_SAMPLE_RATE);
  assert.equal(audio.readUInt16LE(22), 1);
  assert.equal(audio.readUInt16LE(34), 16);
  assert.equal(audio.readUInt32LE(40), READING_MUSIC_SAMPLE_RATE * READING_MUSIC_DURATION_SECONDS * 2);
  assert.equal(audio.length, 44 + audio.readUInt32LE(40));
  assert.equal(getReadingMusicTrack("not-approved"), null);
});

test("achievement history establishes a baseline and only a later unlock opens once", () => {
  const oldAchievement = { id: "old", type: "achievement" };
  const newAchievement = { id: "new", type: "achievement" };
  const earnedThisSession = {
    id: "session-new",
    type: "achievement",
    createdAt: "2026-07-23T16:00:05.000Z",
  };
  const seen = new Set<string>();

  assert.equal(findNewAchievementNotification([oldAchievement], null, seen), null);
  assert.deepEqual(
    findNewAchievementNotification(
      [earnedThisSession, oldAchievement],
      null,
      seen,
      new Date("2026-07-23T16:00:00.000Z").getTime(),
    ),
    earnedThisSession,
  );
  assert.deepEqual(
    findNewAchievementNotification([newAchievement, oldAchievement], new Set(["old"]), seen),
    newAchievement,
  );
  seen.add("new");
  assert.equal(
    findNewAchievementNotification([newAchievement, oldAchievement], new Set(["old"]), seen),
    null,
  );
});

test("historical duplicate achievement receipts collapse to one notification", () => {
  const receipts = [
    { id: "latest", type: "achievement", title: "Achievement Unlocked: First Step" },
    { id: "older", type: "achievement", title: "Achievement Unlocked: First Step" },
    { id: "other", type: "achievement", title: "Achievement Unlocked: Bookworm" },
  ];
  const visible = dedupeAchievementNotifications(receipts);
  assert.deepEqual(visible.map((receipt) => receipt.id), ["latest", "other"]);
});

test("seen achievement notification IDs persist per account", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  rememberAchievementNotificationIds("user-a", ["first", "second"], storage);
  assert.deepEqual([...readSeenAchievementNotificationIds("user-a", storage)], ["first", "second"]);
  assert.deepEqual([...readSeenAchievementNotificationIds("user-b", storage)], []);
});
