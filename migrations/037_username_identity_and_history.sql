-- Phase 1: make usernames mutable without changing account identity.
--
-- This migration is intentionally additive. Legacy display columns stay in
-- place during the compatibility window, while every relationship gains or
-- continues to use an immutable user id. Unmatched historical snapshots are
-- retained instead of being deleted.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.username_history (
  normalized_username TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  reserved_forever BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (normalized_username = lower(btrim(username)))
);

CREATE INDEX IF NOT EXISTS idx_username_history_user_changed
  ON public.username_history(user_id, changed_at DESC);

-- Add identity columns before changing application reads. They remain nullable
-- so deleted-account and system-authored historical rows are preserved.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS recipient_id TEXT,
  ADD COLUMN IF NOT EXISTS sender_id TEXT;

ALTER TABLE public.blocked_users
  ADD COLUMN IF NOT EXISTS blocker_user_id TEXT,
  ADD COLUMN IF NOT EXISTS blocked_user_id TEXT;

ALTER TABLE public.reading_progress
  ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE public.social
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS target_user_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_recipient_id_fkey' AND conrelid = 'public.messages'::regclass) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_recipient_id_fkey FOREIGN KEY (recipient_id)
      REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_sender_id_fkey' AND conrelid = 'public.messages'::regclass) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id)
      REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blocked_users_blocker_user_id_fkey' AND conrelid = 'public.blocked_users'::regclass) THEN
    ALTER TABLE public.blocked_users
      ADD CONSTRAINT blocked_users_blocker_user_id_fkey FOREIGN KEY (blocker_user_id)
      REFERENCES public.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blocked_users_blocked_user_id_fkey' AND conrelid = 'public.blocked_users'::regclass) THEN
    ALTER TABLE public.blocked_users
      ADD CONSTRAINT blocked_users_blocked_user_id_fkey FOREIGN KEY (blocked_user_id)
      REFERENCES public.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reading_progress_user_id_fkey' AND conrelid = 'public.reading_progress'::regclass) THEN
    ALTER TABLE public.reading_progress
      ADD CONSTRAINT reading_progress_user_id_fkey FOREIGN KEY (user_id)
      REFERENCES public.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_user_id_fkey' AND conrelid = 'public.social'::regclass) THEN
    ALTER TABLE public.social
      ADD CONSTRAINT social_user_id_fkey FOREIGN KEY (user_id)
      REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_target_user_id_fkey' AND conrelid = 'public.social'::regclass) THEN
    ALTER TABLE public.social
      ADD CONSTRAINT social_target_user_id_fkey FOREIGN KEY (target_user_id)
      REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END
$$;

-- Case-insensitive backfills preserve original display strings while attaching
-- every row that can be proven to belong to one current account.
UPDATE public.reviews row
SET user_id = account.id
FROM public.users account
WHERE row.user_id IS NULL
  AND lower(row.username) = lower(account.username);

UPDATE public.bookmarks row
SET user_id = account.id
FROM public.users account
WHERE row.user_id IS NULL
  AND lower(row.username) = lower(account.username);

UPDATE public.notifications row
SET user_id = account.id
FROM public.users account
WHERE row.user_id IS NULL
  AND lower(row.username) = lower(account.username);

UPDATE public.messages row
SET recipient_id = account.id
FROM public.users account
WHERE row.recipient_id IS NULL
  AND lower(row.username) = lower(account.username);

UPDATE public.messages row
SET sender_id = account.id
FROM public.users account
WHERE row.sender_id IS NULL
  AND lower(row.sender) = lower(account.username);

UPDATE public.blocked_users row
SET blocker_user_id = account.id
FROM public.users account
WHERE row.blocker_user_id IS NULL
  AND lower(row.username) = lower(account.username);

UPDATE public.blocked_users row
SET blocked_user_id = account.id
FROM public.users account
WHERE row.blocked_user_id IS NULL
  AND lower(row.blocked_username) = lower(account.username);

UPDATE public.reading_progress row
SET user_id = account.id
FROM public.users account
WHERE row.user_id IS NULL
  AND lower(row.username) = lower(account.username);

