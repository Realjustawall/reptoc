-- 058: Canonical notifications schema + user notification preferences.
-- Idempotent; safe to run on any environment state. Applying this with the
-- migration runner removes the need for runtime DDL by the application role.

CREATE TABLE IF NOT EXISTS public.notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
  username TEXT,
  title TEXT NOT NULL,
  text TEXT,
  message TEXT,
  type TEXT DEFAULT 'system',
  link TEXT,
  time TEXT DEFAULT 'Just now',
  is_read INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS text TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'system';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS time TEXT DEFAULT 'Just now';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_read INTEGER DEFAULT 0;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_username_created ON public.notifications(username, created_at DESC);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_comments BOOLEAN DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_ratings BOOLEAN DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_defaults BOOLEAN DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_replies BOOLEAN DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_logins BOOLEAN DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_followers BOOLEAN DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_likes BOOLEAN DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_bookmarks BOOLEAN DEFAULT true;

-- Engagement statistics read model for author dashboards.
CREATE INDEX IF NOT EXISTS idx_chapter_comments_novel_visible
  ON public.chapter_comments(novel_id)
  WHERE deleted_at IS NULL AND moderation_status = 'visible';
CREATE INDEX IF NOT EXISTS idx_novel_likes_novel ON public.novel_likes(novel_id);
