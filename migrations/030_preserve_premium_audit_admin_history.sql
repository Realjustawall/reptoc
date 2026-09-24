-- Premium audit rows are immutable, including the administrator recorded on them.
-- ON DELETE SET NULL attempts to update those rows when an administrator account is
-- deleted, which is rejected by premium_audit_immutable. Keep the historical ID as
-- text, just as we already do for premium_entitlement_audit.user_id.
ALTER TABLE premium_entitlement_audit
  DROP CONSTRAINT IF EXISTS premium_entitlement_audit_performing_admin_id_fkey;
