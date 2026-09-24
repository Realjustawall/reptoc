ALTER TABLE public.premium_orders ADD COLUMN IF NOT EXISTS premium_type TEXT NOT NULL DEFAULT 'reader' CHECK (premium_type IN ('reader','writer'));
