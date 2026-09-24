-- A novel view is counted once per viewer for the lifetime of the novel.
ALTER TABLE public.analytics_logs
  ADD COLUMN IF NOT EXISTS viewer_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ip_hash TEXT,
  ADD COLUMN IF NOT EXISTS user_agent_hash TEXT;

CREATE TABLE IF NOT EXISTS public.novel_unique_views (
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  viewer_key TEXT NOT NULL,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (novel_id, viewer_key)
);

CREATE INDEX IF NOT EXISTS idx_novel_unique_views_user
  ON public.novel_unique_views(user_id, novel_id);

-- Import one historical view for each identifiable signed-in user or guest
-- device. Re-running this migration is safe because of the primary key.
INSERT INTO public.novel_unique_views (novel_id, viewer_key, user_id, created_at)
SELECT DISTINCT ON (novel_id, viewer_key)
  novel_id,
  viewer_key,
  viewer_id,
  created_at
FROM (
  SELECT
    novel_id,
    CASE
      WHEN viewer_id IS NOT NULL THEN 'user:' || viewer_id
      WHEN ip_hash IS NOT NULL AND user_agent_hash IS NOT NULL THEN 'guest:' || ip_hash || ':' || user_agent_hash
      ELSE NULL
    END AS viewer_key,
    viewer_id,
    created_at
  FROM public.analytics_logs
  WHERE action_type = 'view' AND novel_id IS NOT NULL
) historical
WHERE viewer_key IS NOT NULL
ORDER BY novel_id, viewer_key, created_at ASC
ON CONFLICT (novel_id, viewer_key) DO NOTHING;

-- Correct stored totals to the unique-view source of truth.
UPDATE public.novels AS novel
SET views_count = (
  SELECT COUNT(*)::INTEGER
  FROM public.novel_unique_views AS unique_view
  WHERE unique_view.novel_id = novel.id
);
