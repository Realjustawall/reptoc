BEGIN;

-- Novel origin tracking: an original story vs a translated one.
ALTER TABLE public.novels ADD COLUMN IF NOT EXISTS origin_type TEXT NOT NULL DEFAULT 'original';
ALTER TABLE public.novels ADD COLUMN IF NOT EXISTS original_author TEXT NOT NULL DEFAULT '';
ALTER TABLE public.novels ADD COLUMN IF NOT EXISTS translators JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'novels_origin_type_check'
  ) THEN
    ALTER TABLE public.novels
      ADD CONSTRAINT novels_origin_type_check CHECK (origin_type IN ('original', 'translated'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_novels_origin_type ON public.novels (origin_type);

COMMIT;
