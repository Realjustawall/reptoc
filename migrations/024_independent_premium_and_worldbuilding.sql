CREATE TABLE IF NOT EXISTS public.user_premium_entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  premium_type TEXT NOT NULL CHECK (premium_type IN ('reader','writer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('scheduled','active','paused','expired','revoked','cancelled')),
  source TEXT NOT NULL DEFAULT 'admin_grant' CHECK (source IN ('paid_subscription','admin_grant','promotion','trial','gift','migration','support_compensation','other')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ,
  is_permanent BOOLEAN NOT NULL DEFAULT false, is_paused BOOLEAN NOT NULL DEFAULT false,
  paused_at TIMESTAMPTZ, remaining_duration_at_pause BIGINT,
  auto_renew BOOLEAN NOT NULL DEFAULT false, payment_subscription_id TEXT,
  granted_by_admin_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  revoked_by_admin_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ,
  internal_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT premium_permanent_has_no_expiry CHECK (NOT is_permanent OR expires_at IS NULL),
  CONSTRAINT premium_temporary_has_expiry CHECK (is_permanent OR expires_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_premium_effective ON public.user_premium_entitlements(user_id,premium_type,status,starts_at,expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_premium_payment_source ON public.user_premium_entitlements(payment_subscription_id,premium_type) WHERE payment_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.premium_entitlement_audit (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  entitlement_id TEXT, premium_type TEXT NOT NULL CHECK (premium_type IN ('reader','writer')),
  previous_state JSONB, new_state JSONB, action_type TEXT NOT NULL,
  duration_delta_seconds BIGINT, previous_expires_at TIMESTAMPTZ, new_expires_at TIMESTAMPTZ,
  performing_admin_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), internal_reason TEXT, correlation_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_premium_audit_user ON public.premium_entitlement_audit(user_id,occurred_at DESC);
CREATE OR REPLACE FUNCTION prevent_premium_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'premium audit history is immutable'; END $$;
DROP TRIGGER IF EXISTS premium_audit_immutable ON public.premium_entitlement_audit;
CREATE TRIGGER premium_audit_immutable BEFORE UPDATE OR DELETE ON public.premium_entitlement_audit FOR EACH ROW EXECUTE FUNCTION prevent_premium_audit_mutation();

CREATE TABLE IF NOT EXISTS public.worldbuilding_resources (
  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('node','map','pin','lore','artifact','power_system','timeline','timeline_event','relationship','tag','settings')),
  parent_id TEXT, name TEXT NOT NULL DEFAULT '', subtype TEXT, description TEXT,
  visibility TEXT NOT NULL DEFAULT 'draft' CHECK (visibility IN ('draft','published','private','unlisted')),
  publication_status TEXT NOT NULL DEFAULT 'draft' CHECK (publication_status IN ('draft','published')),
  display_order INTEGER NOT NULL DEFAULT 0, data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL, updated_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(novel_id,id)
);
CREATE INDEX IF NOT EXISTS idx_worldbuilding_novel_type ON public.worldbuilding_resources(novel_id,resource_type,visibility,display_order);
CREATE TABLE IF NOT EXISTS public.worldbuilding_revisions (
  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES public.worldbuilding_resources(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, snapshot JSONB NOT NULL, created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(resource_id,revision)
);

-- Preserve the existing Reader Premium contract as an independent migration source.
INSERT INTO public.user_premium_entitlements(id,user_id,premium_type,status,source,starts_at,expires_at,is_permanent,internal_note)
SELECT 'migration-reader-' || id,id,'reader','active','migration',COALESCE(created_at,now()),CASE WHEN premium_lifetime THEN NULL ELSE premium_until END,COALESCE(premium_lifetime,false),'Migrated from legacy Reader Premium'
FROM public.users WHERE is_premium=true AND (premium_lifetime=true OR premium_until>now())
ON CONFLICT (id) DO NOTHING;
