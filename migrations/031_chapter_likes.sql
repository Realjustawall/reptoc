CREATE TABLE IF NOT EXISTS public.chapter_likes (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (chapter_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chapter_like_daily_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  usage_date DATE DEFAULT (timezone('utc'::text, now()))::date NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id, chapter_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_chapter_likes_chapter ON public.chapter_likes(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapter_like_usage_user_date ON public.chapter_like_daily_usage(user_id, usage_date);
