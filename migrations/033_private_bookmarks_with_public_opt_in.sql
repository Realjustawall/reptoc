ALTER TABLE public.bookmarks
ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private';

UPDATE public.bookmarks
SET visibility = 'private'
WHERE visibility IS NULL OR visibility NOT IN ('private', 'public');

ALTER TABLE public.bookmarks
ALTER COLUMN visibility SET DEFAULT 'private',
ALTER COLUMN visibility SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookmarks_public_user_updated
ON public.bookmarks(user_id, updated_at DESC)
WHERE visibility = 'public';
