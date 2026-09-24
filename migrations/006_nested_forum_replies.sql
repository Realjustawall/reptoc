-- Add support for nested forum replies
ALTER TABLE IF EXISTS public.forum_posts 
ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES public.forum_posts(id) ON DELETE CASCADE;

-- Add index for efficient thread reply querying
CREATE INDEX IF NOT EXISTS idx_forum_posts_parent_id ON public.forum_posts(parent_id);

-- Add depth column to help with query optimization and UI rendering limits
ALTER TABLE IF EXISTS public.forum_posts 
ADD COLUMN IF NOT EXISTS reply_depth INTEGER DEFAULT 0;
