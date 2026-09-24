-- migrations/069_contest_unique_submission.sql
-- ✅ SECURITY: Prevent race condition where a user can submit multiple
-- entries to a single contest via concurrent requests.
--
-- Without this constraint, two POST requests fired in parallel could both
-- pass the existing-submission check and both insert successfully.

ALTER TABLE contest_submissions
  DROP CONSTRAINT IF EXISTS contest_submissions_user_unique;

ALTER TABLE contest_submissions
  ADD CONSTRAINT contest_submissions_user_unique
  UNIQUE (contest_id, user_id);

-- Index for faster lookups (the application does a SELECT before INSERT
-- to return a friendly error message; this index makes that lookup cheap).
CREATE INDEX IF NOT EXISTS contest_submissions_user_idx
  ON contest_submissions (contest_id, user_id);
