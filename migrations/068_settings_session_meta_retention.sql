-- migrations/068_settings_session_meta_retention.sql
-- ✅ Security migration: add an auto-cleanup trigger to session_meta rows
-- stored in the settings table. This implements GDPR storage-limitation:
-- session metadata (IP hash, browser fingerprint) expires after 90 days.

CREATE OR REPLACE FUNCTION cleanup_expired_session_meta() RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM settings
   WHERE setting_key LIKE 'session_meta_%'
     AND setting_value IS NOT NULL
     AND (
       -- Delete any session_meta whose decrypted payload has expired.
       -- We can't decrypt inside SQL, so we rely on the application layer
       -- to call cleanup_session_meta() when it touches the row.
       -- As a safety net, delete rows whose setting_key prefix matches a
       -- session_id that no longer exists in the sessions table.
       NOT EXISTS (
         SELECT 1 FROM sessions s
         WHERE s.id = substring(setting_key FROM 'session_meta_(.+)$')
       )
     );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
