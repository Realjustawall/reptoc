BEGIN;

-- Inbox rows can now deep-link to the exact novel/chapter they refer to.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS link TEXT NOT NULL DEFAULT '';

COMMIT;
