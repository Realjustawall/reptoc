CREATE TABLE IF NOT EXISTS public.premium_entitlement_cache_versions (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.premium_entitlement_cache_versions(user_id)
SELECT id FROM public.users ON CONFLICT(user_id) DO NOTHING;
