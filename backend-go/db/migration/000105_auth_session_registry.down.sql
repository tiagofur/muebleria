-- #460 / SEC-1: remove the session registry (rollback slice).
-- memberships_id_user_key is ours to remove; memberships_id_organization_key
-- belongs to 000097 (membership_sectors depends on it) and is only reused.
DELETE FROM rls_policy_inventory WHERE table_name = 'auth_sessions';
DROP TABLE IF EXISTS auth_sessions;
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_id_user_key;
