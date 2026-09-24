import type { PoolClient } from "pg";
import { db } from "../postgres";
import { invalidateNovelCaches, sharedCache } from "./catalogCache";

export const USERNAME_CHANGE_COOLDOWN_DAYS = 14;
export const USERNAME_CHANGE_COOLDOWN_MS =
  USERNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/;

export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "moderator",
  "support",
  "reptoc",
  "novellek",
  "staff",
  "api",
  "www",
  "help",
  "security",
]);

export type UsernameValidation =
  | { ok: true; username: string; normalized: string }
  | { ok: false; code: string; error: string };

export class UsernameChangeError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "USERNAME_CHANGE_FAILED",
    public availableAt?: string,
  ) {
    super(message);
    this.name = "UsernameChangeError";
  }
}

export function normalizeUsername(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function validateUsername(value: unknown): UsernameValidation {
  const username = String(value || "").trim();
  const normalized = username.toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      code: "USERNAME_INVALID",
      error: "نام کاربری باید بین 3 تا 30 نویسه باشد و فقط شامل حروف لاتین، اعداد و زیرخط باشد.",
    };
  }
  if (RESERVED_USERNAMES.has(normalized)) {
    return {
      ok: false,
      code: "USERNAME_RESERVED",
      error: "این نام کاربری رزرو شده است.",
    };
  }
  return { ok: true, username, normalized };
}

export function usernameChangeAvailableAt(changedAt: unknown): string | null {
  if (!changedAt) return null;
  const changedTime = new Date(String(changedAt)).getTime();
  if (!Number.isFinite(changedTime)) return null;
  return new Date(changedTime + USERNAME_CHANGE_COOLDOWN_MS).toISOString();
}

export function userStatsKey(userId: string) {
  return `stats_user_${userId}`;
}

export function userPreferencesKey(userId: string) {
  return `preferences_user_${userId}`;
}

export function userAchievementSettingsKey(userId: string) {
  return `claimed_achievements_user_${userId}`;
}

export function userChapterNoteKey(userId: string, chapterId: string) {
  return `note_user_${userId}_${chapterId}`;
}

export async function resolveUsername(usernameValue: unknown) {
  const normalized = normalizeUsername(usernameValue);
  if (!normalized) return null;
  try {
    const result = await db.query(
      `SELECT account.*, false AS redirected
         FROM users account
        WHERE lower(account.username) = $1
        LIMIT 1`,
      [normalized],
    );
    if (result.rows[0]) return result.rows[0];

    const historical = await db.query(
      `SELECT account.*, true AS redirected, history.username AS requested_username
         FROM username_history history
         JOIN users account ON account.id = history.user_id
        WHERE history.normalized_username = $1
        LIMIT 1`,
      [normalized],
    );
    return historical.rows[0] || null;
  } catch (error: any) {
    // Phase-1 deployment compatibility: current usernames still resolve if the
    // history table has not reached this application instance yet.
    if (!["42P01", "42703"].includes(String(error?.code || ""))) throw error;
    const current = await db.query(
      `SELECT account.*, false AS redirected
         FROM users account
        WHERE lower(account.username) = $1
        LIMIT 1`,
      [normalized],
    );
    return current.rows[0] || null;
  }
}

export async function isUsernameUnavailable(usernameValue: unknown, exceptUserId?: string) {
  const validation = validateUsername(usernameValue);
  if (!validation.ok) return true;
  const params: any[] = [validation.normalized];
  const exceptCurrent = exceptUserId
    ? (params.push(exceptUserId), `AND id <> $${params.length}`)
    : "";
  const current = await db.query(
    `SELECT 1 FROM users WHERE lower(username) = $1 ${exceptCurrent} LIMIT 1`,
    params,
  );
  if (current.rows[0]) return true;
  try {
    const historyParams: any[] = [validation.normalized];
    const allowedOwner = exceptUserId
      ? (historyParams.push(exceptUserId), `AND (user_id IS NULL OR user_id <> $${historyParams.length})`)
      : "";
    const history = await db.query(
      `SELECT 1 FROM username_history
        WHERE normalized_username = $1 ${allowedOwner}
        LIMIT 1`,
      historyParams,
    );
    return !!history.rows[0];
  } catch (error: any) {
    if (String(error?.code || "") === "42P01") return false;
    throw error;
  }
}

