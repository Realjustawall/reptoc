import { db } from "../postgres";

function utcDateKey(value: Date | string | number = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

let streakSchemaReady: Promise<void> | null = null;

export async function ensureStreakSchema() {
  if (!streakSchemaReady) {
    streakSchemaReady = db.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_streak_date DATE"
    ).then(() => undefined).catch((error) => {
      streakSchemaReady = null;
      throw error;
    });
  }
  return streakSchemaReady;
}

/**
 * Record a real reading or writing day. Authentication and profile views must
 * never call this function: a streak represents content activity, not logins.
 */
export async function recordDailyActivityStreak(userId: string) {
  await ensureStreakSchema();
  const today = utcDateKey();

  return db.withTransaction(async (client) => {
    const current = (await client.query(
      "SELECT streak, last_streak_date FROM users WHERE id=$1 FOR UPDATE",
      [userId]
    )).rows[0];
    if (!current) return null;

    const lastDate = current.last_streak_date ? utcDateKey(current.last_streak_date) : "";
    if (lastDate === today) return current;

    const yesterday = new Date(`${today}T00:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const nextStreak = lastDate === utcDateKey(yesterday)
      ? Math.max(1, Number(current.streak || 0)) + 1
      : 1;

    return (await client.query(
      `UPDATE users
          SET streak=$1, last_streak_date=$2::date
        WHERE id=$3
        RETURNING streak, last_streak_date`,
      [nextStreak, today, userId]
    )).rows[0] || null;
  });
}

/**
 * A stored streak expires after a missed UTC day. This keeps profile reads
 * side-effect free while ensuring stale streak values are not displayed.
 */
export function currentActivityStreak(user: any, now: Date | string | number = new Date()) {
  const lastDate = user?.last_streak_date ? utcDateKey(user.last_streak_date) : "";
  if (!lastDate) return 0;

  const today = utcDateKey(now);
  const yesterday = new Date(`${today}T00:00:00.000Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return lastDate === today || lastDate === utcDateKey(yesterday)
    ? Math.max(0, Number(user?.streak || 0))
    : 0;
}
