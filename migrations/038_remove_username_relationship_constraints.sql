-- Phase 2: after the ID-aware application is deployed, remove legacy
-- username-keyed relationship uniqueness. Display snapshot columns remain for
-- exports and compatibility, but they no longer define record identity.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_user_novel_unique
  ON public.bookmarks(user_id, novel_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_users_ids_unique
  ON public.blocked_users(blocker_user_id, blocked_user_id);

ALTER TABLE public.bookmarks
  DROP CONSTRAINT IF EXISTS bookmarks_username_novel_id_key;

ALTER TABLE public.blocked_users
  DROP CONSTRAINT IF EXISTS blocked_users_username_blocked_username_key;

COMMIT;
