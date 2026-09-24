CREATE TABLE IF NOT EXISTS public.worldbuilding_cache_versions (
  novel_id TEXT PRIMARY KEY REFERENCES public.novels(id) ON DELETE CASCADE,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.worldbuilding_cache_versions(novel_id)
SELECT id FROM public.novels ON CONFLICT(novel_id) DO NOTHING;
CREATE UNIQUE INDEX IF NOT EXISTS idx_worldbuilding_relationship_unique
ON public.worldbuilding_resources(novel_id,(data->>'sourceId'),(data->>'targetId'),lower(COALESCE(subtype,'')),(COALESCE(data->>'direction','directed')))
WHERE resource_type='relationship';
