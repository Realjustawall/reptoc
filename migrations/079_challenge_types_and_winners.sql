BEGIN;

-- Challenges can either ask readers to continue a prompt or name a story from
-- an illustration. Winner ranks remain private until the owner publishes them.
ALTER TABLE public.daily_challenges
  ADD COLUMN IF NOT EXISTS challenge_type TEXT NOT NULL DEFAULT 'continuation',
  ADD COLUMN IF NOT EXISTS winners_announced_at TIMESTAMPTZ;

ALTER TABLE public.daily_challenges
  DROP CONSTRAINT IF EXISTS daily_challenges_challenge_type_check;

ALTER TABLE public.daily_challenges
  ADD CONSTRAINT daily_challenges_challenge_type_check
  CHECK (challenge_type IN ('continuation', 'story_naming'));

ALTER TABLE public.daily_challenge_entries
  ADD COLUMN IF NOT EXISTS winner_rank SMALLINT;

ALTER TABLE public.daily_challenge_entries
  DROP CONSTRAINT IF EXISTS daily_challenge_entries_winner_rank_check;

ALTER TABLE public.daily_challenge_entries
  ADD CONSTRAINT daily_challenge_entries_winner_rank_check
  CHECK (winner_rank IS NULL OR winner_rank BETWEEN 1 AND 3);

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_challenge_winner_rank
  ON public.daily_challenge_entries (challenge_id, winner_rank)
  WHERE winner_rank IS NOT NULL;

COMMIT;
