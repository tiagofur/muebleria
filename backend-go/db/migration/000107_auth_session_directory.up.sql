-- #460 / SEC-2B: narrow session-directory commands without widening the
-- self-or-platform RLS policies on auth_sessions/auth_refresh_families.

CREATE FUNCTION app_actor_can_revoke_membership_sessions(p_actor_user_id UUID, p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT app_current_user_id() = p_actor_user_id
       AND app_current_organization_id() = p_organization_id
       AND EXISTS (
            SELECT 1
            FROM memberships actor
            JOIN organizations organization ON organization.id = actor.organization_id
            WHERE actor.id = app_current_membership_id()
              AND actor.user_id = p_actor_user_id
              AND actor.organization_id = p_organization_id
              AND actor.status = 'active'
              AND 'admin' = ANY(actor.roles)
              AND organization.status = 'active'
       )
$$;
REVOKE ALL ON FUNCTION app_actor_can_revoke_membership_sessions(UUID, UUID) FROM PUBLIC;

CREATE FUNCTION app_list_membership_auth_sessions(
    p_actor_user_id UUID,
    p_organization_id UUID,
    p_target_membership_id UUID,
    p_result_limit INTEGER
)
RETURNS TABLE (
    session_id UUID,
    target_user_id UUID,
    membership_id UUID,
    active_organization_id UUID,
    client_type TEXT,
    created_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    absolute_expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    device_hint TEXT,
    organization_name TEXT,
    organization_slug TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT session.id, session.user_id, session.membership_id,
           session.active_organization_id, session.client_type,
           session.created_at, session.last_seen_at,
           session.absolute_expires_at, session.revoked_at,
           session.device_hint, organization.name, organization.slug
    FROM auth_sessions session
    JOIN memberships target
      ON target.id = p_target_membership_id
     AND target.organization_id = p_organization_id
     AND target.user_id = session.user_id
    LEFT JOIN organizations organization
      ON organization.id = session.active_organization_id
    WHERE app_actor_can_revoke_membership_sessions(p_actor_user_id, p_organization_id)
      AND session.membership_id = target.id
      AND session.active_organization_id = p_organization_id
      AND session.client_type <> 'support'
    ORDER BY
      CASE
        WHEN session.revoked_at IS NULL AND session.absolute_expires_at > NOW() THEN 0
        WHEN session.revoked_at IS NOT NULL THEN 1
        ELSE 2
      END,
      session.created_at DESC
    LIMIT LEAST(GREATEST(p_result_limit, 1), 100)
$$;
REVOKE ALL ON FUNCTION app_list_membership_auth_sessions(UUID, UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_list_membership_auth_sessions(UUID, UUID, UUID, INTEGER) TO granete_app;

CREATE FUNCTION app_revoke_auth_session_internal(
    p_actor_user_id UUID,
    p_target_user_id UUID,
    p_target_membership_id UUID,
    p_target_organization_id UUID,
    p_target_session_id UUID,
    p_revoke_reason TEXT,
    p_event_type TEXT,
    p_source_ip TEXT,
    p_request_id TEXT
)
RETURNS TABLE (
    session_id UUID,
    session_user_id UUID,
    membership_id UUID,
    active_organization_id UUID,
    client_type TEXT,
    created_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    absolute_expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    device_hint TEXT,
    organization_name TEXT,
    organization_slug TEXT,
    revoked_now BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    selected_session auth_sessions%ROWTYPE;
    transitioned BOOLEAN := FALSE;
    family_transition_count BIGINT := 0;
BEGIN
    SELECT session.* INTO selected_session
    FROM auth_sessions session
    WHERE session.id = p_target_session_id
      AND session.user_id = p_target_user_id
      AND (p_target_membership_id IS NULL OR session.membership_id = p_target_membership_id)
      AND (p_target_organization_id IS NULL OR session.active_organization_id = p_target_organization_id)
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF selected_session.revoked_at IS NULL THEN
        UPDATE auth_sessions session
        SET revoked_at = NOW(), revoked_by = p_actor_user_id,
            revoke_reason = p_revoke_reason, version = version + 1
        WHERE session.id = selected_session.id;
        transitioned := TRUE;
    END IF;

    -- Repair an inconsistent pre-existing state too: an idempotent retry must
    -- still close an open family even if another policy already closed the
    -- session. This mirrors SEC-2A logout's combined-resource semantics.
    UPDATE auth_refresh_families family
    SET revoked_at = NOW(),
        revoke_reason = COALESCE(family.revoke_reason, p_revoke_reason)
    WHERE family.session_id = selected_session.id
      AND family.revoked_at IS NULL;
    GET DIAGNOSTICS family_transition_count = ROW_COUNT;
    transitioned := transitioned OR family_transition_count > 0;

    IF transitioned THEN
        INSERT INTO security_audit_events (
            event_type, actor_user_id, target_user_id, organization_id, ip, details
        ) VALUES (
            p_event_type, p_actor_user_id, selected_session.user_id,
            selected_session.active_organization_id, NULLIF(p_source_ip, ''),
            jsonb_build_object(
                'session_id', selected_session.id,
                'target_membership_id', selected_session.membership_id,
                'client_type', selected_session.client_type,
                'reason', p_revoke_reason,
                'request_id', p_request_id
            )
        );
    END IF;

    RETURN QUERY
    SELECT session.id, session.user_id, session.membership_id,
           session.active_organization_id, session.client_type,
           session.created_at, session.last_seen_at,
           session.absolute_expires_at, session.revoked_at,
           session.device_hint, organization.name, organization.slug,
           transitioned
    FROM auth_sessions session
    LEFT JOIN organizations organization
      ON organization.id = session.active_organization_id
    WHERE session.id = selected_session.id;
END
$$;
REVOKE ALL ON FUNCTION app_revoke_auth_session_internal(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_revoke_auth_session_internal(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM granete_app;

CREATE FUNCTION app_revoke_own_auth_session(
    p_actor_user_id UUID,
    p_target_session_id UUID,
    p_source_ip TEXT,
    p_request_id TEXT
)
RETURNS TABLE (
    session_id UUID, session_user_id UUID, membership_id UUID,
    active_organization_id UUID, client_type TEXT, created_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ, absolute_expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ, device_hint TEXT, organization_name TEXT,
    organization_slug TEXT, revoked_now BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF app_current_user_id() IS DISTINCT FROM p_actor_user_id THEN
        RETURN;
    END IF;
    RETURN QUERY SELECT * FROM app_revoke_auth_session_internal(
        p_actor_user_id, p_actor_user_id, NULL, NULL, p_target_session_id,
        'self_revocation', 'session_revoked_self', p_source_ip, p_request_id
    );
END
$$;
REVOKE ALL ON FUNCTION app_revoke_own_auth_session(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_revoke_own_auth_session(UUID, UUID, TEXT, TEXT) TO granete_app;

CREATE FUNCTION app_revoke_membership_auth_session(
    p_actor_user_id UUID,
    p_organization_id UUID,
    p_target_membership_id UUID,
    p_target_session_id UUID,
    p_revoke_reason TEXT,
    p_source_ip TEXT,
    p_request_id TEXT
)
RETURNS TABLE (
    session_id UUID, session_user_id UUID, membership_id UUID,
    active_organization_id UUID, client_type TEXT, created_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ, absolute_expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ, device_hint TEXT, organization_name TEXT,
    organization_slug TEXT, revoked_now BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    member_user_id UUID;
BEGIN
    IF NOT app_actor_can_revoke_membership_sessions(p_actor_user_id, p_organization_id) THEN
        RETURN;
    END IF;
    SELECT member.user_id INTO member_user_id
    FROM memberships member
    WHERE member.id = p_target_membership_id
      AND member.organization_id = p_organization_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    RETURN QUERY SELECT * FROM app_revoke_auth_session_internal(
        p_actor_user_id, member_user_id, p_target_membership_id, p_organization_id,
        p_target_session_id, p_revoke_reason,
        'session_revoked_by_organization_admin', p_source_ip, p_request_id
    );
END
$$;
REVOKE ALL ON FUNCTION app_revoke_membership_auth_session(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_revoke_membership_auth_session(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT) TO granete_app;

CREATE FUNCTION app_revoke_platform_auth_session(
    p_actor_user_id UUID,
    p_target_user_id UUID,
    p_target_session_id UUID,
    p_revoke_reason TEXT,
    p_source_ip TEXT,
    p_request_id TEXT
)
RETURNS TABLE (
    session_id UUID, session_user_id UUID, membership_id UUID,
    active_organization_id UUID, client_type TEXT, created_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ, absolute_expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ, device_hint TEXT, organization_name TEXT,
    organization_slug TEXT, revoked_now BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF app_current_user_id() IS DISTINCT FROM p_actor_user_id
       OR NOT app_current_user_is_platform_admin() THEN
        RETURN;
    END IF;
    RETURN QUERY SELECT * FROM app_revoke_auth_session_internal(
        p_actor_user_id, p_target_user_id, NULL, NULL, p_target_session_id,
        p_revoke_reason, 'session_revoked_by_platform', p_source_ip, p_request_id
    );
END
$$;
REVOKE ALL ON FUNCTION app_revoke_platform_auth_session(UUID, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_revoke_platform_auth_session(UUID, UUID, UUID, TEXT, TEXT, TEXT) TO granete_app;

CREATE FUNCTION app_revoke_membership_auth_sessions(
    p_actor_user_id UUID,
    p_organization_id UUID,
    p_target_membership_id UUID,
    p_revoke_reason TEXT,
    p_expected_version BIGINT
)
RETURNS TABLE (
    membership_id UUID, user_id UUID, email TEXT, name TEXT,
    account_status TEXT, membership_status TEXT, roles TEXT[],
    joined_at TIMESTAMPTZ, version BIGINT, last_login_at TIMESTAMPTZ,
    credential_version BIGINT, sessions_revoked_at TIMESTAMPTZ
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    member_user_id UUID;
BEGIN
    IF NOT app_actor_can_revoke_membership_sessions(p_actor_user_id, p_organization_id) THEN
        RETURN;
    END IF;

    UPDATE memberships member
    SET credential_version = member.credential_version + 1,
        sessions_revoked_at = NOW(), sessions_revoked_by = p_actor_user_id,
        sessions_revocation_reason = p_revoke_reason,
        updated_at = NOW(), version = member.version + 1
    WHERE member.id = p_target_membership_id
      AND member.organization_id = p_organization_id
      AND member.version = p_expected_version
    RETURNING member.user_id INTO member_user_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE auth_sessions session
    SET revoked_at = COALESCE(session.revoked_at, NOW()),
        revoked_by = COALESCE(session.revoked_by, p_actor_user_id),
        revoke_reason = COALESCE(session.revoke_reason, p_revoke_reason),
        version = CASE WHEN session.revoked_at IS NULL THEN session.version + 1 ELSE session.version END
    WHERE session.membership_id = p_target_membership_id
      AND session.active_organization_id = p_organization_id;

    UPDATE auth_refresh_families family
    SET revoked_at = COALESCE(family.revoked_at, NOW()),
        revoke_reason = COALESCE(family.revoke_reason, p_revoke_reason)
    WHERE family.membership_id = p_target_membership_id
      AND family.active_organization_id = p_organization_id;

    RETURN QUERY
    SELECT member.id, account.id, account.email::TEXT, account.name::TEXT,
           account.account_status::TEXT, member.status::TEXT, member.roles,
           member.joined_at, member.version, account.last_login_at,
           member.credential_version, member.sessions_revoked_at
    FROM memberships member
    JOIN users account ON account.id = member.user_id
    WHERE member.id = p_target_membership_id
      AND member.organization_id = p_organization_id
      AND member.user_id = member_user_id;
END
$$;
REVOKE ALL ON FUNCTION app_revoke_membership_auth_sessions(UUID, UUID, UUID, TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_revoke_membership_auth_sessions(UUID, UUID, UUID, TEXT, BIGINT) TO granete_app;

-- RLS intentionally remains self-or-platform. These functions are the only
-- organization-admin crossing points and expose only the public projection or
-- an exact revocation command.
UPDATE rls_policy_inventory
SET rationale = 'Identity-owned revocable session registry; RLS stays self-or-platform and organization administration uses SEC-2B capability-checked narrow functions',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name IN ('auth_sessions', 'auth_refresh_families');
