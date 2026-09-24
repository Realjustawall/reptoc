-- Run this against your PostgreSQL database to bootstrap the required tables.

-- 1. Users Table
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  nickname TEXT,
  first_name TEXT,
  last_name TEXT,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'writer',
  departments TEXT, -- JSON Array for departments ['billing', 'technical']
  notify_comments BOOLEAN DEFAULT true,
  notify_ratings BOOLEAN DEFAULT true,
  notify_defaults BOOLEAN DEFAULT true,
  notify_replies BOOLEAN DEFAULT true,
  notify_logins BOOLEAN DEFAULT true,
  notify_followers BOOLEAN DEFAULT true,
  notify_likes BOOLEAN DEFAULT true,
  notify_bookmarks BOOLEAN DEFAULT true,
  is_premium BOOLEAN DEFAULT false,
  premium_plan TEXT,
  premium_until TIMESTAMP WITH TIME ZONE,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  coins INTEGER DEFAULT 100,
  stars INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,
  last_streak_date DATE,
  avatar TEXT,
  username_changed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
  ON public.users(lower(username));

CREATE TABLE IF NOT EXISTS public.username_history (
  normalized_username TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  reserved_forever BOOLEAN NOT NULL DEFAULT true,
  CHECK (normalized_username = lower(btrim(username)))
);

