BEGIN;

-- The upload route has always treated this audit as diagnostic rather than
-- user-facing data. Some production databases predate migration 001, so make
-- the existing contract available without changing stored files or profiles.
CREATE TABLE IF NOT EXISTS public.upload_audits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  file_hash TEXT UNIQUE,
  mime_type TEXT,
  scan_status TEXT NOT NULL DEFAULT 'pending',
  scan_result TEXT,
  quarantined BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_upload_audits_user
  ON public.upload_audits(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_upload_audits_hash
  ON public.upload_audits(file_hash);

COMMIT;
