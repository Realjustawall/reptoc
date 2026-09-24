BEGIN;

CREATE TABLE IF NOT EXISTS public.chapter_comment_likes (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES public.chapter_comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chapter_comment_likes_comment
  ON public.chapter_comment_likes(comment_id);

CREATE INDEX IF NOT EXISTS idx_chapter_comment_likes_user
  ON public.chapter_comment_likes(user_id);

COMMIT;
