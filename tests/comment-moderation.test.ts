import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCommentModerationVerdict, validateModerationEndpoint } from "../server/utils/commentModeration";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("moderation provider verdict accepts only one unambiguous decision", () => {
  assert.equal(parseCommentModerationVerdict("ALLOW"), "ALLOW");
  assert.equal(parseCommentModerationVerdict({ result: "block" }), "BLOCK");
  assert.equal(parseCommentModerationVerdict({ response: "The decision is ALLOW." }), "ALLOW");
  assert.throws(() => parseCommentModerationVerdict("ALLOW or BLOCK"), /نامشخص/);
  assert.throws(() => parseCommentModerationVerdict("OK"), /نامشخص/);
});

test("moderation endpoint is HTTPS and cannot target obvious private networks", () => {
  assert.equal(validateModerationEndpoint("https://nemo.inteshopa.workers.dev/"), "https://nemo.inteshopa.workers.dev/");
  assert.throws(() => validateModerationEndpoint("http://example.com"), /HTTPS/);
  assert.throws(() => validateModerationEndpoint("https://127.0.0.1/service"), /خصوصی/);
  assert.throws(() => validateModerationEndpoint("https://localhost/service"), /محلی/);
});

test("comments enter a real queue and automated batch processing is sequential", () => {
  const migration = read("migrations/082_smart_comment_moderation.sql");
  const moderation = read("server/utils/commentModeration.ts");
  const admin = read("server/api/routes/admin.ts");
  const server = read("server/api/index.ts");
  const ui = read("src/components/AuthorityCenter.tsx");

  assert.match(migration, /ALTER COLUMN moderation_status SET DEFAULT 'pending'/);
  assert.match(moderation, /JSON\.stringify\(\{ message:/);
  assert.match(moderation, /encryptedApiKey: apiKey \? encrypt\(apiKey\)/);
  assert.match(admin, /for \(const id of ids\)/);
  assert.doesNotMatch(admin, /Promise\.all\([^)]*classifyComment/s);
  assert.match(server, /moderateNewComment\(content\)/);
  assert.match(server, /\.eq\("moderation_status", "visible"\)/);
  assert.match(ui, /نظارت هوشمند دیدگاه‌ها/);
  assert.match(ui, /بررسی هوشمند یکی‌یکی/);
  assert.match(ui, /تأییدشده/);
  assert.match(ui, /ردشده/);
  assert.match(admin, /comment-moderation\/test/);
  assert.match(admin, /approved_comment_deleted/);
  assert.match(ui, /تست قضاوت یک پیام/);
  assert.match(ui, /تأیید مجدد/);
  assert.match(ui, /deleteApprovedComment/);
  assert.match(admin, /browser can\n\s+\/\/ only switch the workflow mode/);
  assert.match(ui, /سرویس هوشمند آماده است/);
  assert.match(ui, /از پنل قابل مشاهده یا تغییر نیستند/);
});
