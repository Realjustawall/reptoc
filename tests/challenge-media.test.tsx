import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeChallengeAudioReference } from "../server/api/routes/challenges";
import { normalizeStoredImageReference } from "../server/utils/images";

test("challenge narration must be a Reptoc-hosted upload", () => {
  assert.equal(normalizeChallengeAudioReference("/uploads/narration-1.mp3"), "/uploads/narration-1.mp3");
  assert.equal(normalizeChallengeAudioReference("/uploads/clip.m4a"), "/uploads/clip.m4a");
  assert.equal(normalizeChallengeAudioReference("/uploads/clip.ogg"), "/uploads/clip.ogg");
  assert.equal(normalizeChallengeAudioReference("/uploads/clip.wav"), "/uploads/clip.wav");
  assert.equal(normalizeChallengeAudioReference("/uploads/clip.flac"), "/uploads/clip.flac");
  assert.equal(normalizeChallengeAudioReference("/api/files/abc-1/content"), "/api/files/abc-1/content");
  // Empty clears the clip.
  assert.equal(normalizeChallengeAudioReference(""), "");
  assert.equal(normalizeChallengeAudioReference(null), "");
});

test("remote and unsafe audio references are rejected", () => {
  // Hotlinking third-party media would leak every visitor's IP to that host.
  assert.throws(() => normalizeChallengeAudioReference("https://cdn.example.test/a.mp3"), /بارگذاری/);
  assert.throws(() => normalizeChallengeAudioReference("http://cdn.example.test/a.mp3"), /بارگذاری/);
  assert.throws(() => normalizeChallengeAudioReference("javascript:alert(1)"), /بارگذاری/);
  assert.throws(() => normalizeChallengeAudioReference("/uploads/../etc/passwd"), /بارگذاری/);
  // An executable or document extension must never be playable as audio.
  assert.throws(() => normalizeChallengeAudioReference("/uploads/payload.js"), /بارگذاری/);
  assert.throws(() => normalizeChallengeAudioReference("/uploads/payload.html"), /بارگذاری/);
});

test("challenge illustrations reuse the shared stored-image normalizer", () => {
  assert.equal(normalizeStoredImageReference("/uploads/prompt.webp"), "/uploads/prompt.webp");
  assert.equal(normalizeStoredImageReference("", { allowEmpty: true }), "");
  assert.throws(() => normalizeStoredImageReference("blob:https://reptoc.ir/1"), /blob/);
});

test("the audio upload endpoint is owner-only and sniffs the stored type", () => {
  const upload = readFileSync(new URL("../server/api/routes/upload.ts", import.meta.url), "utf8");

  assert.match(upload, /router\.post\("\/audio"/);
  // A publicly writable audio endpoint would let any account host media on the
  // platform's own origin.
  assert.match(upload, /isOwnerUser\(user\)\)\s*return res\.status\(403\)/);
  // The stored MIME type and extension come from magic bytes, not the filename.
  assert.match(upload, /const detected = await fileTypeFromBuffer\(file\.buffer\)/);
  assert.match(upload, /AUDIO_MIME_TYPES\[detected\.mime\]/);
  assert.match(upload, /scanForMalware\(file\.buffer/);
  // SVG-style script payloads are impossible here because only audio containers
  // are listed; assert the table has no HTML/JS entry.
  assert.doesNotMatch(upload, /AUDIO_MIME_TYPES[\s\S]{0,400}text\/html/);
});

test("a challenge prompt may be carried by media instead of text", () => {
  const route = readFileSync(new URL("../server/api/routes/challenges.ts", import.meta.url), "utf8");

  assert.match(route, /image_url/);
  assert.match(route, /audio_url/);
  // The 20-character text minimum is waived when media is attached.
  assert.match(route, /if \(!hasMedia && promptText\.length < 20\)/);
  // Media columns are read conditionally so a pre-migration deployment works.
  assert.match(route, /challengeMediaColumns/);
  assert.match(route, /npm run db:migrate/);
});

test("readers see the challenge picture and can play the narration", () => {
  const view = readFileSync(new URL("../src/components/DailyChallenges.tsx", import.meta.url), "utf8");

  assert.match(view, /challenge\.imageUrl/);
  assert.match(view, /challenge\.audioUrl/);
  assert.match(view, /<audio controls preload="none"/);
  // Alt text is required for the illustration.
  assert.match(view, /alt=\{`تصویر چالش: \$\{challenge\.title\}`\}/);
});

test("the admin panel uploads challenge media before publishing", () => {
  const admin = readFileSync(new URL("../src/components/AuthorityCenter.tsx", import.meta.url), "utf8");

  assert.match(admin, /uploadChallengeImage/);
  assert.match(admin, /uploadChallengeAudio/);
  // Prompt media must be publicly readable or visitors would see a broken file.
  assert.match(admin, /fields: \{ visibility: "public" \}/);
  // Publishing stays enabled for a media-only prompt.
  assert.match(admin, /!challengeImageUrl && !challengeAudioUrl/);
});

test("the challenge media migration is additive and idempotent", () => {
  const migration = readFileSync(new URL("../migrations/074_challenge_media.sql", import.meta.url), "utf8");

  assert.match(migration, /ADD COLUMN IF NOT EXISTS image_url TEXT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS audio_url TEXT/);
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;/m);
});

test("the admin moderation list reads the camelCase status the API returns", () => {
  const admin = readFileSync(new URL("../src/components/AuthorityCenter.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../server/api/routes/challenges.ts", import.meta.url), "utf8");

  // The API maps rows to camelCase, so a snake_case read is always undefined:
  // approved entries showed as pending and the reject button never appeared.
  assert.match(route, /moderationStatus: row\.moderation_status/);
  assert.doesNotMatch(admin, /entry\.moderation_status/);
  assert.match(admin, /entry\.moderationStatus/);
});
