BEGIN;

-- Adsterra banner tags use fixed dimensions. Keep the approved leaderboard on
-- desktop and use the approved rectangle in the same homepage slot on mobile.
WITH desired_placements (
  id, placement_key, page_type, slot, ad_unit_id, enabled,
  desktop_enabled, mobile_enabled, sort_order, default_slot, custom_settings
) AS (
  VALUES
    (
      'ad-placement-homepage-default',
      'homepage.between-library-and-statistics',
      'homepage',
      'homepage.between-library-and-statistics',
      'ad-unit-adsterra-leaderboard-728x90',
      true, true, false, 10,
      'homepage.between-library-and-statistics',
      '{"strategy":"between-sections"}'::jsonb
    ),
    (
      'ad-placement-homepage-mobile',
      'homepage.mobile-between-library-and-statistics',
      'homepage',
      'homepage.between-library-and-statistics',
      'ad-unit-adsterra-rectangle-300x250',
      true, false, true, 20,
      'homepage.between-library-and-statistics',
      '{"strategy":"between-sections"}'::jsonb
    )
), changed_placements AS (
  INSERT INTO public.ad_placements (
    id, placement_key, page_type, slot, ad_unit_id, enabled,
    desktop_enabled, mobile_enabled, sort_order, default_slot,
    custom_settings, is_builtin
  )
  SELECT
    id, placement_key, page_type, slot, ad_unit_id, enabled,
    desktop_enabled, mobile_enabled, sort_order, default_slot,
    custom_settings, true
  FROM desired_placements
  ON CONFLICT (id) DO UPDATE SET
    placement_key = EXCLUDED.placement_key,
    page_type = EXCLUDED.page_type,
    slot = EXCLUDED.slot,
    ad_unit_id = EXCLUDED.ad_unit_id,
    enabled = EXCLUDED.enabled,
    desktop_enabled = EXCLUDED.desktop_enabled,
    mobile_enabled = EXCLUDED.mobile_enabled,
    sort_order = EXCLUDED.sort_order,
    default_slot = EXCLUDED.default_slot,
    custom_settings = EXCLUDED.custom_settings,
    is_builtin = true,
    updated_at = timezone('utc'::text, now())
  WHERE public.ad_placements.is_builtin = true
    AND (
      public.ad_placements.placement_key,
      public.ad_placements.page_type,
      public.ad_placements.slot,
      public.ad_placements.ad_unit_id,
      public.ad_placements.enabled,
      public.ad_placements.desktop_enabled,
      public.ad_placements.mobile_enabled,
      public.ad_placements.sort_order,
      public.ad_placements.default_slot,
      public.ad_placements.custom_settings
    ) IS DISTINCT FROM (
      EXCLUDED.placement_key,
      EXCLUDED.page_type,
      EXCLUDED.slot,
      EXCLUDED.ad_unit_id,
      EXCLUDED.enabled,
      EXCLUDED.desktop_enabled,
      EXCLUDED.mobile_enabled,
      EXCLUDED.sort_order,
      EXCLUDED.default_slot,
      EXCLUDED.custom_settings
    )
  RETURNING id
)
UPDATE public.ad_settings
   SET config_version = config_version + 1,
       updated_at = timezone('utc'::text, now())
 WHERE id = 'global'
   AND EXISTS (SELECT 1 FROM changed_placements);

COMMIT;
