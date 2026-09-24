-- migrations/073_suggestion_engagement_reset.sql
-- ✅ FIX SG-2: Add columns for tracking when engagement counters were last reset.
--
-- This is an optional enhancement. The application-level reset functions
-- in maintenance.ts (resetEngagementCounters, resetWeeklyEngagementCounters)
-- work without these columns, but having them allows for monitoring and
-- ensures correctness even if the cron job is missed.

ALTER TABLE suggestion_novel_stats
  ADD COLUMN IF NOT EXISTS engagement_24h_reset_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());

ALTER TABLE suggestion_novel_stats
  ADD COLUMN IF NOT EXISTS engagement_7d_reset_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());

-- Index for finding novels whose 24h counter hasn't been reset recently.
CREATE INDEX IF NOT EXISTS idx_suggestion_novel_stats_24h_reset
  ON suggestion_novel_stats (engagement_24h_reset_at)
  WHERE engagement_24h > 0;

-- Function to reset 24h engagement and update the reset timestamp.
CREATE OR REPLACE FUNCTION reset_engagement_24h() RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE suggestion_novel_stats
     SET engagement_24h = 0,
         engagement_24h_reset_at = timezone('utc'::text, now())
   WHERE engagement_24h > 0;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql;

-- Function to reset 7d engagement and update the reset timestamp.
CREATE OR REPLACE FUNCTION reset_engagement_7d() RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE suggestion_novel_stats
     SET engagement_7d = 0,
         engagement_7d_reset_at = timezone('utc'::text, now())
   WHERE engagement_7d > 0;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql;