-- 2. Sessions (For Auth)
CREATE TABLE IF NOT EXISTS public.sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Novels
CREATE TABLE IF NOT EXISTS public.novels (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  cover_url TEXT,
  description TEXT,
  rating DECIMAL DEFAULT 0.0,
  status TEXT DEFAULT 'Ongoing',
  approval_status TEXT DEFAULT 'pending_approval',
  approved_by TEXT REFERENCES public.users(id),
  editor_note TEXT,
  genre TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  warnings JSONB DEFAULT '[]'::jsonb,
  main_categories JSONB DEFAULT '[]'::jsonb,
  sub_categories JSONB DEFAULT '[]'::jsonb,
  age_rating TEXT DEFAULT 'PG-13',
  is_ai_generated BOOLEAN DEFAULT false,
  is_ai_assisted BOOLEAN DEFAULT false,
  -- 'novel' for prose, 'manga' for a page-based comic. Fixed at creation: the
  -- two store incompatible chapter bodies (HTML vs ordered image pages).
  content_kind TEXT NOT NULL DEFAULT 'novel' CHECK (content_kind IN ('novel', 'manga')),
  -- Page-turn direction for the manga reader.
  reading_direction TEXT NOT NULL DEFAULT 'rtl' CHECK (reading_direction IN ('rtl', 'ltr')),
  characters JSONB DEFAULT '[]'::jsonb,
  premium_presentation JSONB NOT NULL DEFAULT '{"enabled":false,"templateId":"royal"}'::jsonb,
  reviews_count INTEGER DEFAULT 0,
  bookmarks_count INTEGER DEFAULT 0,
  words_count INTEGER DEFAULT 0,
  views_count INTEGER DEFAULT 0,
  is_completed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.character_votes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id, novel_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_character_votes_novel_character
  ON public.character_votes(novel_id, character_id);
CREATE INDEX IF NOT EXISTS idx_character_votes_user_created
  ON public.character_votes(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_novels_content_kind ON public.novels(content_kind);

-- 4. Chapters
CREATE TABLE IF NOT EXISTS public.chapters (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  author_notes_top TEXT DEFAULT '',
  author_notes_bottom TEXT DEFAULT '',
  status TEXT DEFAULT 'Published',
  scheduled_at TIMESTAMP WITH TIME ZONE,
  chapter_number INTEGER DEFAULT 1,
  is_auxiliary BOOLEAN NOT NULL DEFAULT false,
  word_count INTEGER DEFAULT 0,
  -- Denormalised manga page total, maintained by the page writer so chapter
  -- lists and the reader never need to load page rows for a count.
  page_count INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER DEFAULT 0,
  views_count INTEGER DEFAULT 0,
  approval_status TEXT DEFAULT 'pending_approval',
  approved_by TEXT REFERENCES public.users(id),
  editor_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4b. Manga pages (one ordered image per row, per manga chapter)
CREATE TABLE IF NOT EXISTS public.manga_pages (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  image_url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  alt_text TEXT NOT NULL DEFAULT '',
  is_spread BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_manga_pages_chapter_number
  ON public.manga_pages(chapter_id, page_number);
CREATE INDEX IF NOT EXISTS idx_manga_pages_novel ON public.manga_pages(novel_id);

-- 5. Reviews
CREATE TABLE IF NOT EXISTS public.reviews (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  rating INTEGER DEFAULT 5,
  rating_overall INTEGER DEFAULT 5,
  rating_style INTEGER DEFAULT 5,
  rating_story INTEGER DEFAULT 5,
  rating_grammar INTEGER DEFAULT 5,
  rating_character INTEGER DEFAULT 5,
  content TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Social Stats / Leaderboards (Generic Social Stats per User)
CREATE TABLE IF NOT EXISTS public.social (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  target_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  author TEXT NOT NULL,
  username TEXT,
  avatar TEXT,
  type TEXT DEFAULT 'following',
  followed BOOLEAN DEFAULT false,
  followers INTEGER DEFAULT 0,
  following INTEGER DEFAULT 0,
  achievements TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Files (Uploads metadata)
CREATE TABLE IF NOT EXISTS public.files (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  mimetype TEXT,
  size BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.upload_audits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  file_hash TEXT UNIQUE,
  mime_type TEXT,
  scan_status TEXT NOT NULL DEFAULT 'pending',
  scan_result TEXT,
  quarantined BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_upload_audits_user ON public.upload_audits(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_audits_hash ON public.upload_audits(file_hash);

CREATE TABLE IF NOT EXISTS public.bookmarks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  shelf_status TEXT DEFAULT 'plan_to_read',
  category_id TEXT,
  notes TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(user_id, novel_id)
);

CREATE TABLE IF NOT EXISTS public.novel_likes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(novel_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chapter_likes (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(chapter_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chapter_like_daily_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  usage_date DATE DEFAULT (timezone('utc'::text, now()))::date NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(user_id, chapter_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_chapter_likes_chapter ON public.chapter_likes(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapter_like_usage_user_date ON public.chapter_like_daily_usage(user_id, usage_date);

CREATE TABLE IF NOT EXISTS public.email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.email_verification_failures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  attempted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.blocked_users (
  id TEXT PRIMARY KEY,
  blocker_user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  blocked_username TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(blocker_user_id, blocked_user_id)
);

-- 8. Messages / Emails
CREATE TABLE IF NOT EXISTS public.messages (
  id TEXT PRIMARY KEY,
  recipient_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  sender_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  snippet TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT,
  time TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 10. Reading Progress
CREATE TABLE IF NOT EXISTS public.reading_progress (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  novel_title TEXT,
  novel_cover TEXT,
  novel_genre TEXT,
  novel_author TEXT,
  chapter_id TEXT,
  chapter_title TEXT,
  chapter_number INTEGER,
  scroll_percentage NUMERIC DEFAULT 0,
  read_seconds INTEGER DEFAULT 0,
  completed BOOLEAN DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 11. Generic Settings Store (for characters, notes, system announcements, etc)
CREATE TABLE IF NOT EXISTS public.settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 12. Support Tickets
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  status TEXT DEFAULT 'OPEN',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 13. Support Messages
CREATE TABLE IF NOT EXISTS public.support_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 14. Forum Categories (Optional but good) or just Threads
CREATE TABLE IF NOT EXISTS public.achievements (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  reward_xp INTEGER DEFAULT 100,
  icon TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_achievements (
  id TEXT PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES public.achievements(id) ON DELETE CASCADE,
  claimed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS public.forum_threads (
  id TEXT PRIMARY KEY,
  forum_id TEXT,
  user_id TEXT REFERENCES public.users(id),
  content TEXT DEFAULT '',
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  author_id TEXT REFERENCES public.users(id),
  category TEXT NOT NULL,
  views INTEGER DEFAULT 0,
  replies INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,
  votes INTEGER DEFAULT 0,
  is_locked INTEGER DEFAULT 0,
  approval_status TEXT DEFAULT 'pending_approval',
  approved_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.forum_posts (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES public.forum_threads(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES public.users(id),
  author TEXT NOT NULL,
  author_id TEXT REFERENCES public.users(id),
  content TEXT NOT NULL,
  is_solution INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.forum_thread_votes (
  thread_id TEXT NOT NULL REFERENCES public.forum_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  PRIMARY KEY(thread_id, user_id)
);

-- 15. Editor Messages
CREATE TABLE IF NOT EXISTS public.editor_messages (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  receiver_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Uploaded file metadata is stored in PostgreSQL; binary files are served from the configured local upload path.

-- Function for incrementing novel views_count atomically
CREATE OR REPLACE FUNCTION increment_novel_views(row_id TEXT)
RETURNS void AS $$
BEGIN
  UPDATE public.novels 
  SET views_count = COALESCE(views_count, 0) + 1 
  WHERE id = row_id;
END;
$$ LANGUAGE plpgsql;

-- Security Extensions
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS login_attempts INTEGER DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS verified_author BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS verified_role BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_bio TEXT DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS google_sub TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS google_connected BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_set BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique ON public.users (google_sub) WHERE google_sub IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.oauth_states (
  state_hash TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('login', 'link')),
  user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_states_expires_idx ON public.oauth_states (expires_at);
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS rating_overall INTEGER DEFAULT 5;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS rating_style INTEGER DEFAULT 5;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS rating_story INTEGER DEFAULT 5;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS rating_grammar INTEGER DEFAULT 5;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS rating_character INTEGER DEFAULT 5;

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS csrf_cookie TEXT;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'public';
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE public.novels ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.novels ADD COLUMN IF NOT EXISTS warnings JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.novels ADD COLUMN IF NOT EXISTS main_categories JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.novels ADD COLUMN IF NOT EXISTS sub_categories JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.novels ADD COLUMN IF NOT EXISTS age_rating TEXT DEFAULT 'PG-13';
ALTER TABLE public.novels ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN DEFAULT false;
ALTER TABLE public.novels ADD COLUMN IF NOT EXISTS is_ai_assisted BOOLEAN DEFAULT false;
ALTER TABLE public.novels ADD COLUMN IF NOT EXISTS characters JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.novels ADD COLUMN IF NOT EXISTS bookmarks_count INTEGER DEFAULT 0;
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS content TEXT DEFAULT '';
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS author_notes_top TEXT DEFAULT '';
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS author_notes_bottom TEXT DEFAULT '';
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Published';
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS chapter_number INTEGER DEFAULT 1;
ALTER TABLE public.social ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.social ADD COLUMN IF NOT EXISTS avatar TEXT;
ALTER TABLE public.social ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'following';
ALTER TABLE public.social ADD COLUMN IF NOT EXISTS followed BOOLEAN DEFAULT false;
ALTER TABLE public.forum_threads ADD COLUMN IF NOT EXISTS forum_id TEXT;
ALTER TABLE public.forum_threads ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES public.users(id);
ALTER TABLE public.forum_threads ADD COLUMN IF NOT EXISTS content TEXT DEFAULT '';
ALTER TABLE public.forum_threads ADD COLUMN IF NOT EXISTS votes INTEGER DEFAULT 0;
ALTER TABLE public.forum_posts ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES public.users(id);
ALTER TABLE public.forum_posts ADD COLUMN IF NOT EXISTS is_pinned INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.security_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT,
  ip TEXT,
  ip_address TEXT,
  user_agent TEXT,
  description TEXT,
  severity TEXT DEFAULT 'info',
  details TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 16. Author Posts
CREATE TABLE IF NOT EXISTS public.author_posts (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  novel_id TEXT REFERENCES public.novels(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  likes_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 17. Follows
CREATE TABLE IF NOT EXISTS public.follows (
  id TEXT PRIMARY KEY,
  follower_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL, -- 'user' or 'novel'
  target_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 18. Ads Config
CREATE TABLE IF NOT EXISTS public.ads_config (
  id TEXT PRIMARY KEY,
  location TEXT UNIQUE NOT NULL,
  is_enabled BOOLEAN DEFAULT false,
  ad_code TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 19. Post Comments and Likes
CREATE TABLE IF NOT EXISTS public.post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES public.author_posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.post_likes (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES public.author_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(post_id, user_id)
);

-- 20. Analytics Logs
CREATE TABLE IF NOT EXISTS public.analytics_logs (
    id TEXT PRIMARY KEY,
    novel_id TEXT REFERENCES public.novels(id) ON DELETE CASCADE,
    chapter_id TEXT REFERENCES public.chapters(id) ON DELETE SET NULL,
    viewer_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL, -- 'view', 'like', 'bookmark', etc.
    read_seconds INTEGER DEFAULT 0,
    scroll_percentage INTEGER DEFAULT 0,
    source TEXT DEFAULT 'web',
    ip_hash TEXT,
    country_code TEXT DEFAULT 'XX',
    country_name TEXT DEFAULT 'Untraceable',
    region_name TEXT DEFAULT '',
    city_name TEXT DEFAULT '',
    is_vpn BOOLEAN DEFAULT false,
    device_type TEXT DEFAULT 'unknown',
    device_os TEXT DEFAULT 'Unknown OS',
    device_browser TEXT DEFAULT 'Unknown Browser',
    user_agent_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.novel_unique_views (
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  viewer_key TEXT NOT NULL,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (novel_id, viewer_key)
);

CREATE INDEX IF NOT EXISTS idx_novel_unique_views_user
  ON public.novel_unique_views(user_id, novel_id);

CREATE TABLE IF NOT EXISTS public.novel_event_views (
  event_id TEXT NOT NULL,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  viewer_key TEXT NOT NULL,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (event_id, novel_id, viewer_key)
);

CREATE INDEX IF NOT EXISTS idx_novel_event_views_leaderboard
  ON public.novel_event_views(event_id, novel_id, created_at);

CREATE INDEX IF NOT EXISTS idx_novel_event_views_created
  ON public.novel_event_views(event_id, created_at);

CREATE TABLE IF NOT EXISTS public.novel_event_excluded_authors (
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  matched_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (event_id, user_id)
);

ALTER TABLE public.analytics_logs ADD COLUMN IF NOT EXISTS chapter_id TEXT REFERENCES public.chapters(id) ON DELETE SET NULL;
ALTER TABLE public.analytics_logs ADD COLUMN IF NOT EXISTS read_seconds INTEGER DEFAULT 0;
ALTER TABLE public.analytics_logs ADD COLUMN IF NOT EXISTS scroll_percentage INTEGER DEFAULT 0;
ALTER TABLE public.analytics_logs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'web';
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

CREATE TABLE IF NOT EXISTS public.chapter_versions (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  changed_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  reason TEXT,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  author_notes_top TEXT DEFAULT '',
  author_notes_bottom TEXT DEFAULT '',
  status TEXT DEFAULT 'Draft',
  scheduled_at TIMESTAMP WITH TIME ZONE,
  chapter_number INTEGER DEFAULT 1,
  word_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.reading_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  novel_id TEXT REFERENCES public.novels(id) ON DELETE CASCADE,
  chapter_id TEXT REFERENCES public.chapters(id) ON DELETE SET NULL,
  read_seconds INTEGER DEFAULT 0,
  scroll_percentage INTEGER DEFAULT 0,
  source TEXT DEFAULT 'reader',
  foreground_active BOOLEAN NOT NULL DEFAULT false,
  ip_hash TEXT,
  country_code TEXT DEFAULT 'XX',
  country_name TEXT DEFAULT 'Untraceable',
  region_name TEXT DEFAULT '',
  city_name TEXT DEFAULT '',
  is_vpn BOOLEAN DEFAULT false,
  device_type TEXT DEFAULT 'unknown',
  device_os TEXT DEFAULT 'Unknown OS',
  device_browser TEXT DEFAULT 'Unknown Browser',
  user_agent_hash TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

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
ALTER TABLE public.reading_sessions ADD COLUMN IF NOT EXISTS foreground_active BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_analytics_logs_novel_country ON public.analytics_logs (novel_id, country_code);
CREATE INDEX IF NOT EXISTS idx_analytics_logs_novel_device ON public.analytics_logs (novel_id, device_type);
CREATE INDEX IF NOT EXISTS idx_analytics_logs_novel_created ON public.analytics_logs (novel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_novel_country ON public.reading_sessions (novel_id, country_code);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_novel_device ON public.reading_sessions (novel_id, device_type);

CREATE TABLE IF NOT EXISTS public.chapter_comments (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES public.chapter_comments(id) ON DELETE CASCADE,
  paragraph_index INTEGER,
  paragraph_id TEXT,
  content TEXT NOT NULL,
  is_pinned BOOLEAN DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  moderation_status TEXT NOT NULL DEFAULT 'visible',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.chapter_paragraphs (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  fingerprint TEXT NOT NULL,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chapter_comments_paragraph_id_fkey'
  ) THEN
    ALTER TABLE public.chapter_comments
      ADD CONSTRAINT chapter_comments_paragraph_id_fkey
      FOREIGN KEY (paragraph_id) REFERENCES public.chapter_paragraphs(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chapter_paragraphs_active ON public.chapter_paragraphs(chapter_id, ordinal) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chapter_comments_paragraph_page ON public.chapter_comments(chapter_id, paragraph_id, created_at, id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.chapter_comment_likes (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES public.chapter_comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chapter_comment_likes_comment ON public.chapter_comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_chapter_comment_likes_user ON public.chapter_comment_likes(user_id);

CREATE TABLE IF NOT EXISTS public.reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  target_snapshot JSONB,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT DEFAULT 'OPEN',
  priority TEXT DEFAULT 'normal',
  moderator_note TEXT,
  assigned_to TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  action_taken TEXT,
  resolved_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.premium_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  account_reference_hash TEXT,
  provider TEXT NOT NULL,
  provider_session_id TEXT,
  provider_event_id TEXT,
  plan_months INTEGER NOT NULL DEFAULT 1,
  -- The price the customer was shown, in cents. Reader and Writer are priced
  -- independently and Writer carries a promotion, so the advertised figure
  -- cannot be reconstructed from plan_months alone.
  quoted_amount_cents INTEGER,
  status TEXT DEFAULT 'pending',
  provider_payload TEXT,
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.account_deletion_audit (
  id TEXT PRIMARY KEY,
  account_reference_hash TEXT NOT NULL,
  deleted_novels INTEGER NOT NULL DEFAULT 0,
  deleted_chapters INTEGER NOT NULL DEFAULT 0,
  deleted_comments INTEGER NOT NULL DEFAULT 0,
  detached_financial_records INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.report_events (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.custom_roles (
  id TEXT PRIMARY KEY DEFAULT ('role-' || md5(random()::text || clock_timestamp()::text)),
  name TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  permissions JSONB DEFAULT '[]',
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.user_permissions (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  role_id TEXT REFERENCES public.custom_roles(id) ON DELETE SET NULL,
  permissions JSONB DEFAULT '[]',
  updated_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.comment_replies (
  id TEXT PRIMARY KEY DEFAULT ('cr-' || md5(random()::text || clock_timestamp()::text)),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  novel_id TEXT REFERENCES public.novels(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS custom_role_id TEXT REFERENCES public.custom_roles(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_staff BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS premium_lifetime BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS publishing_blocked BOOLEAN DEFAULT false;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS assigned_to TEXT REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';

ALTER TABLE public.bookmarks ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.bookmarks ADD COLUMN IF NOT EXISTS shelf_status TEXT DEFAULT 'plan_to_read';
ALTER TABLE public.bookmarks ADD COLUMN IF NOT EXISTS category_id TEXT;
ALTER TABLE public.bookmarks ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.bookmarks ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private';
ALTER TABLE public.bookmarks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS moderator_note TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS assigned_to TEXT REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS action_taken TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS target_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS target_snapshot JSONB;
CREATE INDEX IF NOT EXISTS idx_reports_reporter_created ON public.reports(reporter_id, created_at DESC);
ALTER TABLE public.premium_orders ADD COLUMN IF NOT EXISTS provider_event_id TEXT;

CREATE TABLE IF NOT EXISTS public.contests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  theme TEXT NOT NULL,
  description TEXT,
  rules TEXT,
  prize TEXT,
  starts_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT DEFAULT 'active',
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.contest_submissions (
  id TEXT PRIMARY KEY,
  contest_id TEXT NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  novel_id TEXT REFERENCES public.novels(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  synopsis TEXT,
  content_url TEXT,
  status TEXT DEFAULT 'submitted',
  score INTEGER DEFAULT 0,
  judge_note TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(contest_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.star_transactions (
  id TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  to_user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  novel_id TEXT REFERENCES public.novels(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE OR REPLACE FUNCTION increment_chapter_views(row_id TEXT)
RETURNS void AS $$
BEGIN
  UPDATE public.chapters
  SET views_count = COALESCE(views_count, 0) + 1
  WHERE id = row_id;
END;
$$ LANGUAGE plpgsql;
