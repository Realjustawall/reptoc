BEGIN;

-- Zone 11432701 is loaded once from the document head. Keep the old fixed
-- banner records available to administrators, but do not run two providers or
-- reserve empty Adsterra rectangles while Monetag MultiTag is active.
WITH disabled_placements AS (
  UPDATE public.ad_placements
     SET enabled = false,
         updated_at = timezone('utc'::text, now())
   WHERE enabled = true
     AND ad_unit_id IN (
       'ad-unit-adsterra-rectangle-300x250',
       'ad-unit-adsterra-leaderboard-728x90'
     )
  RETURNING id
), disabled_units AS (
  UPDATE public.ad_units
     SET enabled = false,
         updated_at = timezone('utc'::text, now())
   WHERE enabled = true
     AND id IN (
       'ad-unit-adsterra-rectangle-300x250',
       'ad-unit-adsterra-leaderboard-728x90'
     )
  RETURNING id
)
UPDATE public.ad_settings
   SET config_version = config_version + 1,
       updated_at = timezone('utc'::text, now())
 WHERE id = 'global'
   AND (
     EXISTS (SELECT 1 FROM disabled_placements)
     OR EXISTS (SELECT 1 FROM disabled_units)
   );

COMMIT;
