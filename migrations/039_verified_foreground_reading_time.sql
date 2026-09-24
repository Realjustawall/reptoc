-- Only foreground time emitted by the mounted chapter reader contributes to
-- profile hours and reader rankings. Existing rows remain unverified because
-- older clients derived time from scroll gaps or total wall-clock duration.
ALTER TABLE public.reading_sessions
ADD COLUMN IF NOT EXISTS foreground_active BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS ip_hash TEXT,
ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT 'XX',
ADD COLUMN IF NOT EXISTS country_name TEXT DEFAULT 'Untraceable',
ADD COLUMN IF NOT EXISTS region_name TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS city_name TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS is_vpn BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS device_type TEXT DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS device_os TEXT DEFAULT 'Unknown OS',
ADD COLUMN IF NOT EXISTS device_browser TEXT DEFAULT 'Unknown Browser',
ADD COLUMN IF NOT EXISTS user_agent_hash TEXT;

-- Some older production databases predate the geo/device analytics migration.
-- Keep the paired log insert compatible so a verified reader session cannot be
-- rejected after its reading_sessions row has already been stored.
ALTER TABLE public.analytics_logs
ADD COLUMN IF NOT EXISTS chapter_id TEXT,
ADD COLUMN IF NOT EXISTS viewer_id TEXT,
ADD COLUMN IF NOT EXISTS read_seconds INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS scroll_percentage NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'web',
ADD COLUMN IF NOT EXISTS ip_hash TEXT,
ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT 'XX',
ADD COLUMN IF NOT EXISTS country_name TEXT DEFAULT 'Untraceable',
ADD COLUMN IF NOT EXISTS region_name TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS city_name TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS is_vpn BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS device_type TEXT DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS device_os TEXT DEFAULT 'Unknown OS',
ADD COLUMN IF NOT EXISTS device_browser TEXT DEFAULT 'Unknown Browser',
ADD COLUMN IF NOT EXISTS user_agent_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_foreground
ON public.reading_sessions(user_id, created_at DESC)
WHERE foreground_active = true;

CREATE INDEX IF NOT EXISTS idx_analytics_logs_novel_country
ON public.analytics_logs(novel_id, country_code);

CREATE INDEX IF NOT EXISTS idx_analytics_logs_novel_device
ON public.analytics_logs(novel_id, device_type);

ALTER TABLE public.users
ALTER COLUMN streak SET DEFAULT 0;
