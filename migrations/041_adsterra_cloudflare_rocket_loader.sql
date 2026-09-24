BEGIN;

-- Rocket Loader must not change Adsterra's configuration or loader scripts.
-- Update only the factory units and retain their current enable/device settings.
WITH desired_ad_units (id, code) AS (
  VALUES
  (
    'ad-unit-adsterra-rectangle-300x250',
$ad_rectangle$<script data-cfasync="false" type="text/javascript">
  atOptions = {
    'key' : 'bbe88245587892f2be46d4f3714457b2',
    'format' : 'iframe',
    'height' : 250,
    'width' : 300,
    'params' : {}
  };
</script>
<script data-cfasync="false" type="text/javascript" src="https://www.highperformanceformat.com/bbe88245587892f2be46d4f3714457b2/invoke.js"></script>$ad_rectangle$
  ),
  (
    'ad-unit-adsterra-leaderboard-728x90',
$ad_leaderboard$<script data-cfasync="false" type="text/javascript">
  atOptions = {
    'key' : '2f12d1dcc398462d4347af0da92da019',
    'format' : 'iframe',
    'height' : 90,
    'width' : 728,
    'params' : {}
  };
</script>
<script data-cfasync="false" type="text/javascript" src="https://www.highperformanceformat.com/2f12d1dcc398462d4347af0da92da019/invoke.js"></script>$ad_leaderboard$
  )
), updated_ad_units AS (
  UPDATE public.ad_units AS ad_unit
     SET code = desired.code,
         updated_at = timezone('utc'::text, now())
    FROM desired_ad_units AS desired
   WHERE ad_unit.id = desired.id
     AND ad_unit.is_builtin = true
     AND ad_unit.code IS DISTINCT FROM desired.code
  RETURNING ad_unit.id
)
UPDATE public.ad_settings
   SET config_version = config_version + 1,
       updated_at = timezone('utc'::text, now())
 WHERE id = 'global'
   AND EXISTS (SELECT 1 FROM updated_ad_units);

COMMIT;
