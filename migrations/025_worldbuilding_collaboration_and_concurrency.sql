CREATE TABLE IF NOT EXISTS public.novel_collaborators (
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  can_manage_worldbuilding BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(novel_id,user_id)
);
ALTER TABLE public.worldbuilding_resources ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_worldbuilding_parent ON public.worldbuilding_resources(novel_id,parent_id);
