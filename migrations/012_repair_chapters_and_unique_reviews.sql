ALTER TABLE public.chapters
  ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'visible',
  ADD COLUMN IF NOT EXISTS editor_checklist JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS editorial_status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS assigned_editor_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

DROP INDEX IF EXISTS public.idx_chapters_novel_number;

CREATE UNIQUE INDEX idx_chapters_novel_number
  ON public.chapters(novel_id, chapter_number);

CREATE INDEX IF NOT EXISTS idx_chapters_schedule
  ON public.chapters(status, scheduled_at) WHERE status = 'Scheduled';

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_one_per_user_novel
  ON public.reviews(novel_id, user_id) WHERE user_id IS NOT NULL;