UPDATE public.forum_threads row
SET user_id = COALESCE(row.user_id, account.id),
    author_id = COALESCE(row.author_id, account.id)
FROM public.users account
WHERE (row.user_id IS NULL OR row.author_id IS NULL)
  AND lower(row.author) = lower(account.username);

UPDATE public.forum_posts row
SET user_id = COALESCE(row.user_id, account.id),
    author_id = COALESCE(row.author_id, account.id)
FROM public.users account
WHERE (row.user_id IS NULL OR row.author_id IS NULL)
  AND lower(row.author) = lower(account.username);

UPDATE public.social row
SET user_id = account.id
FROM public.users account
WHERE row.user_id IS NULL
  AND lower(row.author) = lower(account.username);

UPDATE public.social row
SET target_user_id = account.id
FROM public.users account
WHERE row.target_user_id IS NULL
  AND lower(row.username) = lower(account.username);

-- Copy username-keyed settings to immutable user-id keys. Legacy keys remain
-- readable during rollout and are never deleted by this migration.
INSERT INTO public.settings(setting_key, setting_value, updated_at)
SELECT 'stats_user_' || account.id, legacy.setting_value, legacy.updated_at
FROM public.users account
JOIN public.settings legacy ON legacy.setting_key = 'stats_' || account.username
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO public.settings(setting_key, setting_value, updated_at)
SELECT 'preferences_user_' || account.id, legacy.setting_value, legacy.updated_at
FROM public.users account
JOIN public.settings legacy ON legacy.setting_key = 'preferences_' || account.username
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO public.settings(setting_key, setting_value, updated_at)
SELECT 'claimed_achievements_user_' || account.id, legacy.setting_value, legacy.updated_at
FROM public.users account
JOIN public.settings legacy ON legacy.setting_key = 'claimed_achievements_' || account.username
ON CONFLICT (setting_key) DO NOTHING;

UPDATE public.users account
SET profile_bio = legacy.setting_value
FROM public.settings legacy
WHERE legacy.setting_key = 'bio_' || account.username
  AND COALESCE(btrim(account.profile_bio), '') = '';

INSERT INTO public.settings(setting_key, setting_value, updated_at)
SELECT
  'note_user_' || account.id || '_' ||
    substring(legacy.setting_key FROM length('note_' || account.username || '_') + 1),
  legacy.setting_value,
  legacy.updated_at
FROM public.users account
JOIN public.settings legacy
  ON left(legacy.setting_key, length('note_' || account.username || '_')) =
     'note_' || account.username || '_'
ON CONFLICT (setting_key) DO NOTHING;

-- Fail closed if historical data contains a case-only collision. The enclosing
-- transaction rolls back without renaming or deleting either account.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users
    GROUP BY lower(username)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce case-insensitive usernames: existing case-only duplicates require operator review.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
  ON public.users(lower(username));

