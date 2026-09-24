ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS last_streak_date DATE;

CREATE INDEX IF NOT EXISTS idx_users_last_streak_date
ON public.users(last_streak_date);
