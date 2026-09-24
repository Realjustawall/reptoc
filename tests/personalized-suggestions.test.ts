import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildExplicitPreferenceSignals, mergeAffinityMaps } from "../server/suggestion/preferences";

test("explicit reading, library and follow signals create personalized affinities", () => {
  const result = buildExplicitPreferenceSignals({
    novels: [
      { novelId: "n1", genre: "فانتزی", authorId: "author-a" },
      { novelId: "n2", genre: "معمایی", authorId: "author-b" },
    ],
    reading: [{ novelId: "n1", scrollPercentage: 48, completed: false }],
    bookmarks: [{ novelId: "n2", shelfStatus: "completed" }],
    follows: [{ targetType: "user", targetId: "author-a" }],
  });

  assert.equal(result.activeUnfinishedNovels.has("n1"), true);
  assert.equal(result.seenNovels.has("n2"), true);
  assert.ok(result.genreAffinity["فانتزی"] > 0);
  assert.equal(result.authorAffinity["author-a"], 1);
  assert.ok(result.authorAffinity["author-b"] > 0);
});

test("dropped library items do not train positive taste and map merging stays bounded", () => {
  const result = buildExplicitPreferenceSignals({
    novels: [{ novelId: "n1", genre: "ترسناک", authorId: "author-a" }],
    reading: [],
    bookmarks: [{ novelId: "n1", shelfStatus: "dropped" }],
    follows: [],
  });

  assert.deepEqual(result.genreAffinity, {});
  assert.deepEqual(mergeAffinityMaps({ x: 4, y: -1 }, { x: 0.4, z: 0.6 }), { x: 1, y: 0, z: 0.6 });
});

test("recommendation cards expose durable not-interested feedback", () => {
  const dashboard = readFileSync(path.join(process.cwd(), "src/components/Dashboard.tsx"), "utf8");
  const route = readFileSync(path.join(process.cwd(), "server/api/routes/suggestion.ts"), "utf8");

  assert.match(dashboard, /علاقه ندارم/);
  assert.match(dashboard, /trackEvent\(resolvedUserId, novelId, "not_interested"\)/);
  assert.match(route, /"not_interested"/);
  assert.match(dashboard, /anon-\$\{Array\.from\(bytes/);
});
