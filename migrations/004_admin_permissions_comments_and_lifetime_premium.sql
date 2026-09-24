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
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS assigned_to TEXT REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
