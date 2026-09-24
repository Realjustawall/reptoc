-- Real reader progress/stat columns and ownership-safe uniqueness.

CREATE TABLE IF NOT EXISTS public.reading_progress (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  novel_title TEXT,
  novel_cover TEXT,
  novel_genre TEXT,
  novel_author TEXT,
  chapter_id TEXT,
  chapter_title TEXT,
  chapter_number INTEGER DEFAULT 1,
  scroll_percentage NUMERIC DEFAULT 0,
  read_seconds INTEGER DEFAULT 0,
  completed BOOLEAN DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.reading_progress
  ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS novel_cover TEXT,
  ADD COLUMN IF NOT EXISTS novel_genre TEXT,
  ADD COLUMN IF NOT EXISTS novel_author TEXT,
  ADD COLUMN IF NOT EXISTS chapter_title TEXT,
  ADD COLUMN IF NOT EXISTS read_seconds INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT false;

ALTER TABLE public.reading_progress
  ALTER COLUMN scroll_percentage TYPE NUMERIC USING scroll_percentage::numeric;

CREATE INDEX IF NOT EXISTS idx_reading_progress_user
  ON public.reading_progress(user_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_progress_user_novel_unique
  ON public.reading_progress(user_id, novel_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.reading_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  novel_id TEXT,
  chapter_id TEXT,
  read_seconds INTEGER DEFAULT 0,
  scroll_percentage NUMERIC DEFAULT 0,
  source TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.reading_sessions
  ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS novel_id TEXT,
  ADD COLUMN IF NOT EXISTS chapter_id TEXT,
  ADD COLUMN IF NOT EXISTS read_seconds INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scroll_percentage NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_chapter
  ON public.reading_sessions(user_id, novel_id, chapter_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_user_novel_unique
  ON public.bookmarks(user_id, novel_id)
  WHERE user_id IS NOT NULL;