CREATE INDEX IF NOT EXISTS idx_messages_recipient_created
  ON public.messages(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_created
  ON public.messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_v2
  ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reading_progress_user_created_v2
  ON public.reading_progress(user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_users_ids_unique
  ON public.blocked_users(blocker_user_id, blocked_user_id);

CREATE OR REPLACE FUNCTION public.guard_username_claim()
RETURNS trigger AS $$
DECLARE
  normalized_new TEXT;
  normalized_old TEXT;
  lock_name TEXT;
BEGIN
  NEW.username := btrim(NEW.username);
  normalized_new := lower(NEW.username);
  normalized_old := CASE WHEN TG_OP = 'UPDATE' THEN lower(btrim(OLD.username)) ELSE NULL END;

  IF NEW.username !~ '^[A-Za-z0-9_]{3,30}$' THEN
    RAISE EXCEPTION 'Username must be 3-30 characters using only letters, numbers, and underscores.'
      USING ERRCODE = '23514', CONSTRAINT = 'users_username_format';
  END IF;

  IF normalized_new = ANY (ARRAY[
    'admin', 'administrator', 'root', 'system', 'moderator', 'support',
    'reptoc', 'novellek', 'staff', 'api', 'www', 'help', 'security'
  ]) THEN
    RAISE EXCEPTION 'Username is reserved.'
      USING ERRCODE = '23514', CONSTRAINT = 'users_username_reserved';
  END IF;

  -- Lock old and new aliases in deterministic order. Registration and rename
  -- requests therefore cannot race across the users/history tables.
  FOR lock_name IN
    SELECT DISTINCT value
    FROM unnest(ARRAY[normalized_new, normalized_old]) value
    WHERE value IS NOT NULL
    ORDER BY value
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('username:' || lock_name, 0));
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.username_history history
    WHERE history.normalized_username = normalized_new
      AND (history.user_id IS NULL OR history.user_id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'Username is permanently reserved.'
      USING ERRCODE = '23505', CONSTRAINT = 'username_history_reserved';
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_guard_username_claim ON public.users;
CREATE TRIGGER users_guard_username_claim
BEFORE INSERT OR UPDATE OF username ON public.users
FOR EACH ROW EXECUTE FUNCTION public.guard_username_claim();

CREATE OR REPLACE FUNCTION public.sync_username_change()
RETURNS trigger AS $$
BEGIN
  IF lower(btrim(OLD.username)) = lower(btrim(NEW.username))
     AND OLD.username = NEW.username THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.username_history(
    normalized_username, username, user_id, changed_at, reserved_forever
  ) VALUES (
    lower(btrim(OLD.username)), OLD.username, NEW.id,
    COALESCE(NEW.username_changed_at, timezone('utc'::text, now())), TRUE
  )
  ON CONFLICT (normalized_username) DO UPDATE
  SET username = EXCLUDED.username,
      changed_at = LEAST(public.username_history.changed_at, EXCLUDED.changed_at)
  WHERE public.username_history.user_id = EXCLUDED.user_id;

  -- Compatibility snapshots. All authorization and reads use the id columns;
  -- these updates keep old clients and exports coherent during staged rollout.
  UPDATE public.reviews SET username = NEW.username WHERE user_id = NEW.id;
  UPDATE public.bookmarks SET username = NEW.username WHERE user_id = NEW.id;
  UPDATE public.notifications SET username = NEW.username WHERE user_id = NEW.id;
  UPDATE public.messages SET username = NEW.username WHERE recipient_id = NEW.id;
  UPDATE public.messages SET sender = NEW.username WHERE sender_id = NEW.id;
  UPDATE public.reading_progress SET username = NEW.username WHERE user_id = NEW.id;
  UPDATE public.blocked_users SET username = NEW.username WHERE blocker_user_id = NEW.id;
  UPDATE public.blocked_users SET blocked_username = NEW.username WHERE blocked_user_id = NEW.id;
  UPDATE public.forum_threads SET author = NEW.username
    WHERE COALESCE(user_id, author_id) = NEW.id;
  UPDATE public.forum_posts SET author = NEW.username
    WHERE COALESCE(user_id, author_id) = NEW.id;
  UPDATE public.social SET author = NEW.username WHERE user_id = NEW.id;
  UPDATE public.social SET username = NEW.username WHERE target_user_id = NEW.id;

  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_sync_username_change ON public.users;
CREATE TRIGGER users_sync_username_change
AFTER UPDATE OF username ON public.users
FOR EACH ROW
WHEN (OLD.username IS DISTINCT FROM NEW.username)
EXECUTE FUNCTION public.sync_username_change();

CREATE OR REPLACE FUNCTION public.reserve_deleted_username()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('username:' || lower(btrim(OLD.username)), 0)
  );
  INSERT INTO public.username_history(
    normalized_username, username, user_id, changed_at, reserved_forever
  ) VALUES (
    lower(btrim(OLD.username)), OLD.username, OLD.id,
    timezone('utc'::text, now()), TRUE
  )
  ON CONFLICT (normalized_username) DO NOTHING;
  RETURN OLD;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_reserve_deleted_username ON public.users;
CREATE TRIGGER users_reserve_deleted_username
BEFORE DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.reserve_deleted_username();

COMMIT;
