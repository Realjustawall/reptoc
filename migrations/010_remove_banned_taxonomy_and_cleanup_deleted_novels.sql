-- Remove banned taxonomy values from saved settings and existing novels.
-- Run with the table owner role in production.

CREATE OR REPLACE FUNCTION pg_temp.reptoc_taxonomy_text(value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}'
    WHEN jsonb_typeof(value) = 'object' THEN concat_ws(' ', value->>'id', value->>'label', value->>'name', value->>'title')
    ELSE value::text
  END
$$;

CREATE OR REPLACE FUNCTION pg_temp.reptoc_taxonomy_allowed(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NOT (
    regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', ' ', 'g') ~ '(^| )(gay|lesbian|sexual|lgbtq[a-z0-9]*)( |$)'
  )
$$;

CREATE OR REPLACE FUNCTION pg_temp.reptoc_scrub_system_settings(raw_value text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  doc jsonb;
  key_name text;
  cleaned jsonb;
BEGIN
  BEGIN
    doc := raw_value::jsonb;
  EXCEPTION WHEN others THEN
    RETURN raw_value;
  END;

  FOREACH key_name IN ARRAY ARRAY['genres', 'mainCategories', 'subCategories', 'contentWarnings', 'leaderboardTags']
  LOOP
    IF jsonb_typeof(doc -> key_name) = 'array' THEN
      SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
      INTO cleaned
      FROM jsonb_array_elements(doc -> key_name) AS item
      WHERE pg_temp.reptoc_taxonomy_allowed(pg_temp.reptoc_taxonomy_text(item));
      doc := jsonb_set(doc, ARRAY[key_name], cleaned, true);
    END IF;
  END LOOP;

  RETURN doc::text;
END
$$;

DO $$
DECLARE
  target_column text;
  column_type text;
BEGIN
  IF to_regclass('public.settings') IS NOT NULL THEN
    UPDATE public.settings
    SET setting_value = pg_temp.reptoc_scrub_system_settings(setting_value)
    WHERE setting_key = 'systemSettings'
      AND setting_value IS NOT NULL;
  END IF;

  IF to_regclass('public.novels') IS NOT NULL THEN
    FOREACH target_column IN ARRAY ARRAY['tags', 'warnings', 'main_categories', 'sub_categories']
    LOOP
      SELECT data_type
      INTO column_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'novels'
        AND column_name = target_column
      LIMIT 1;

      IF column_type = 'jsonb' THEN
        EXECUTE format($sql$
          UPDATE public.novels
          SET %1$I = COALESCE((
            SELECT jsonb_agg(item)
            FROM jsonb_array_elements(%1$I) AS item
            WHERE pg_temp.reptoc_taxonomy_allowed(pg_temp.reptoc_taxonomy_text(item))
          ), '[]'::jsonb)
          WHERE %1$I IS NOT NULL
            AND jsonb_typeof(%1$I) = 'array'
        $sql$, target_column);
      ELSIF column_type = 'ARRAY' THEN
        EXECUTE format($sql$
          UPDATE public.novels
          SET %1$I = ARRAY(
            SELECT item
            FROM unnest(%1$I) AS item
            WHERE pg_temp.reptoc_taxonomy_allowed(item)
          )
          WHERE %1$I IS NOT NULL
        $sql$, target_column);
      END IF;
    END LOOP;
  END IF;

  IF to_regclass('public.suggestion_novel_vectors') IS NOT NULL THEN
    DELETE FROM public.suggestion_novel_vectors
    WHERE (
      vector::text ~* 'gay|lesbian|sexual|lgbtq'
      OR genre ~* 'gay|lesbian|sexual|lgbtq'
    );
  END IF;
END
$$;
