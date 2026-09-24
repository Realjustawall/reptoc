BEGIN;

LOCK TABLE public.chapter_likes IN SHARE ROW EXCLUSIVE MODE;

-- Keep the earliest row if an installation ever accepted duplicate likes
-- before the composite uniqueness rule was present.
WITH ranked_likes AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, chapter_id
           ORDER BY created_at, id
         ) AS duplicate_number
  FROM public.chapter_likes
)
DELETE FROM public.chapter_likes likes
USING ranked_likes ranked
WHERE likes.id = ranked.id
  AND ranked.duplicate_number > 1;

-- Repair legacy installations that accidentally constrained a user to one
-- chapter like total. Composite constraints and indexes are left untouched.
DO $$
DECLARE
  constraint_record RECORD;
  index_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT constraint_row.conname
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.chapter_likes'::regclass
      AND constraint_row.contype = 'u'
      AND (
        SELECT array_agg(attribute_row.attname ORDER BY key_row.ordinality)
        FROM unnest(constraint_row.conkey) WITH ORDINALITY key_row(attnum, ordinality)
        JOIN pg_attribute attribute_row
          ON attribute_row.attrelid = constraint_row.conrelid
         AND attribute_row.attnum = key_row.attnum
      ) = ARRAY['user_id']::name[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.chapter_likes DROP CONSTRAINT %I',
      constraint_record.conname
    );
  END LOOP;

  FOR index_record IN
    SELECT index_namespace.nspname AS schema_name,
           index_class.relname AS index_name
    FROM pg_index index_row
    JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
    JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
    WHERE index_row.indrelid = 'public.chapter_likes'::regclass
      AND index_row.indisunique
      AND NOT index_row.indisprimary
      AND (
        SELECT array_agg(attribute_row.attname ORDER BY key_row.ordinality)
        FROM unnest(index_row.indkey) WITH ORDINALITY key_row(attnum, ordinality)
        JOIN pg_attribute attribute_row
          ON attribute_row.attrelid = index_row.indrelid
         AND attribute_row.attnum = key_row.attnum
      ) = ARRAY['user_id']::name[]
  LOOP
    EXECUTE format(
      'DROP INDEX %I.%I',
      index_record.schema_name,
      index_record.index_name
    );
  END LOOP;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index index_row
    WHERE index_row.indrelid = 'public.chapter_likes'::regclass
      AND index_row.indisunique
      AND (
        SELECT array_agg(attribute_row.attname ORDER BY attribute_row.attname)
        FROM unnest(index_row.indkey) key_row(attnum)
        JOIN pg_attribute attribute_row
          ON attribute_row.attrelid = index_row.indrelid
         AND attribute_row.attnum = key_row.attnum
      ) = ARRAY['chapter_id', 'user_id']::name[]
  ) THEN
    CREATE UNIQUE INDEX chapter_likes_user_chapter_unique
      ON public.chapter_likes(user_id, chapter_id);
  END IF;
END
$$;

COMMIT;
