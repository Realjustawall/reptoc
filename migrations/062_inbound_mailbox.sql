BEGIN;

-- Inbox for the built-in inbound SMTP receiver (admin-configured port/domain).
CREATE TABLE IF NOT EXISTS public.inbound_emails (
  id TEXT PRIMARY KEY,
  envelope_from TEXT NOT NULL DEFAULT '',
  envelope_to TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  raw_size INTEGER NOT NULL DEFAULT 0,
  raw TEXT NOT NULL DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT false,
  received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_inbound_emails_received
  ON public.inbound_emails (received_at DESC);

COMMIT;
