BEGIN;

-- Administrator-managed events.
--
-- Events used to be a hard-coded constant in the source, so an owner could not
-- create, edit or retire one without a deployment. They are rows now, and every
-- event carries its own banner so the promotional artwork is editable too.
CREATE TABLE IF NOT EXISTS public.site_events (
  id TEXT PRIMARY KEY,
  -- Public URL segment. Stable, because notification links embed it.
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- 'views_leaderboard' ranks novels by verified event views; 'announcement' is
  -- banner-only, with no leaderboard.
  kind TEXT NOT NULL DEFAULT 'views_leaderboard',
  status TEXT NOT NULL DEFAULT 'draft',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  timezone_label TEXT NOT NULL DEFAULT 'UTC',
  date_label TEXT NOT NULL DEFAULT '',
  -- Banner presentation. `banner_url` is a Reptoc-hosted upload or an HTTPS URL;
  -- the text fields let an owner restyle the banner without a new image.
  banner_url TEXT NOT NULL DEFAULT '',
  banner_alt TEXT NOT NULL DEFAULT '',
  banner_headline TEXT NOT NULL DEFAULT '',
  banner_subheadline TEXT NOT NULL DEFAULT '',
  banner_cta_label TEXT NOT NULL DEFAULT '',
  banner_cta_href TEXT NOT NULL DEFAULT '',
  banner_theme TEXT NOT NULL DEFAULT 'violet',
  -- At most one event is featured on the home page; enforced by the partial
  -- unique index below.
  is_featured BOOLEAN NOT NULL DEFAULT false,
  excluded_author_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_events_kind_check') THEN
    ALTER TABLE public.site_events
      ADD CONSTRAINT site_events_kind_check CHECK (kind IN ('views_leaderboard', 'announcement'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_events_status_check') THEN
    ALTER TABLE public.site_events
      ADD CONSTRAINT site_events_status_check CHECK (status IN ('draft', 'published', 'archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_events_window_check') THEN
    ALTER TABLE public.site_events
      ADD CONSTRAINT site_events_window_check CHECK (ends_at > starts_at);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_site_events_status_window
  ON public.site_events (status, starts_at, ends_at);

-- Only one event may occupy the home-page banner slot at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_events_single_featured
  ON public.site_events ((is_featured))
  WHERE is_featured = true;

-- Seed the event that was previously hard-coded, so existing recorded views in
-- novel_event_views keep resolving to a real row and the public page is
-- unchanged for readers.
INSERT INTO public.site_events (
  id, slug, title, description, kind, status,
  starts_at, ends_at, timezone_label, date_label,
  banner_headline, banner_subheadline, banner_theme,
  is_featured, excluded_author_names
) VALUES (
  'august-views-2026',
  'august-views-2026',
  'رویداد بازدیدهای اوت رپتوک ۲۰۲۶',
  'پربازدیدترین رمان‌های واجد شرایط در اوت ۲۰۲۶.',
  'views_leaderboard',
  'published',
  '2026-08-01T00:00:00.000Z',
  '2026-09-01T00:00:00.000Z',
  'UTC',
  '۱ تا ۳۱ اوت ۲۰۲۶',
  'رویداد بازدیدهای اوت',
  'جدول امتیازها را دنبال کنید.',
  'violet',
  true,
  '["The_BestX", "The_Lite", "Abyss kid"]'::jsonb
) ON CONFLICT (id) DO NOTHING;

COMMIT;
