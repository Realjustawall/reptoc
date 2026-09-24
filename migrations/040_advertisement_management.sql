BEGIN;

CREATE TABLE IF NOT EXISTS public.ad_settings (
  id TEXT PRIMARY KEY,
  ads_enabled BOOLEAN NOT NULL DEFAULT true,
  test_mode BOOLEAN NOT NULL DEFAULT false,
  lazy_load_enabled BOOLEAN NOT NULL DEFAULT true,
  consent_required BOOLEAN NOT NULL DEFAULT false,
  config_version BIGINT NOT NULL DEFAULT 1 CHECK (config_version > 0),
  updated_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ad_settings_singleton CHECK (id = 'global')
);

CREATE TABLE IF NOT EXISTS public.ad_units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  provider TEXT NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 120),
  format TEXT NOT NULL CHECK (char_length(format) BETWEEN 1 AND 80),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 2000),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 2000),
  code TEXT NOT NULL CHECK (char_length(code) BETWEEN 1 AND 50000),
  enabled BOOLEAN NOT NULL DEFAULT true,
  desktop_enabled BOOLEAN NOT NULL DEFAULT true,
  mobile_enabled BOOLEAN NOT NULL DEFAULT true,
  is_builtin BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.ad_placements (
  id TEXT PRIMARY KEY,
  placement_key TEXT UNIQUE NOT NULL CHECK (placement_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  page_type TEXT NOT NULL CHECK (page_type IN ('homepage', 'novel', 'chapter')),
  slot TEXT NOT NULL CHECK (slot ~ '^(homepage|novel|chapter)\.[a-z][a-z0-9-]{1,79}$'),
  ad_unit_id TEXT NOT NULL REFERENCES public.ad_units(id) ON DELETE RESTRICT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  desktop_enabled BOOLEAN NOT NULL DEFAULT true,
  mobile_enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN -100000 AND 100000),
  default_slot TEXT NOT NULL CHECK (default_slot ~ '^(homepage|novel|chapter)\.[a-z][a-z0-9-]{1,79}$'),
  custom_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_builtin BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS ad_units_active_idx ON public.ad_units (enabled, desktop_enabled, mobile_enabled);
CREATE INDEX IF NOT EXISTS ad_placements_render_idx ON public.ad_placements (page_type, slot, enabled, sort_order, id);
CREATE INDEX IF NOT EXISTS ad_placements_unit_idx ON public.ad_placements (ad_unit_id);

INSERT INTO public.ad_settings (id, ads_enabled, test_mode, lazy_load_enabled, consent_required, config_version)
VALUES ('global', true, false, true, false, 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ad_units (id, name, provider, format, width, height, code, enabled, desktop_enabled, mobile_enabled, is_builtin)
VALUES
(
  'ad-unit-adsterra-rectangle-300x250',
  'Adsterra Rectangle 300×250',
  'Adsterra',
  'iframe',
  300,
  250,
$ad_rectangle$<script data-cfasync="false" type="text/javascript">
  atOptions = {
    'key' : 'bbe88245587892f2be46d4f3714457b2',
    'format' : 'iframe',
    'height' : 250,
    'width' : 300,
    'params' : {}
  };
</script>
<script data-cfasync="false" type="text/javascript" src="https://www.highperformanceformat.com/bbe88245587892f2be46d4f3714457b2/invoke.js"></script>$ad_rectangle$,
  true,
  true,
  true,
  true
),
(
  'ad-unit-adsterra-leaderboard-728x90',
  'Adsterra Leaderboard 728×90',
  'Adsterra',
  'iframe',
  728,
  90,
$ad_leaderboard$<script data-cfasync="false" type="text/javascript">
  atOptions = {
    'key' : '2f12d1dcc398462d4347af0da92da019',
    'format' : 'iframe',
    'height' : 90,
    'width' : 728,
    'params' : {}
  };
</script>
<script data-cfasync="false" type="text/javascript" src="https://www.highperformanceformat.com/2f12d1dcc398462d4347af0da92da019/invoke.js"></script>$ad_leaderboard$,
  true,
  true,
  true,
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ad_placements
  (id, placement_key, page_type, slot, ad_unit_id, enabled, desktop_enabled, mobile_enabled, sort_order, default_slot, custom_settings, is_builtin)
VALUES
  ('ad-placement-homepage-default', 'homepage.between-library-and-statistics', 'homepage', 'homepage.between-library-and-statistics', 'ad-unit-adsterra-leaderboard-728x90', true, true, true, 10, 'homepage.between-library-and-statistics', '{"strategy":"between-sections"}'::jsonb, true),
  ('ad-placement-novel-default', 'novel.between-description-and-characters', 'novel', 'novel.between-description-and-characters', 'ad-unit-adsterra-rectangle-300x250', true, true, true, 10, 'novel.between-description-and-characters', '{"strategy":"between-sections"}'::jsonb, true),
  ('ad-placement-chapter-start', 'chapter.start', 'chapter', 'chapter.start', 'ad-unit-adsterra-rectangle-300x250', true, true, true, 10, 'chapter.start', '{"strategy":"before-content"}'::jsonb, true),
  ('ad-placement-chapter-middle', 'chapter.middle', 'chapter', 'chapter.middle', 'ad-unit-adsterra-rectangle-300x250', true, true, true, 20, 'chapter.middle', '{"strategy":"content-percentage","percentage":50}'::jsonb, true),
  ('ad-placement-chapter-end', 'chapter.end', 'chapter', 'chapter.end', 'ad-unit-adsterra-rectangle-300x250', true, true, true, 30, 'chapter.end', '{"strategy":"after-content"}'::jsonb, true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
