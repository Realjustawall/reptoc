BEGIN;

CREATE TABLE IF NOT EXISTS public.character_votes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT character_votes_one_per_character UNIQUE (user_id, novel_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_character_votes_novel_character
  ON public.character_votes(novel_id, character_id);

CREATE INDEX IF NOT EXISTS idx_character_votes_user_created
  ON public.character_votes(user_id, created_at);

COMMIT;
