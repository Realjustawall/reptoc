BEGIN;

-- Keep the supplied 300×250 tag isolated to chapter pages. The homepage and
-- novel overview retain their existing fixed-banner units.
WITH upserted_unit AS (
  INSERT INTO public.ad_units
    (id, name, provider, format, width, height, code, enabled,
     desktop_enabled, mobile_enabled, is_builtin)
  VALUES
    (
      'ad-unit-adsterra-chapter-rectangle-300x250',
      'Adsterra Chapter Rectangle 300×250',
      'Adsterra',
      'iframe',
      300,
      250,
$chapter_rectangle$<script>
(function(zvcgloa){
var d = document,
    s = d.createElement('script'),
    l = d.scripts[d.scripts.length - 1];
s.settings = zvcgloa || {};
s.src = "//untimely-hello.com/bmXgV.sZdxGVl/0/YRWfcl/EePmi9pueZ_U_lQkAPVTpcSypNdzbIky/OMDEkVt/NuzdIL3CMMjfIw5MMOwU";
s.async = true;
s.referrerPolicy = 'no-referrer-when-downgrade';
l.parentNode.insertBefore(s, l);
})({})
</script>$chapter_rectangle$,
      true,
      true,
      true,
      true
    )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    provider = EXCLUDED.provider,
    format = EXCLUDED.format,
    width = EXCLUDED.width,
    height = EXCLUDED.height,
    code = EXCLUDED.code,
    enabled = true,
    desktop_enabled = true,
    mobile_enabled = true,
    is_builtin = true,
    updated_at = timezone('utc'::text, now())
  WHERE (public.ad_units.name, public.ad_units.provider, public.ad_units.format,
         public.ad_units.width, public.ad_units.height, public.ad_units.code,
         public.ad_units.enabled, public.ad_units.desktop_enabled,
         public.ad_units.mobile_enabled, public.ad_units.is_builtin)
        IS DISTINCT FROM
        (EXCLUDED.name, EXCLUDED.provider, EXCLUDED.format,
         EXCLUDED.width, EXCLUDED.height, EXCLUDED.code,
         true, true, true, true)
  RETURNING id
), updated_start_placement AS (
  UPDATE public.ad_placements
     SET ad_unit_id = 'ad-unit-adsterra-chapter-rectangle-300x250',
         slot = 'chapter.start',
         default_slot = 'chapter.start',
         custom_settings = '{"strategy":"before-content"}'::jsonb,
         enabled = true,
         desktop_enabled = true,
         mobile_enabled = true,
         updated_at = timezone('utc'::text, now())
   WHERE id = 'ad-placement-chapter-start'
     AND (ad_unit_id, slot, default_slot, custom_settings, enabled,
          desktop_enabled, mobile_enabled)
         IS DISTINCT FROM
         ('ad-unit-adsterra-chapter-rectangle-300x250', 'chapter.start',
          'chapter.start', '{"strategy":"before-content"}'::jsonb,
          true, true, true)
  RETURNING id
), updated_optional_placements AS (
  UPDATE public.ad_placements
     SET ad_unit_id = 'ad-unit-adsterra-chapter-rectangle-300x250',
         enabled = false,
         updated_at = timezone('utc'::text, now())
   WHERE id IN ('ad-placement-chapter-middle', 'ad-placement-chapter-end')
     AND (ad_unit_id, enabled)
         IS DISTINCT FROM ('ad-unit-adsterra-chapter-rectangle-300x250', false)
  RETURNING id
)
UPDATE public.ad_settings
   SET config_version = config_version + 1,
       updated_at = timezone('utc'::text, now())
 WHERE id = 'global'
   AND (
     EXISTS (SELECT 1 FROM upserted_unit)
     OR EXISTS (SELECT 1 FROM updated_start_placement)
     OR EXISTS (SELECT 1 FROM updated_optional_placements)
   );

COMMIT;
