-- migrations/066_session_last_activity.sql
-- ✅ Security migration: add last_activity tracking to sessions table
-- for sliding expiration / idle timeout enforcement.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS sessions_last_activity_idx ON sessions(last_activity);

-- ✅ Optional: cleanup job. Delete sessions that have been inactive for
-- more than 30 days. Schedule via cron, e.g.:
--   0 3 * * * psql $DATABASE_URL -c "SELECT cleanup_old_sessions();"
CREATE OR REPLACE FUNCTION cleanup_old_sessions() RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM sessions
   WHERE last_activity < now() - interval '30 days'
      OR expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
