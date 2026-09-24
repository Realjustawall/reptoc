BEGIN;

-- Adsterra advises publishers not to place the same banner code more than once
-- on a page. Reptoc currently owns one approved 300x250 provider placement,
-- so retain the guaranteed chapter-start instance and disable its duplicates.
WITH disabled_duplicates AS (
  UPDATE public.ad_placements
     SET enabled = false,
         updated_at = timezone('utc'::text, now())
   WHERE id IN ('ad-placement-chapter-middle', 'ad-placement-chapter-end')
     AND is_builtin = true
     AND enabled = true
  RETURNING id
)
UPDATE public.ad_settings
   SET config_version = config_version + 1,
       updated_at = timezone('utc'::text, now())
 WHERE id = 'global'
   AND EXISTS (SELECT 1 FROM disabled_duplicates);

COMMIT;
