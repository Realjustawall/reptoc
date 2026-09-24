BEGIN;

-- Manga support.
--
-- A work is either prose ("novel") or a page-based comic ("manga"). Manga
-- chapters hold ordered image pages instead of HTML, so pages live in their own
-- table; everything else (chapters, comments, likes, bookmarks, reading
-- progress, moderation, deletion) is shared with prose and is not duplicated.
ALTER TABLE public.novels
  ADD COLUMN IF NOT EXISTS content_kind TEXT NOT NULL DEFAULT 'novel';

-- Page-turn direction. Japanese-style manga reads right-to-left, which also
-- matches Persian readers; a translated or original work may prefer LTR.
ALTER TABLE public.novels
  ADD COLUMN IF NOT EXISTS reading_direction TEXT NOT NULL DEFAULT 'rtl';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'novels_content_kind_check') THEN
    ALTER TABLE public.novels
      ADD CONSTRAINT novels_content_kind_check CHECK (content_kind IN ('novel', 'manga'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'novels_reading_direction_check') THEN
    ALTER TABLE public.novels
      ADD CONSTRAINT novels_reading_direction_check CHECK (reading_direction IN ('rtl', 'ltr'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_novels_content_kind ON public.novels (content_kind);

-- Denormalised page total so chapter lists and the reader can show progress
-- without loading page rows. Maintained by the manga page writer.
ALTER TABLE public.chapters
  ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.manga_pages (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  -- Reordering parks pages on a high temporary number inside one transaction
  -- before writing their final position, so the ordering index can never
  -- collide mid-write. The ceiling stays far above the per-chapter page cap.
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  image_url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  alt_text TEXT NOT NULL DEFAULT '',
  is_spread BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_manga_pages_chapter_number
  ON public.manga_pages (chapter_id, page_number);

CREATE INDEX IF NOT EXISTS idx_manga_pages_novel ON public.manga_pages (novel_id);

COMMIT;
