BEGIN;

-- Use the supplied 300×250 provider tag for the main novel page. Upsert the
-- shared unit as well as its placement so existing and fresh databases receive
-- the exact same script and activation settings.
WITH supplied_unit AS (
  INSERT INTO public.ad_units
    (id, name, provider, format, width, height, code, enabled,
     desktop_enabled, mobile_enabled, is_builtin)
  VALUES
    (
      'ad-unit-adsterra-chapter-end-rectangle-300x250',
      'Adsterra Main/Chapter Rectangle 300×250',
      'Adsterra',
      'iframe',
      300,
      250,
$main_novel_rectangle$<script>
(function(zkr){
var d = document,
    s = d.createElement('script'),
    l = d.scripts[d.scripts.length - 1];
s.settings = zkr || {};
s.src = "//untimely-hello.com/b.X/VcskdIG/lD0cYJWhcf/mefmm9buiZ/UAlckqPhTYcfy_Nqz_IiyTOgD/kGtdNOz/IG3aMqjCI/5WM/wV";
s.async = true;
s.referrerPolicy = 'no-referrer-when-downgrade';
l.parentNode.insertBefore(s, l);
})({})
</script>$main_novel_rectangle$,
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
  WHERE (public.ad_units.name, public.ad_units.provider,
         public.ad_units.format, public.ad_units.width,
         public.ad_units.height, public.ad_units.code,
         public.ad_units.enabled, public.ad_units.desktop_enabled,
         public.ad_units.mobile_enabled, public.ad_units.is_builtin)
        IS DISTINCT FROM
        (EXCLUDED.name, EXCLUDED.provider, EXCLUDED.format,
         EXCLUDED.width, EXCLUDED.height, EXCLUDED.code,
         true, true, true, true)
  RETURNING id
), novel_placement AS (
  INSERT INTO public.ad_placements
    (id, placement_key, page_type, slot, ad_unit_id, enabled,
     desktop_enabled, mobile_enabled, sort_order, default_slot,
     custom_settings, is_builtin)
  VALUES
    (
      'ad-placement-novel-default',
      'novel.between-description-and-characters',
      'novel',
      'novel.between-description-and-characters',
      'ad-unit-adsterra-chapter-end-rectangle-300x250',
      true,
      true,
      true,
      10,
      'novel.between-description-and-characters',
      '{"strategy":"between-sections"}'::jsonb,
      true
    )
  ON CONFLICT (id) DO UPDATE SET
    placement_key = EXCLUDED.placement_key,
    page_type = EXCLUDED.page_type,
    slot = EXCLUDED.slot,
    ad_unit_id = EXCLUDED.ad_unit_id,
    enabled = true,
    desktop_enabled = true,
    mobile_enabled = true,
    sort_order = EXCLUDED.sort_order,
    default_slot = EXCLUDED.default_slot,
    custom_settings = EXCLUDED.custom_settings,
    is_builtin = true,
    updated_at = timezone('utc'::text, now())
  WHERE (public.ad_placements.placement_key,
         public.ad_placements.page_type, public.ad_placements.slot,
         public.ad_placements.ad_unit_id, public.ad_placements.enabled,
         public.ad_placements.desktop_enabled,
         public.ad_placements.mobile_enabled,
         public.ad_placements.sort_order,
         public.ad_placements.default_slot,
         public.ad_placements.custom_settings,
         public.ad_placements.is_builtin)
        IS DISTINCT FROM
        (EXCLUDED.placement_key, EXCLUDED.page_type, EXCLUDED.slot,
         EXCLUDED.ad_unit_id, true, true, true, EXCLUDED.sort_order,
         EXCLUDED.default_slot, EXCLUDED.custom_settings, true)
  RETURNING id
)
UPDATE public.ad_settings
   SET config_version = config_version + 1,
       updated_at = timezone('utc'::text, now())
 WHERE id = 'global'
   AND (
     EXISTS (SELECT 1 FROM supplied_unit)
     OR EXISTS (SELECT 1 FROM novel_placement)
   );

COMMIT;
