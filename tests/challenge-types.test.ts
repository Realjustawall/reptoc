import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("challenge type and winner schema is additive and constrained", () => {
  const migration = readFileSync(new URL("../migrations/079_challenge_types_and_winners.sql", import.meta.url), "utf8");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS challenge_type TEXT NOT NULL DEFAULT 'continuation'/);
  assert.match(migration, /challenge_type IN \('continuation', 'story_naming'\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS winners_announced_at TIMESTAMPTZ/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS winner_rank SMALLINT/);
  assert.match(migration, /winner_rank BETWEEN 1 AND 3/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_challenge_winner_rank/);
});

test("story naming challenges require an image and keep entries private until announcement", () => {
  const route = readFileSync(new URL("../server/api/routes/challenges.ts", import.meta.url), "utf8");
  assert.match(route, /challengeType === "story_naming" && !imageUrl/);
  assert.match(route, /resultsArePublic = !isNamingChallenge \|\| !!mappedChallenge\.winnersAnnouncedAt/);
  assert.match(route, /if \(isNamingChallenge && !mappedChallenge\.winnersAnnouncedAt\) viewerEntry\.winnerRank = null/);
  assert.match(route, /rankedEntryIds\.length > 3/);
  assert.match(route, /winner_rank: index \+ 1/);
});

test("admin can choose the type and publish or withhold winners", () => {
  const admin = readFileSync(new URL("../src/components/AuthorityCenter.tsx", import.meta.url), "utf8");
  assert.match(admin, /setChallengeType\("story_naming"\)/);
  assert.match(admin, /ذخیره بدون اعلام/);
  assert.match(admin, /اعلام برندگان/);
  assert.match(admin, /saveChallengeWinners/);
});

test("reader uses a short single-line name input for naming challenges", () => {
  const view = readFileSync(new URL("../src/components/DailyChallenges.tsx", import.meta.url), "utf8");
  assert.match(view, /isNamingChallenge \? \(/);
  assert.match(view, /maxLength=\{140\}/);
  assert.match(view, /نام‌ها تا زمان اعلام نتیجه عمومی نمی‌شوند/);
  assert.match(view, /entry\.winnerRank/);
});
