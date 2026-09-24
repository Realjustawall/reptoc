BEGIN;

-- Guarantee exactly one (the main chapter-start) banner per chapter page,
-- even if a factory-restore or an unapplied earlier migration re-enabled
-- the duplicate end/middle placements.
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
