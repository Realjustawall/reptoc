-- Preserve moderation/content history while allowing an administrator to remove an account.
ALTER TABLE chapters DROP CONSTRAINT IF EXISTS chapters_approved_by_fkey;
ALTER TABLE chapters ADD CONSTRAINT chapters_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE novels DROP CONSTRAINT IF EXISTS novels_approved_by_fkey;
ALTER TABLE novels ADD CONSTRAINT novels_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE forum_posts DROP CONSTRAINT IF EXISTS forum_posts_author_id_fkey;
ALTER TABLE forum_posts ADD CONSTRAINT forum_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE forum_posts DROP CONSTRAINT IF EXISTS forum_posts_user_id_fkey;
ALTER TABLE forum_posts ADD CONSTRAINT forum_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE forum_threads DROP CONSTRAINT IF EXISTS forum_threads_author_id_fkey;
ALTER TABLE forum_threads ADD CONSTRAINT forum_threads_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE forum_threads DROP CONSTRAINT IF EXISTS forum_threads_user_id_fkey;
ALTER TABLE forum_threads ADD CONSTRAINT forum_threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Premium audit rows are immutable evidence and must survive account deletion. Keep the
-- recorded user ID as historical text rather than cascading or deleting the audit row.
ALTER TABLE premium_entitlement_audit DROP CONSTRAINT IF EXISTS premium_entitlement_audit_user_id_fkey;
ALTER TABLE premium_entitlement_audit DROP CONSTRAINT IF EXISTS premium_entitlement_audit_performing_admin_id_fkey;
