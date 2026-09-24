ALTER TABLE public.users ADD COLUMN IF NOT EXISTS google_sub TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS google_connected BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_set BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique
  ON public.users (google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.oauth_states (
  state_hash TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('login', 'link')),
  user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_states_expires_idx ON public.oauth_states (expires_at);
