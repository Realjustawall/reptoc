-- Novel metadata and chapter writes use this timestamp to keep updated sorting
-- and cache freshness accurate. Early deployments only had created_at.
ALTER TABLE public.novels
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
  DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE INDEX IF NOT EXISTS idx_novels_updated_at
  ON public.novels(updated_at DESC);
