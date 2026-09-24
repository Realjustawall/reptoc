ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_bio TEXT DEFAULT '';

ALTER TABLE public.analytics_logs ADD COLUMN IF NOT EXISTS ip_hash TEXT;
ALTER TABLE public.analytics_logs ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT 'XX';
ALTER TABLE public.analytics_logs ADD COLUMN IF NOT EXISTS country_name TEXT DEFAULT 'Untraceable';
ALTER TABLE public.analytics_logs ADD COLUMN IF NOT EXISTS region_name TEXT DEFAULT '';
ALTER TABLE public.analytics_logs ADD COLUMN IF NOT EXISTS city_name TEXT DEFAULT '';
ALTER TABLE public.analytics_logs ADD COLUMN IF NOT EXISTS is_vpn BOOLEAN DEFAULT false;
ALTER TABLE public.analytics_logs ADD COLUMN IF NOT EXISTS device_type TEXT DEFAULT 'unknown';
ALTER TABLE public.analytics_logs ADD COLUMN IF NOT EXISTS device_os TEXT DEFAULT 'Unknown OS';
ALTER TABLE public.analytics_logs ADD COLUMN IF NOT EXISTS device_browser TEXT DEFAULT 'Unknown Browser';
ALTER TABLE public.analytics_logs ADD COLUMN IF NOT EXISTS user_agent_hash TEXT;

ALTER TABLE public.reading_sessions ADD COLUMN IF NOT EXISTS ip_hash TEXT;
ALTER TABLE public.reading_sessions ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT 'XX';
ALTER TABLE public.reading_sessions ADD COLUMN IF NOT EXISTS country_name TEXT DEFAULT 'Untraceable';
ALTER TABLE public.reading_sessions ADD COLUMN IF NOT EXISTS region_name TEXT DEFAULT '';
ALTER TABLE public.reading_sessions ADD COLUMN IF NOT EXISTS city_name TEXT DEFAULT '';
ALTER TABLE public.reading_sessions ADD COLUMN IF NOT EXISTS is_vpn BOOLEAN DEFAULT false;
ALTER TABLE public.reading_sessions ADD COLUMN IF NOT EXISTS device_type TEXT DEFAULT 'unknown';
ALTER TABLE public.reading_sessions ADD COLUMN IF NOT EXISTS device_os TEXT DEFAULT 'Unknown OS';
ALTER TABLE public.reading_sessions ADD COLUMN IF NOT EXISTS device_browser TEXT DEFAULT 'Unknown Browser';
ALTER TABLE public.reading_sessions ADD COLUMN IF NOT EXISTS user_agent_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_analytics_logs_novel_country ON public.analytics_logs (novel_id, country_code);
CREATE INDEX IF NOT EXISTS idx_analytics_logs_novel_device ON public.analytics_logs (novel_id, device_type);
CREATE INDEX IF NOT EXISTS idx_analytics_logs_novel_created ON public.analytics_logs (novel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_novel_country ON public.reading_sessions (novel_id, country_code);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_novel_device ON public.reading_sessions (novel_id, device_type);
