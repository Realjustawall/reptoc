-- Administrative user controls for login and publishing restrictions.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS publishing_blocked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_staff BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS premium_lifetime BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_author BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_role BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
