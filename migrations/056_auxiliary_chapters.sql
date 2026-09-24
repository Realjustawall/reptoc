ALTER TABLE public.chapters
  ADD COLUMN IF NOT EXISTS is_auxiliary BOOLEAN NOT NULL DEFAULT false;

-- Normal and auxiliary chapters each have their own numbering sequence. This
-- preserves every existing chapter number while allowing (for example) both
-- Chapter 3 and Auxiliary 3 in the same novel.
DROP INDEX IF EXISTS public.idx_chapters_novel_number;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chapters_novel_number
  ON public.chapters(novel_id, chapter_number)
  WHERE is_auxiliary = false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chapters_novel_auxiliary_number
  ON public.chapters(novel_id, chapter_number)
  WHERE is_auxiliary = true;

CREATE INDEX IF NOT EXISTS idx_chapters_novel_kind_order
  ON public.chapters(novel_id, is_auxiliary, order_index, chapter_number);
