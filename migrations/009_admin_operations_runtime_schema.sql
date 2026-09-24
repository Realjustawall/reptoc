-- Admin, achievements, and operations schema used by runtime routes.
-- Run this migration with the table owner role; the app runtime user may not
-- have permission to ALTER existing tables in production.

CREATE TABLE IF NOT EXISTS public.custom_roles (
  id TEXT PRIMARY KEY DEFAULT ('role-' || md5(random()::text || clock_timestamp()::text)),
  name TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  permissions JSONB DEFAULT '[]'::jsonb,
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_permissions (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  role_id TEXT REFERENCES public.custom_roles(id) ON DELETE SET NULL,
  permissions JSONB DEFAULT '[]'::jsonb,
  is_staff BOOLEAN DEFAULT false,
  updated_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.content_moderation_scans (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  novel_id TEXT,
  chapter_id TEXT,
  scanner_id TEXT,
  risk_score INTEGER DEFAULT 0,
  nsfw_score INTEGER DEFAULT 0,
  violence_score INTEGER DEFAULT 0,
  ai_score INTEGER DEFAULT 0,
  plagiarism_score INTEGER DEFAULT 0,
  profanity_score INTEGER DEFAULT 0,
  warning_mismatch_score INTEGER DEFAULT 0,
  quality_score INTEGER DEFAULT 100,
  flags JSONB DEFAULT '[]'::jsonb,
  summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.editor_assignments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  novel_id TEXT REFERENCES public.novels(id) ON DELETE CASCADE,
  chapter_id TEXT REFERENCES public.chapters(id) ON DELETE CASCADE,
  editor_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assigned_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'assigned',
  due_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (target_type, target_id, editor_id)
);

CREATE TABLE IF NOT EXISTS public.editor_inline_comments (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  anchor_text TEXT,
  start_offset INTEGER DEFAULT 0,
  end_offset INTEGER DEFAULT 0,
  comment TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  thread_id TEXT,
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.editor_review_checklists (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  reviewer_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  checklist JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'in_review',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (chapter_id, reviewer_id)
);

CREATE TABLE IF NOT EXISTS public.editor_threads (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  chapter_id TEXT REFERENCES public.chapters(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.editor_thread_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES public.editor_threads(id) ON DELETE CASCADE,
  sender_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ticket_internal_notes (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.backup_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  frequency TEXT DEFAULT 'daily',
  enabled BOOLEAN DEFAULT true,
  last_run_at TIMESTAMP WITH TIME ZONE,
  next_run_at TIMESTAMP WITH TIME ZONE,
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS custom_role_id TEXT REFERENCES public.custom_roles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_staff BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS publishing_blocked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS premium_lifetime BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_author BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_role BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS profile_bio TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS notify_comments BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_followers BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_likes BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_bookmarks BOOLEAN DEFAULT true;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'visible',
  ADD COLUMN IF NOT EXISTS moderator_note TEXT;

ALTER TABLE public.chapter_comments
  ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'visible',
  ADD COLUMN IF NOT EXISTS moderator_note TEXT;

ALTER TABLE public.forum_threads
  ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'visible',
  ADD COLUMN IF NOT EXISTS moderator_note TEXT;

ALTER TABLE public.chapters
  ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'visible',
  ADD COLUMN IF NOT EXISTS editor_checklist JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS editorial_status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS assigned_editor_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_due_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS approved_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS assigned_to TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

ALTER TABLE public.editor_messages
  ADD COLUMN IF NOT EXISTS thread_id TEXT;

CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON public.user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement ON public.user_achievements(achievement_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_username_created ON public.notifications(username, created_at DESC);
