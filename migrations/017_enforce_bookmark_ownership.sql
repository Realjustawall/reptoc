-- Bookmark libraries are private and every row must have one explicit owner.
-- Preserve legacy rows where the username still identifies that owner, then
-- discard rows which cannot safely be assigned to an account.

UPDATE public.bookmarks AS bookmark
SET user_id = users.id
FROM public.users AS users
WHERE bookmark.user_id IS NULL
  AND bookmark.username = users.username;

DELETE FROM public.bookmarks
WHERE user_id IS NULL;

ALTER TABLE public.bookmarks
  ALTER COLUMN user_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_user_novel_unique
  ON public.bookmarks(user_id, novel_id);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_updated
  ON public.bookmarks(user_id, updated_at DESC);
