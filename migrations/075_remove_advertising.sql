BEGIN;

-- Advertising was removed platform-wide. Drop the advertisement tables and the
-- dead `ad_*` entries in system settings.
--
-- These tables only ever held provider snippets and placement bookkeeping, so
-- there is no user content to preserve.
DROP TABLE IF EXISTS public.ad_placements;
DROP TABLE IF EXISTS public.ad_units;
DROP TABLE IF EXISTS public.ad_settings;

-- System settings is a single JSON document; strip every advertising key.
UPDATE public.settings
   SET setting_value = (
     SELECT COALESCE(jsonb_object_agg(entry.key, entry.value)::text, '{}')
       FROM jsonb_each(setting_value::jsonb) AS entry
      WHERE entry.key NOT LIKE 'ad\_%'
   )
 WHERE setting_key = 'systemSettings'
   AND setting_value IS NOT NULL
   AND jsonb_typeof(setting_value::jsonb) = 'object'
   AND EXISTS (
     SELECT 1 FROM jsonb_each(setting_value::jsonb) AS entry
      WHERE entry.key LIKE 'ad\_%'
   );

COMMIT;
