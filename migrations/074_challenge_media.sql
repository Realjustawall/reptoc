BEGIN;

-- Daily challenges may carry one illustration and one narration clip so an
-- admin can publish a visual/audio prompt, not only text. Both columns hold a
-- stored upload reference (`/uploads/...`), never raw binary.
ALTER TABLE public.daily_challenges
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS audio_url TEXT;

COMMIT;
