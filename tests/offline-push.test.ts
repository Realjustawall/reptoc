import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("offline reading persists chapters and falls back to IndexedDB when the network is unavailable", () => {
  const library = read("src/utils/offlineLibrary.ts");
  const api = read("src/utils/api.ts");
  const reader = read("src/components/Reader.tsx");
  assert.match(library, /indexedDB\.open/);
  assert.match(library, /cacheApplicationShell/);
  assert.match(library, /mangaPages/);
  assert.match(api, /getOfflineNovel/);
  assert.match(reader, /saveChapterOffline\(novel, chapter, mangaPages\)/);
});

test("service worker supports an offline shell, runtime assets, push display, and notification navigation", () => {
  const worker = read("public/sw.js");
  assert.match(worker, /request\.mode === "navigate"/);
  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /addEventListener\("notificationclick"/);
  assert.doesNotMatch(worker, /registration\.unregister/);
});

test("push subscriptions are user-owned, VAPID protected, and remove expired endpoints", () => {
  const migration = read("migrations/080_web_push_subscriptions.sql");
  const push = read("server/utils/webPush.ts");
  const routes = read("server/api/routes/notifications.ts");
  assert.match(migration, /user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(push, /setVapidDetails/);
  assert.match(push, /status === 404 \|\| status === 410/);
  assert.match(routes, /getActiveUser\(req, true\)/);
});

test("chapter, reply, and challenge-result notifications use the central push path", () => {
  const notifications = read("server/utils/notifications.ts");
  const forums = read("server/api/routes/forums.ts");
  const challenges = read("server/api/routes/challenges.ts");
  assert.match(notifications, /sendWebPushNotification/);
  assert.match(forums, /createUserNotification\(threadInfo\.user_id, "forum_reply"/);
  assert.match(challenges, /"challenge_result"/);
  assert.match(challenges, /"challenge_winner"/);
});
