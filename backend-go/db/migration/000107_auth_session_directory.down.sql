DROP FUNCTION IF EXISTS app_revoke_membership_auth_sessions(UUID, UUID, UUID, TEXT, BIGINT);
DROP FUNCTION IF EXISTS app_revoke_platform_auth_session(UUID, UUID, UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS app_revoke_membership_auth_session(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS app_revoke_own_auth_session(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS app_revoke_auth_session_internal(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS app_list_membership_auth_sessions(UUID, UUID, UUID, INTEGER);
DROP FUNCTION IF EXISTS app_actor_can_revoke_membership_sessions(UUID, UUID);

UPDATE rls_policy_inventory
SET rationale = CASE table_name
    WHEN 'auth_sessions' THEN 'Identity-owned revocable session registry; same-organization administration of other members sessions arrives via the SEC-2 capability-checked command boundary, not tenant RLS'
    ELSE 'Identity-owned refresh family bound one-to-one to an auth session; organization administration remains a capability-checked command'
END,
policy_version = policy_version + 1,
updated_at = NOW()
WHERE table_name IN ('auth_sessions', 'auth_refresh_families');
