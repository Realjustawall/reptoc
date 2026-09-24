-- migrations/071_password_reset_strict_logging.sql
-- ✅ SECURITY: Add an audit trail for password reset confirmations.
--
-- Tracks every confirm attempt (success or failure) so brute-force attacks
-- on the 6-digit code are visible in admin dashboards.

CREATE TABLE IF NOT EXISTS password_reset_attempts (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('request', 'request_limited', 'sent', 'send_failed', 'confirm_limited', 'confirm_failed', 'confirm_success')),
  user_id TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_attempts_email_hash_idx
  ON password_reset_attempts (email_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_attempts_ip_hash_idx
  ON password_reset_attempts (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_attempts_user_id_idx
  ON password_reset_attempts (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
