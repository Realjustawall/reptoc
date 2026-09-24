ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS target_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_snapshot JSONB;

CREATE INDEX IF NOT EXISTS idx_reports_reporter_created
  ON public.reports(reporter_id, created_at DESC);
