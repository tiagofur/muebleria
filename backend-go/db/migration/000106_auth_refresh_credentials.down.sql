DELETE FROM rls_policy_inventory WHERE table_name IN ('auth_refresh_credentials', 'auth_refresh_families');
DROP TABLE IF EXISTS auth_refresh_credentials;
DROP TABLE IF EXISTS auth_refresh_families;
ALTER TABLE auth_sessions DROP CONSTRAINT IF EXISTS auth_sessions_id_user_absolute_key;
