-- Smart/manual moderation workflow for all chapter and paragraph comments.
-- Existing comments stay visible; only newly submitted comments use the queue.
ALTER TABLE public.chapter_comments
  ALTER COLUMN moderation_status SET DEFAULT 'pending';

ALTER TABLE public.chapter_comments
  ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS moderated_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moderation_source TEXT,
  ADD COLUMN IF NOT EXISTS moderation_result TEXT;

CREATE INDEX IF NOT EXISTS idx_chapter_comments_moderation_queue
  ON public.chapter_comments(moderation_status, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

