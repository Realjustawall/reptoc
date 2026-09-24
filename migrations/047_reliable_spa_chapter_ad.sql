BEGIN;

-- The global MultiTag initializes at document load and does not reliably
-- create a new impression after client-side chapter navigation. Enable the
-- existing React-managed rectangle at chapter.start so every chapter mount
-- gets a provider instance without duplicating the approved tag on the page.
WITH enabled_unit AS (
  UPDATE public.ad_units
     SET enabled = true,
         desktop_enabled = true,
         mobile_enabled = true,
         updated_at = timezone('utc'::text, now())
   WHERE id = 'ad-unit-adsterra-rectangle-300x250'
     AND (enabled, desktop_enabled, mobile_enabled) IS DISTINCT FROM (true, true, true)
  RETURNING id
), enabled_placement AS (
  UPDATE public.ad_placements
     SET enabled = true,
         desktop_enabled = true,
         mobile_enabled = true,
         slot = 'chapter.start',
         default_slot = 'chapter.start',
         custom_settings = '{"strategy":"before-content"}'::jsonb,
         updated_at = timezone('utc'::text, now())
   WHERE id = 'ad-placement-chapter-start'
     AND (
       enabled,
       desktop_enabled,
       mobile_enabled,
       slot,
       default_slot,
       custom_settings
     ) IS DISTINCT FROM (
       true,
       true,
       true,
       'chapter.start',
       'chapter.start',
       '{"strategy":"before-content"}'::jsonb
     )
  RETURNING id
), disabled_duplicates AS (
  UPDATE public.ad_placements
     SET enabled = false,
         updated_at = timezone('utc'::text, now())
   WHERE id IN ('ad-placement-chapter-middle', 'ad-placement-chapter-end')
     AND enabled = true
  RETURNING id
)
UPDATE public.ad_settings
   SET config_version = config_version + 1,
       updated_at = timezone('utc'::text, now())
 WHERE id = 'global'
   AND (
     EXISTS (SELECT 1 FROM enabled_unit)
     OR EXISTS (SELECT 1 FROM enabled_placement)
     OR EXISTS (SELECT 1 FROM disabled_duplicates)
   );

COMMIT;
