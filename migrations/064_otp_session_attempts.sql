BEGIN;

-- Server-side attempt counter for pending 2FA login sessions. After 5 wrong
-- codes the session row is deleted by the application.
ALTER TABLE public.otp_sessions ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

COMMIT;
