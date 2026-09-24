ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS reporter_name TEXT,
  ADD COLUMN IF NOT EXISTS reporter_email TEXT,
  ADD COLUMN IF NOT EXISTS reporter_phone TEXT,
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());

ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS is_admin INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_created
  ON public.support_tickets(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created
  ON public.support_messages(ticket_id, created_at ASC);
