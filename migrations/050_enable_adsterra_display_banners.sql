BEGIN;

-- Monetag In-Page Push is a separate global format. Re-enable the approved
-- Adsterra display units so the visible fixed banners are real provider loads
-- and can produce Adsterra impressions. Keep one banner per route and one
-- approved size per homepage viewport.
WITH enabled_units AS (
  UPDATE public.ad_units
     SET enabled = true,
         desktop_enabled = true,
         mobile_enabled = true,
         updated_at = timezone('utc'::text, now())
   WHERE id IN (
       'ad-unit-adsterra-rectangle-300x250',
       'ad-unit-adsterra-leaderboard-728x90'
     )
     AND (enabled, desktop_enabled, mobile_enabled)
         IS DISTINCT FROM (true, true, true)
  RETURNING id
), enabled_placements AS (
  UPDATE public.ad_placements
     SET enabled = true,
         updated_at = timezone('utc'::text, now())
   WHERE id IN (
       'ad-placement-homepage-default',
       'ad-placement-homepage-mobile',
       'ad-placement-novel-default',
       'ad-placement-chapter-start'
     )
     AND enabled = false
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
     EXISTS (SELECT 1 FROM enabled_units)
     OR EXISTS (SELECT 1 FROM enabled_placements)
     OR EXISTS (SELECT 1 FROM disabled_duplicates)
   );

COMMIT;
