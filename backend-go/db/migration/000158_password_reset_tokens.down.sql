DROP FUNCTION IF EXISTS app_revoke_user_auth_sessions(UUID, TEXT);
DROP FUNCTION IF EXISTS consume_password_reset_token(UUID, TEXT);
DROP FUNCTION IF EXISTS lock_password_reset_token_by_hash(TEXT);
DROP FUNCTION IF EXISTS issue_password_reset_token(UUID, TEXT, TEXT, UUID, TIMESTAMPTZ, TEXT, TEXT);
DELETE FROM rls_policy_inventory WHERE table_name = 'password_reset_tokens';
DROP TABLE IF EXISTS password_reset_tokens;
