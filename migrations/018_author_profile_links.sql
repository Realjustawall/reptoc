CREATE TABLE IF NOT EXISTS public.author_profile_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_author_profile_links_user_position
  ON public.author_profile_links(user_id, position, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_author_profile_links_user_url
  ON public.author_profile_links(user_id, url);
