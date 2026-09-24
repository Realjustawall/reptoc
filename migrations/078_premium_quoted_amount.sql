BEGIN;

-- Record the price the customer was actually shown.
--
-- Reader and Writer are priced independently and Writer carries a promotion, so
-- the advertised figure can no longer be reconstructed from `plan_months` alone.
-- Storing it makes a later refund or dispute answerable without knowing what the
-- pricing table looked like on the day of purchase.
ALTER TABLE public.premium_orders
  ADD COLUMN IF NOT EXISTS quoted_amount_cents INTEGER;

COMMIT;
