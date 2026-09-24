-- Durable, server-timed view tracking for the August 2026 views event.
-- The end timestamp is exclusive, so the full day of August 31 UTC counts.
BEGIN;

CREATE TABLE IF NOT EXISTS public.novel_event_views (
  event_id TEXT NOT NULL,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  viewer_key TEXT NOT NULL,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (event_id, novel_id, viewer_key)
);

CREATE INDEX IF NOT EXISTS idx_novel_event_views_leaderboard
  ON public.novel_event_views(event_id, novel_id, created_at);

CREATE INDEX IF NOT EXISTS idx_novel_event_views_created
  ON public.novel_event_views(event_id, created_at);

CREATE TABLE IF NOT EXISTS public.novel_event_excluded_authors (
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  matched_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (event_id, user_id)
);

-- Resolve the named staff accounts once so a later username or pen-name change
-- cannot make their novels eligible. Live name checks remain in the API too.
INSERT INTO public.novel_event_excluded_authors (event_id, user_id, matched_name)
SELECT
  'august-views-2026',
  account.id,
  MIN(match_source.matched_name)
FROM public.users account
CROSS JOIN LATERAL (
  SELECT account.username AS matched_name
  WHERE regexp_replace(lower(btrim(account.username)), '[^a-z0-9]+', '_', 'g') = ANY (ARRAY['the_bestx', 'the_lite', 'abyss_kid']::text[])
  UNION ALL
  SELECT history.username
  FROM public.username_history history
  WHERE history.user_id = account.id
    AND regexp_replace(lower(btrim(history.username)), '[^a-z0-9]+', '_', 'g') = ANY (ARRAY['the_bestx', 'the_lite', 'abyss_kid']::text[])
  UNION ALL
  SELECT novel.author
  FROM public.novels novel
  WHERE novel.author_id = account.id
    AND regexp_replace(lower(btrim(novel.author)), '[^a-z0-9]+', '_', 'g') = ANY (ARRAY['the_bestx', 'the_lite', 'abyss_kid']::text[])
) match_source
GROUP BY account.id
ON CONFLICT (event_id, user_id) DO NOTHING;

-- If deployment happens after the event starts, preserve already-recorded
-- normal unique views from the analytics source of truth.
INSERT INTO public.novel_event_views (event_id, novel_id, viewer_key, user_id, created_at)
SELECT DISTINCT ON (historical.novel_id, historical.viewer_key)
  'august-views-2026',
  historical.novel_id,
  historical.viewer_key,
  historical.viewer_id,
  historical.created_at
FROM (
  SELECT
    log.novel_id,
    CASE
      WHEN log.viewer_id IS NOT NULL THEN 'user:' || log.viewer_id
      WHEN log.ip_hash IS NOT NULL AND log.user_agent_hash IS NOT NULL
        THEN 'guest:' || log.ip_hash || ':' || log.user_agent_hash
      ELSE NULL
    END AS viewer_key,
    log.viewer_id,
    log.created_at
  FROM public.analytics_logs log
  WHERE log.action_type = 'view'
    AND log.novel_id IS NOT NULL
    AND log.created_at >= TIMESTAMPTZ '2026-08-01 00:00:00+00'
    AND log.created_at < TIMESTAMPTZ '2026-09-01 00:00:00+00'
) historical
JOIN public.novels historical_novel ON historical_novel.id = historical.novel_id
WHERE historical.viewer_key IS NOT NULL
  AND lower(COALESCE(historical_novel.approval_status, '')) = 'approved'
ORDER BY historical.novel_id, historical.viewer_key, historical.created_at ASC
ON CONFLICT (event_id, novel_id, viewer_key) DO NOTHING;

COMMIT;