async function copyLegacyUserSettings(
  client: Pick<PoolClient, "query">,
  userId: string,
  oldUsername: string,
) {
  const mappings = [
    [`stats_${oldUsername}`, userStatsKey(userId)],
    [`preferences_${oldUsername}`, userPreferencesKey(userId)],
    [`claimed_achievements_${oldUsername}`, userAchievementSettingsKey(userId)],
  ];
  for (const [legacyKey, idKey] of mappings) {
    await client.query(
      `INSERT INTO settings(setting_key, setting_value, updated_at)
       SELECT $1, setting_value, updated_at
         FROM settings
        WHERE setting_key = $2
       ON CONFLICT (setting_key) DO NOTHING`,
      [idKey, legacyKey],
    );
  }
  const legacyPrefix = `note_${oldUsername}_`;
  const idPrefix = `note_user_${userId}_`;
  await client.query(
    `INSERT INTO settings(setting_key, setting_value, updated_at)
     SELECT $1 || substring(setting_key FROM length($2) + 1),
            setting_value,
            updated_at
       FROM settings
      WHERE left(setting_key, length($2)) = $2
     ON CONFLICT (setting_key) DO NOTHING`,
    [idPrefix, legacyPrefix],
  );
}

export async function changeUsernameInTransaction(
  client: Pick<PoolClient, "query">,
  userId: string,
  usernameValue: unknown,
  now = new Date(),
) {
  const validation = validateUsername(usernameValue);
  if (validation.ok === false) {
    throw new UsernameChangeError(validation.error, 400, validation.code);
  }

  const currentResult = await client.query(
    `SELECT id, username, username_changed_at
       FROM users
      WHERE id = $1
      FOR UPDATE`,
    [userId],
  );
  const current = currentResult.rows[0];
  if (!current) {
    throw new UsernameChangeError("حساب کاربری یافت نشد.", 404, "USERNAME_ACCOUNT_NOT_FOUND");
  }
  if (normalizeUsername(current.username) === validation.normalized) {
    throw new UsernameChangeError(
      "این همان نام کاربری فعلی شماست.",
      409,
      "USERNAME_UNCHANGED",
    );
  }

  const availableAt = usernameChangeAvailableAt(current.username_changed_at);
  if (availableAt && new Date(availableAt).getTime() > now.getTime()) {
    throw new UsernameChangeError(
      `می‌توانید پس از ${availableAt} دوباره نام کاربری خود را تغییر دهید.`,
      429,
      "USERNAME_COOLDOWN",
      availableAt,
    );
  }

  const normalizedAliases = [normalizeUsername(current.username), validation.normalized]
    .sort();
  for (const alias of normalizedAliases) {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('username:' || $1, 0))`,
      [alias],
    );
  }

  const conflictingUser = await client.query(
    `SELECT 1 FROM users
      WHERE lower(username) = $1 AND id <> $2
      LIMIT 1`,
    [validation.normalized, userId],
  );
  const conflictingHistory = await client.query(
    `SELECT 1 FROM username_history
      WHERE normalized_username = $1
        AND (user_id IS NULL OR user_id <> $2)
      LIMIT 1`,
    [validation.normalized, userId],
  );
  if (conflictingUser.rows[0] || conflictingHistory.rows[0]) {
    throw new UsernameChangeError(
      "این نام کاربری در حال استفاده است یا برای همیشه رزرو شده است.",
      409,
      "USERNAME_UNAVAILABLE",
    );
  }

  await copyLegacyUserSettings(client, userId, current.username);

  // The database trigger writes username_history and synchronizes all legacy
  // username snapshots as part of this same transaction.
  const updated = await client.query(
    `UPDATE users
        SET username = $1,
            username_changed_at = $2
      WHERE id = $3
      RETURNING *`,
    [validation.username, now.toISOString(), userId],
  );
  if (updated.rowCount !== 1) {
    throw new UsernameChangeError(
      "ثبت تغییر نام کاربری انجام نشد.",
      409,
      "USERNAME_CHANGE_CONFLICT",
    );
  }
  return {
    user: updated.rows[0],
    previousUsername: current.username,
    availableAt: new Date(now.getTime() + USERNAME_CHANGE_COOLDOWN_MS).toISOString(),
  };
}

export async function changeUsername(
  userId: string,
  usernameValue: unknown,
  now = new Date(),
) {
  try {
    const result = await db.withTransaction((client) =>
      changeUsernameInTransaction(client, userId, usernameValue, now)
    );
    await Promise.all([
      invalidateNovelCaches(),
      sharedCache.clearPrefix(`profile_full:${userId}`),
      sharedCache.clearPrefix(`candidates:${userId}:`),
      sharedCache.clearPrefix(`recommend:${userId}:`),
    ]).catch((error) => {
      console.warn("Username changed, but cache invalidation was incomplete.", error);
    });
    return result;
  } catch (error: any) {
    if (error instanceof UsernameChangeError) throw error;
    if (String(error?.code || "") === "23505") {
      throw new UsernameChangeError(
        "این نام کاربری در حال استفاده است یا برای همیشه رزرو شده است.",
        409,
        "USERNAME_UNAVAILABLE",
      );
    }
    if (String(error?.constraint || "") === "users_username_format") {
      throw new UsernameChangeError(
        "نام کاربری باید بین 3 تا 30 نویسه باشد و فقط شامل حروف لاتین، اعداد و زیرخط باشد.",
        400,
        "USERNAME_INVALID",
      );
    }
    throw error;
  }
}
