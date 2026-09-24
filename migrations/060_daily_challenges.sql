BEGIN;

-- Daily writing challenges: an admin publishes a story prompt and users try
-- to continue it. Entries stay hidden until an admin approves them.

CREATE TABLE IF NOT EXISTS public.daily_challenges (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.daily_challenge_entries (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES public.daily_challenges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL CHECK (char_length(content) <= 5000),
  moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_daily_challenges_status_created
  ON public.daily_challenges (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_challenge_entries_challenge
  ON public.daily_challenge_entries (challenge_id, moderation_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_challenge_entries_user
  ON public.daily_challenge_entries (user_id, created_at DESC);

-- One continuation per user per challenge keeps the game fair.
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_challenge_entry_once
  ON public.daily_challenge_entries (challenge_id, user_id);

COMMIT;
