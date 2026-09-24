import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../server/postgres";

const migrationPath = path.resolve("migrations/037_username_identity_and_history.sql");
const rawMigration = await fs.readFile(migrationPath, "utf8");
const migration = rawMigration
  .replace(/^\s*BEGIN;\s*/i, "")
  .replace(/\s*COMMIT;\s*$/i, "");

const preservedTables = [
  "users",
  "novels",
  "reviews",
  "bookmarks",
  "notifications",
  "messages",
  "blocked_users",
  "reading_progress",
  "social",
  "forum_threads",
  "forum_posts",
  "chapter_comments",
  "post_comments",
  "novel_likes",
  "follows",
  "sessions",
];

const client = await db.pool.connect();
try {
  await client.query("BEGIN");
  const existingTables = new Set(
    (await client.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [preservedTables],
    )).rows.map((row) => row.table_name),
  );
  const beforeCounts = new Map<string, number>();
  for (const table of preservedTables.filter((name) => existingTables.has(name))) {
    const result = await client.query(`SELECT count(*)::int AS count FROM public.${table}`);
    beforeCounts.set(table, result.rows[0].count);
  }

  const migrationAlreadyApplied = !!(await client.query(
    `SELECT to_regclass('public.username_history') AS history_table,
            to_regclass('public.users_username_lower_unique') AS username_index`,
  )).rows[0]?.history_table;
  if (!migrationAlreadyApplied) {
    await client.query(migration);
  }

  for (const [table, before] of beforeCounts) {
    const after = (await client.query(`SELECT count(*)::int AS count FROM public.${table}`)).rows[0].count;
    assert.equal(after, before, `${table} row count changed during the migration`);
  }

  const mappingChecks = [
    `SELECT count(*)::int AS count FROM reviews row JOIN users account ON lower(row.username) = lower(account.username) WHERE row.user_id IS NULL`,
    `SELECT count(*)::int AS count FROM bookmarks row JOIN users account ON lower(row.username) = lower(account.username) WHERE row.user_id IS NULL`,
    `SELECT count(*)::int AS count FROM notifications row JOIN users account ON lower(row.username) = lower(account.username) WHERE row.user_id IS NULL`,
    `SELECT count(*)::int AS count FROM messages row JOIN users account ON lower(row.username) = lower(account.username) WHERE row.recipient_id IS NULL`,
    `SELECT count(*)::int AS count FROM messages row JOIN users account ON lower(row.sender) = lower(account.username) WHERE row.sender_id IS NULL`,
    `SELECT count(*)::int AS count FROM blocked_users row JOIN users account ON lower(row.username) = lower(account.username) WHERE row.blocker_user_id IS NULL`,
    `SELECT count(*)::int AS count FROM blocked_users row JOIN users account ON lower(row.blocked_username) = lower(account.username) WHERE row.blocked_user_id IS NULL`,
    `SELECT count(*)::int AS count FROM reading_progress row JOIN users account ON lower(row.username) = lower(account.username) WHERE row.user_id IS NULL`,
  ];
  for (const sql of mappingChecks) {
    assert.equal((await client.query(sql)).rows[0].count, 0, `A safely mappable relationship was not backfilled: ${sql}`);
  }

  assert.equal(
    (await client.query(`SELECT count(*)::int AS count FROM users GROUP BY lower(username) HAVING count(*) > 1`)).rowCount,
    0,
    "Case-insensitive duplicates remain",
  );
  const legacyRelationshipConstraints = await client.query(
    `SELECT conname
       FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
        AND conname = ANY($1::text[])`,
    [[
      "bookmarks_username_novel_id_key",
      "blocked_users_username_blocked_username_key",
    ]],
  );
  assert.equal(
    legacyRelationshipConstraints.rowCount,
    0,
    "A permanent relationship is still constrained by username",
  );

  const accounts = (await client.query(
    `SELECT id, username
       FROM users
      WHERE username ~ '^[A-Za-z0-9_]{3,30}$'
      ORDER BY created_at NULLS LAST, id
      LIMIT 2`,
  )).rows;
  assert.ok(accounts.length >= 2, "At least two valid production-like accounts are required");

  const firstAlias = `MigrationAlias${Date.now().toString(36)}`.slice(0, 30);
  await client.query(
    `UPDATE users SET username = $1, username_changed_at = now() - interval '15 days' WHERE id = $2`,
    [firstAlias, accounts[0].id],
  );
  const alias = (await client.query(
    `SELECT account.id, account.username
       FROM username_history history
       JOIN users account ON account.id = history.user_id
      WHERE history.normalized_username = lower($1)`,
    [accounts[0].username],
  )).rows[0];
  assert.equal(alias?.id, accounts[0].id, "The old username does not resolve to the same user id");
  assert.equal(alias?.username, firstAlias, "The old username does not resolve to the current username");

  const snapshotChecks = [
    [`reviews`, `user_id`, `username`],
    [`bookmarks`, `user_id`, `username`],
    [`notifications`, `user_id`, `username`],
    [`messages`, `recipient_id`, `username`],
    [`messages`, `sender_id`, `sender`],
    [`reading_progress`, `user_id`, `username`],
    [`blocked_users`, `blocker_user_id`, `username`],
    [`blocked_users`, `blocked_user_id`, `blocked_username`],
    [`forum_threads`, `COALESCE(user_id, author_id)`, `author`],
    [`forum_posts`, `COALESCE(user_id, author_id)`, `author`],
  ] as const;
  for (const [table, idExpression, usernameColumn] of snapshotChecks) {
    const mismatch = await client.query(
      `SELECT count(*)::int AS count
         FROM ${table}
        WHERE ${idExpression} = $1
          AND ${usernameColumn} IS DISTINCT FROM $2`,
      [accounts[0].id, firstAlias],
    );
    assert.equal(mismatch.rows[0].count, 0, `${table}.${usernameColumn} was not synchronized`);
  }

  await client.query("SAVEPOINT case_collision");
  const collisionAlias = `CaseLock${Date.now().toString(36)}`.slice(0, 30);
  await client.query(
    `UPDATE users SET username = $1, username_changed_at = now() - interval '15 days' WHERE id = $2`,
    [collisionAlias, accounts[0].id],
  );
  let collisionRejected = false;
  try {
    await client.query(
      `UPDATE users SET username = $1, username_changed_at = now() - interval '15 days' WHERE id = $2`,
      [collisionAlias.toUpperCase(), accounts[1].id],
    );
  } catch (error: any) {
    collisionRejected = error?.code === "23505";
    await client.query("ROLLBACK TO SAVEPOINT case_collision");
  }
  assert.equal(collisionRejected, true, "A case-insensitive username collision was accepted");
  await client.query("RELEASE SAVEPOINT case_collision");

  console.log(JSON.stringify({
    success: true,
    checkedRows: Object.fromEntries(beforeCounts),
    unmappedHistoricalRowsPreserved: true,
    oldProfileAliasResolved: true,
    caseInsensitiveConstraintVerified: true,
    migrationAlreadyApplied,
  }, null, 2));
} finally {
  await client.query("ROLLBACK").catch(() => {});
  client.release();
  await db.pool.end();
}
