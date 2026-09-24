BEGIN;

-- The homepage must show a single banner. The secondary mobile placement in
-- the same slot renders an empty frame on devices where both rows activate,
-- so retire it (the deduped renderer already ignores it as of now).
WITH disabled AS (
  UPDATE public.ad_placements
     SET enabled = false,
         updated_at = timezone('utc'::text, now())
   WHERE id IN ('ad-placement-homepage-mobile', 'ad-placement-homepage-default')
     AND is_builtin = true
     AND enabled = true
     AND id <> 'ad-placement-homepage-default'
  RETURNING id
)
UPDATE public.ad_settings
   SET config_version = config_version + 1,
       updated_at = timezone('utc'::text, now())
 WHERE id = 'global'
   AND EXISTS (SELECT 1 FROM disabled);

COMMIT;
