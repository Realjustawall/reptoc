BEGIN;

ALTER TABLE IF EXISTS public.user_achievements
  ALTER COLUMN id SET DEFAULT md5(random()::text || clock_timestamp()::text);

ALTER TABLE public.novels
  ADD COLUMN IF NOT EXISTS premium_presentation JSONB
  NOT NULL DEFAULT '{"enabled":false,"templateId":"royal"}'::jsonb;

CREATE TABLE IF NOT EXISTS public.chapter_paragraphs (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  fingerprint TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_chapter_paragraphs_active
  ON public.chapter_paragraphs(chapter_id, ordinal)
  WHERE deleted_at IS NULL;

ALTER TABLE public.chapter_comments
  ADD COLUMN IF NOT EXISTS paragraph_id TEXT REFERENCES public.chapter_paragraphs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'visible';

CREATE INDEX IF NOT EXISTS idx_chapter_comments_paragraph_page
  ON public.chapter_comments(chapter_id, paragraph_id, created_at, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chapter_comments_parent
  ON public.chapter_comments(parent_id)
  WHERE parent_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.premium_orders
  ADD COLUMN IF NOT EXISTS account_reference_hash TEXT;

ALTER TABLE public.premium_orders
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.premium_orders
  DROP CONSTRAINT IF EXISTS premium_orders_user_id_fkey;

ALTER TABLE public.premium_orders
  ADD CONSTRAINT premium_orders_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_premium_orders_account_reference_hash
  ON public.premium_orders(account_reference_hash)
  WHERE account_reference_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.account_deletion_audit (
  id TEXT PRIMARY KEY,
  account_reference_hash TEXT NOT NULL,
  deleted_novels INTEGER NOT NULL DEFAULT 0,
  deleted_chapters INTEGER NOT NULL DEFAULT 0,
  deleted_comments INTEGER NOT NULL DEFAULT 0,
  detached_financial_records INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Keep the administrator-managed taxonomy record aligned with the canonical
-- application contract without removing or rewriting any existing warnings.
DO $$
DECLARE
  settings_doc JSONB;
  warnings_doc JSONB;
BEGIN
  SELECT setting_value::jsonb INTO settings_doc
  FROM public.settings
  WHERE setting_key = 'systemSettings'
    AND setting_value IS NOT NULL
    AND setting_value ~ '^\s*\{';

  IF settings_doc IS NOT NULL THEN
    warnings_doc := COALESCE(settings_doc -> 'contentWarnings', '[]'::jsonb);
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(warnings_doc) item
      WHERE lower(COALESCE(item ->> 'id', item ->> 'label', trim(both '"' from item::text))) IN ('dark_themes', 'dark themes')
    ) THEN
      warnings_doc := warnings_doc || jsonb_build_array(jsonb_build_object(
        'id', 'dark_themes',
        'label', 'Dark Themes',
        'desc', 'Sustained exploration of disturbing, bleak, or psychologically intense themes.'
      ));
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(warnings_doc) item
      WHERE lower(COALESCE(item ->> 'id', item ->> 'label', trim(both '"' from item::text))) IN ('tragic_elements', 'tragic elements')
    ) THEN
      warnings_doc := warnings_doc || jsonb_build_array(jsonb_build_object(
        'id', 'tragic_elements',
        'label', 'Tragic Elements',
        'desc', 'Themes or events involving major loss, grief, or tragedy.'
      ));
    END IF;
    UPDATE public.settings
    SET setting_value = jsonb_set(settings_doc, '{contentWarnings}', warnings_doc, true)::text
    WHERE setting_key = 'systemSettings';
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Content-warning settings backfill skipped: %', SQLERRM;
END $$;

COMMIT;
