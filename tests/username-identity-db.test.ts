import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../server/postgres";
import { sharedCache } from "../server/utils/catalogCache";
import {
  changeUsername,
  changeUsernameInTransaction,
  resolveUsername,
  UsernameChangeError,
} from "../server/utils/usernames";

const databaseTestsEnabled = process.env.RUN_USERNAME_DB_TESTS === "1";
const databaseTest = databaseTestsEnabled ? test : test.skip;

function fixtureNames() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return {
    prefix: `uidt${suffix}`,
    original: `UOld${suffix}`.slice(0, 30),
    changed: `UNew${suffix}`.slice(0, 30),
    other: `UOther${suffix}`.slice(0, 30),
    rollback: `URoll${suffix}`.slice(0, 30),
    rollbackNext: `URollNext${suffix}`.slice(0, 30),
  };
}

databaseTest("a username change preserves every id-based relationship and updates public snapshots", async () => {
  const names = fixtureNames();
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const userId = `${names.prefix}-user`;
    const otherId = `${names.prefix}-other`;
    const novelId = `${names.prefix}-novel`;
    const chapterId = `${names.prefix}-chapter`;
    const authorPostId = `${names.prefix}-author-post`;
    const achievementId = `${names.prefix}-achievement`;
    const threadId = `${names.prefix}-thread`;

    await client.query(
      `INSERT INTO users(id, username, password, email)
       VALUES ($1,$2,'fixture-password',$3), ($4,$5,'fixture-password',$6)`,
      [userId, names.original, `${userId}@example.test`, otherId, names.other, `${otherId}@example.test`],
    );
    await client.query(
      `INSERT INTO novels(id, title, author_id, author, approval_status)
       VALUES ($1,'Identity fixture novel',$2,'Permanent Pen Name','approved')`,
      [novelId, userId],
    );
    await client.query(
      `INSERT INTO chapters(id, novel_id, title, content, status)
       VALUES ($1,$2,'Fixture chapter','Body','Published')`,
      [chapterId, novelId],
    );
    await client.query(
      `INSERT INTO reviews(id, novel_id, user_id, username, rating, content)
       VALUES ($1,$2,$3,$4,5,'Review stays connected')`,
      [`${names.prefix}-review`, novelId, userId, names.original],
    );
    await client.query(
      `INSERT INTO chapter_comments(id, novel_id, chapter_id, user_id, content)
       VALUES ($1,$2,$3,$4,'Comment stays connected')`,
      [`${names.prefix}-chapter-comment`, novelId, chapterId, userId],
    );
    await client.query(
      `INSERT INTO author_posts(id, author_id, novel_id, content)
       VALUES ($1,$2,$3,'Post stays connected')`,
      [authorPostId, userId, novelId],
    );
    await client.query(
      `INSERT INTO post_comments(id, post_id, author_id, content)
       VALUES ($1,$2,$3,'Post comment stays connected')`,
      [`${names.prefix}-post-comment`, authorPostId, userId],
    );
    await client.query(
      `INSERT INTO bookmarks(id, user_id, username, novel_id)
       VALUES ($1,$2,$3,$4)`,
      [`${names.prefix}-bookmark`, userId, names.original, novelId],
    );
    await client.query(
      `INSERT INTO novel_likes(id, novel_id, user_id) VALUES ($1,$2,$3)`,
      [`${names.prefix}-like`, novelId, userId],
    );
    await client.query(
      `INSERT INTO follows(id, follower_id, target_type, target_id)
       VALUES ($1,$2,'user',$3), ($4,$3,'user',$2)`,
      [`${names.prefix}-follow-a`, userId, otherId, `${names.prefix}-follow-b`],
    );
    await client.query(
      `INSERT INTO blocked_users(id, blocker_user_id, blocked_user_id, username, blocked_username)
       VALUES ($1,$2,$3,$4,$5)`,
      [`${names.prefix}-block`, userId, otherId, names.original, names.other],
    );
    await client.query(
      `INSERT INTO notifications(id, user_id, username, title, text)
       VALUES ($1,$2,$3,'Fixture notification','Still connected')`,
      [`${names.prefix}-notification`, userId, names.original],
    );
    await client.query(
      `INSERT INTO messages(id, recipient_id, sender_id, username, sender, subject, snippet)
       VALUES ($1,$2,$3,$4,$5,'Fixture message','Still connected')`,
      [`${names.prefix}-message`, otherId, userId, names.other, names.original],
    );
    await client.query(
      `INSERT INTO reading_progress(id, user_id, username, novel_id, chapter_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [`${names.prefix}-progress`, userId, names.original, novelId, chapterId],
    );
    await client.query(
      `INSERT INTO social(id, user_id, target_user_id, author, username, type)
       VALUES ($1,$2,$3,$4,$5,'following')`,
      [`${names.prefix}-social`, userId, otherId, names.original, names.other],
    );
    await client.query(
      `INSERT INTO achievements(id, category, title, description) VALUES ($1,'community','Fixture achievement','Identity test')`,
      [achievementId],
    );
    await client.query(
      `INSERT INTO user_achievements(id, user_id, achievement_id) VALUES ($1,$2,$3)`,
      [`${names.prefix}-user-achievement`, userId, achievementId],
    );
    await client.query(
      `INSERT INTO settings(setting_key, setting_value) VALUES ($1,'{"theme":"dark"}')`,
      [`preferences_user_${userId}`],
    );
    await client.query(
      `INSERT INTO sessions(id, user_id, csrf_token, expires_at)
       VALUES ($1,$2,'fixture-csrf',now() + interval '1 day')`,
      [`${names.prefix}-session`, userId],
    );
    await client.query(
      `INSERT INTO forum_threads(id, forum_id, user_id, author_id, author, title, category, content)
       VALUES ($1,'general',$2,$2,$3,'Fixture thread','General','Still connected')`,
      [threadId, userId, names.original],
    );
    await client.query(
      `INSERT INTO forum_posts(id, thread_id, user_id, author_id, author, content)
       VALUES ($1,$2,$3,$3,$4,'Still connected')`,
      [`${names.prefix}-forum-post`, threadId, userId, names.original],
    );

    const changedAt = new Date("2026-07-25T12:00:00.000Z");
    const result = await changeUsernameInTransaction(client, userId, names.changed, changedAt);
    assert.equal(result.user.id, userId);
    assert.equal(result.user.username, names.changed);
    assert.equal(result.previousUsername, names.original);

    const user = (await client.query(`SELECT * FROM users WHERE id=$1`, [userId])).rows[0];
    assert.equal(user.username, names.changed);
    assert.equal(new Date(user.username_changed_at).toISOString(), changedAt.toISOString());

    const history = (await client.query(
      `SELECT user_id FROM username_history WHERE normalized_username=lower($1)`,
      [names.original],
    )).rows[0];
    assert.equal(history.user_id, userId);

    const review = (await client.query(
      `SELECT r.user_id, r.username, u.username AS current_username
         FROM reviews r LEFT JOIN users u ON u.id=r.user_id WHERE r.id=$1`,
      [`${names.prefix}-review`],
    )).rows[0];
    assert.deepEqual(
      { userId: review.user_id, snapshot: review.username, displayed: review.current_username },
      { userId, snapshot: names.changed, displayed: names.changed },
    );

    const commentDisplay = (await client.query(
      `SELECT c.user_id, u.username FROM chapter_comments c JOIN users u ON u.id=c.user_id WHERE c.id=$1`,
      [`${names.prefix}-chapter-comment`],
    )).rows[0];
    assert.deepEqual(commentDisplay, { user_id: userId, username: names.changed });

    const postCommentDisplay = (await client.query(
      `SELECT c.author_id, u.username FROM post_comments c JOIN users u ON u.id=c.author_id WHERE c.id=$1`,
      [`${names.prefix}-post-comment`],
    )).rows[0];
    assert.deepEqual(postCommentDisplay, { author_id: userId, username: names.changed });

    const novel = (await client.query(`SELECT author_id, author FROM novels WHERE id=$1`, [novelId])).rows[0];
    assert.deepEqual(novel, { author_id: userId, author: "Permanent Pen Name" });

    const identityAssertions = [
      [`SELECT user_id AS id, username AS snapshot FROM bookmarks WHERE id=$1`, `${names.prefix}-bookmark`, names.changed],
      [`SELECT user_id AS id, NULL::text AS snapshot FROM novel_likes WHERE id=$1`, `${names.prefix}-like`, null],
      [`SELECT follower_id AS id, NULL::text AS snapshot FROM follows WHERE id=$1`, `${names.prefix}-follow-a`, null],
      [`SELECT blocker_user_id AS id, username AS snapshot FROM blocked_users WHERE id=$1`, `${names.prefix}-block`, names.changed],
      [`SELECT user_id AS id, username AS snapshot FROM notifications WHERE id=$1`, `${names.prefix}-notification`, names.changed],
      [`SELECT sender_id AS id, sender AS snapshot FROM messages WHERE id=$1`, `${names.prefix}-message`, names.changed],
      [`SELECT user_id AS id, username AS snapshot FROM reading_progress WHERE id=$1`, `${names.prefix}-progress`, names.changed],
      [`SELECT user_id AS id, author AS snapshot FROM social WHERE id=$1`, `${names.prefix}-social`, names.changed],
      [`SELECT user_id AS id, NULL::text AS snapshot FROM user_achievements WHERE id=$1`, `${names.prefix}-user-achievement`, null],
      [`SELECT user_id AS id, NULL::text AS snapshot FROM sessions WHERE id=$1`, `${names.prefix}-session`, null],
      [`SELECT user_id AS id, author AS snapshot FROM forum_threads WHERE id=$1`, threadId, names.changed],
      [`SELECT user_id AS id, author AS snapshot FROM forum_posts WHERE id=$1`, `${names.prefix}-forum-post`, names.changed],
    ] as const;
    for (const [sql, id, expectedSnapshot] of identityAssertions) {
      const row = (await client.query(sql, [id])).rows[0];
      assert.equal(row?.id, userId, `${id} disconnected from the user id`);
      assert.equal(row?.snapshot ?? null, expectedSnapshot, `${id} has a stale public username snapshot`);
    }

    assert.equal(
      (await client.query(`SELECT count(*)::int AS count FROM settings WHERE setting_key=$1`, [`preferences_user_${userId}`])).rows[0].count,
      1,
    );

    await assert.rejects(
      () => changeUsernameInTransaction(client, userId, `${names.changed}Again`.slice(0, 30), new Date(changedAt.getTime() + 1000)),
      (error: any) => error instanceof UsernameChangeError && error.code === "USERNAME_COOLDOWN" && error.status === 429,
    );

    const rollbackId = `${names.prefix}-rollback-user`;
    await client.query(
      `INSERT INTO users(id, username, password, email) VALUES ($1,$2,'fixture-password',$3)`,
      [rollbackId, names.rollback, `${rollbackId}@example.test`],
    );
    await client.query("SAVEPOINT username_rollback");
    try {
      await changeUsernameInTransaction(client, rollbackId, names.rollbackNext);
      throw new Error("Injected failure after username update");
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT username_rollback");
      await client.query("RELEASE SAVEPOINT username_rollback");
    }
    assert.equal(
      (await client.query(`SELECT username FROM users WHERE id=$1`, [rollbackId])).rows[0].username,
      names.rollback,
    );
    assert.equal(
      (await client.query(`SELECT count(*)::int AS count FROM username_history WHERE normalized_username=lower($1)`, [names.rollback])).rows[0].count,
      0,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
});

databaseTest("concurrent claims serialize, sessions survive, aliases resolve, and caches invalidate", async () => {
  const names = fixtureNames();
  const firstId = `${names.prefix}-concurrent-a`;
  const secondId = `${names.prefix}-concurrent-b`;
  const firstName = `UFirst${names.prefix}`.slice(0, 30);
  const secondName = `USecond${names.prefix}`.slice(0, 30);
  const target = `UClaim${names.prefix}`.slice(0, 30);
  const firstSessionId = `${names.prefix}-active-session-a`;
  const secondSessionId = `${names.prefix}-active-session-b`;
  const normalizedCleanup = [firstName, secondName, target].map((name) => name.toLowerCase());

  try {
    await db.query(
      `INSERT INTO users(id, username, password, email)
       VALUES ($1,$2,'fixture-password',$3), ($4,$5,'fixture-password',$6)`,
      [firstId, firstName, `${firstId}@example.test`, secondId, secondName, `${secondId}@example.test`],
    );
    await db.query(
      `INSERT INTO sessions(id, user_id, csrf_token, expires_at)
       VALUES ($1,$2,'fixture-csrf-a',now() + interval '1 day'),
              ($3,$4,'fixture-csrf-b',now() + interval '1 day')`,
      [firstSessionId, firstId, secondSessionId, secondId],
    );
    await sharedCache.set(`profile_full:${firstId}`, { username: firstName }, 300);
    await sharedCache.set(`profile_full:${secondId}`, { username: secondName }, 300);

    const outcomes = await Promise.allSettled([
      changeUsername(firstId, target),
      changeUsername(secondId, target.toUpperCase()),
    ]);
    const successes = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const failures = outcomes.filter((outcome) => outcome.status === "rejected");
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    assert.equal((failures[0] as PromiseRejectedResult).reason?.code, "USERNAME_UNAVAILABLE");

    const winner = (successes[0] as PromiseFulfilledResult<any>).value;
    const winnerId = winner.user.id;
    const oldUsername = winner.previousUsername;
    const resolved = await resolveUsername(oldUsername);
    assert.equal(resolved?.id, winnerId);
    assert.equal(resolved?.username.toLowerCase(), target.toLowerCase());
    assert.equal(resolved?.redirected, true);

    const loginLookup = (await db.query(
      `SELECT id FROM users WHERE lower(username)=lower($1)`,
      [target],
    )).rows;
    assert.deepEqual(loginLookup.map((row) => row.id), [winnerId]);

    const winnerSessionId = winnerId === firstId ? firstSessionId : secondSessionId;
    const sessionOwner = (await db.query(`SELECT user_id FROM sessions WHERE id=$1`, [winnerSessionId])).rows[0];
    assert.equal(sessionOwner.user_id, winnerId);
    assert.equal(await sharedCache.get(`profile_full:${winnerId}`), null);

    await assert.rejects(
      () => changeUsername(winnerId, `UNext${names.prefix}`.slice(0, 30)),
      (error: any) => error instanceof UsernameChangeError && error.code === "USERNAME_COOLDOWN",
    );

    await assert.rejects(
      () => db.query(
        `INSERT INTO users(id, username, password, email) VALUES ($1,$2,'fixture-password',$3)`,
        [`${names.prefix}-case-conflict`, target.toLowerCase(), `${names.prefix}-case-conflict@example.test`],
      ),
      (error: any) => error?.code === "23505",
    );
  } finally {
    await db.query(`DELETE FROM users WHERE id = ANY($1::text[])`, [[firstId, secondId]]).catch(() => {});
    await db.query(
      `DELETE FROM username_history
        WHERE normalized_username = ANY($1::text[])
           OR username ILIKE $2`,
      [normalizedCleanup, `%${names.prefix}%`],
    ).catch(() => {});
    await sharedCache.clearPrefix(`profile_full:${firstId}`);
    await sharedCache.clearPrefix(`profile_full:${secondId}`);
  }
});

test.after(async () => {
  if (databaseTestsEnabled) await db.pool.end();
});
