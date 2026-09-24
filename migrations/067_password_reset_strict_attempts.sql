-- migrations/067_password_reset_strict_attempts.sql
-- ✅ Security migration: enforce 5 attempts per code at the database level
-- (previously enforced in application code only). Adds a hard CHECK constraint
-- so a future regression cannot allow unlimited attempts.

-- `password_reset_codes` is normally created lazily at runtime by
-- ensurePasswordResetTables(), so a fresh database that has never served a
-- password reset does not have it yet. Create it here with the same shape the
-- runtime uses, making this migration self-sufficient and order-independent.
CREATE TABLE IF NOT EXISTS password_reset_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  request_ip_hash TEXT NOT NULL,
  request_user_agent_hash TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE password_reset_codes ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0;
ALTER TABLE password_reset_codes ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE password_reset_codes ADD COLUMN IF NOT EXISTS request_user_agent_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_password_reset_codes_email_active
  ON password_reset_codes(email_hash, expires_at, consumed_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user_active
  ON password_reset_codes(user_id, expires_at, consumed_at);

-- Existing rows above the cap would make the constraint invalid, so clamp them
-- first. Anything at or past the limit is exhausted and must be consumed.
UPDATE password_reset_codes
   SET consumed_at = COALESCE(consumed_at, timezone('utc'::text, now())),
       attempts = 5
 WHERE attempts > 5;

ALTER TABLE password_reset_codes
  DROP CONSTRAINT IF EXISTS password_reset_attempts_max;

ALTER TABLE password_reset_codes
  ADD CONSTRAINT password_reset_attempts_max
  CHECK (attempts IS NULL OR attempts <= 5);

-- ✅ Self-clean: any code with attempts >= 5 should be considered consumed
-- (matches the application-layer logic in server/api/index.ts).
CREATE OR REPLACE FUNCTION mark_exhausted_reset_codes_consumed() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.attempts >= 5 AND NEW.consumed_at IS NULL THEN
    NEW.consumed_at = timezone('utc'::text, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS password_reset_attempts_consume_trigger ON password_reset_codes;
CREATE TRIGGER password_reset_attempts_consume_trigger
  BEFORE UPDATE OF attempts ON password_reset_codes
  FOR EACH ROW
  EXECUTE FUNCTION mark_exhausted_reset_codes_consumed();
