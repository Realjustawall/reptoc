ALTER TABLE public.forum_threads
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Preserve currently visible legacy discussions during rollout. New threads
-- are explicitly inserted as pending_approval by the API.
UPDATE public.forum_threads SET approval_status = 'approved';
ALTER TABLE public.forum_threads ALTER COLUMN approval_status SET DEFAULT 'pending_approval';
