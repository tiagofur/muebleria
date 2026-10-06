-- One-time password reset credentials (#1178). Mirrors the invitation token
-- contract: 256-bit random token stored only as its SHA-256 hash, short
-- expiry, single use, and rotation (a new issuance revokes previous open
-- tokens). The runtime role receives NO direct table access — every path goes
-- through SECURITY DEFINER functions (issue / lock / consume) plus the
-- user-level session revocation the confirmation applies, mirroring the
-- platform-command precedent of organizations (000100).

CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    issued_via TEXT NOT NULL CHECK (issued_via IN ('admin', 'self')),
    issued_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NULL,
    used_by_ip TEXT NULL,
    revoked_at TIMESTAMPTZ NULL,
    revoked_reason TEXT NULL,
    request_ip TEXT NULL,
    request_id TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT password_reset_tokens_issuer_shape CHECK (
        (issued_via = 'admin' AND issued_by IS NOT NULL)
        OR (issued_via = 'self' AND issued_by IS NULL)
    )
);

CREATE INDEX idx_password_reset_tokens_user_created ON password_reset_tokens(user_id, created_at DESC);
CREATE INDEX idx_password_reset_tokens_open_expiry ON password_reset_tokens(expires_at)
    WHERE used_at IS NULL AND revoked_at IS NULL;

REVOKE ALL ON password_reset_tokens FROM granete_app;

-- Rotation + insert in one authoritative step. issued_via/issued_by coherence
-- is re-checked here so the HTTP layer can never mint an anonymous admin
-- issuance or an actor-attributed self request.
CREATE FUNCTION issue_password_reset_token(
    p_user_id UUID,
    p_token_hash TEXT,
    p_issued_via TEXT,
    p_issued_by UUID,
    p_expires_at TIMESTAMPTZ,
    p_request_ip TEXT,
    p_request_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_issued_via NOT IN ('admin', 'self') THEN
        RAISE EXCEPTION 'issued_via must be admin or self';
    END IF;
    IF p_issued_via = 'admin' AND p_issued_by IS NULL THEN
        RAISE EXCEPTION 'admin-issued reset tokens require the issuing actor';
    END IF;
    IF p_issued_via = 'self' AND p_issued_by IS NOT NULL THEN
        RAISE EXCEPTION 'self-issued reset tokens cannot carry an issuing actor';
    END IF;
    UPDATE password_reset_tokens
       SET revoked_at = NOW(), revoked_reason = 'replaced_by_new_issuance'
     WHERE user_id = p_user_id
       AND used_at IS NULL AND revoked_at IS NULL;
    INSERT INTO password_reset_tokens(user_id, token_hash, issued_via, issued_by, expires_at, request_ip, request_id)
    VALUES (p_user_id, p_token_hash, p_issued_via, p_issued_by, p_expires_at, p_request_ip, p_request_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION issue_password_reset_token(UUID, TEXT, TEXT, UUID, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION issue_password_reset_token(UUID, TEXT, TEXT, UUID, TIMESTAMPTZ, TEXT, TEXT) TO granete_app;

-- Exact-hash public confirmation boundary: serializes confirmation before the
-- password mutation, exactly like lock_open_invitation_by_hash (000095). The
-- caller decides usability (expiry/used/revoked) from the returned row so the
-- typed error taxonomy stays in Go.
CREATE FUNCTION lock_password_reset_token_by_hash(p_token_hash TEXT)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    issued_via TEXT,
    expires_at TIMESTAMPTZ,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
)
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
ROWS 1
AS $$
    SELECT t.id, t.user_id, t.issued_via, t.expires_at, t.used_at, t.revoked_at
    FROM password_reset_tokens t
    WHERE t.token_hash = p_token_hash
    FOR UPDATE OF t
$$;
REVOKE ALL ON FUNCTION lock_password_reset_token_by_hash(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_password_reset_token_by_hash(TEXT) TO granete_app;

CREATE FUNCTION consume_password_reset_token(p_token_id UUID, p_used_by_ip TEXT)
RETURNS VOID
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    UPDATE password_reset_tokens
       SET used_at = NOW(), used_by_ip = p_used_by_ip
     WHERE id = p_token_id AND used_at IS NULL;
$$;
REVOKE ALL ON FUNCTION consume_password_reset_token(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_password_reset_token(UUID, TEXT) TO granete_app;

-- User-level cut (#1178): a password reset must invalidate every live
-- session and refresh family of the identity, across all organizations and
-- client types. Paired SketchUp devices survive by design: their secret
-- re-mints sessions through the device grant, password knowledge is not a
-- device credential.
CREATE FUNCTION app_revoke_user_auth_sessions(p_target_user_id UUID, p_revoke_reason TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_revoked INTEGER;
BEGIN
    UPDATE auth_sessions s
       SET revoked_at = COALESCE(s.revoked_at, NOW()),
           revoked_by = COALESCE(s.revoked_by, p_target_user_id),
           revoke_reason = COALESCE(s.revoke_reason, p_revoke_reason),
           version = CASE WHEN s.revoked_at IS NULL THEN s.version + 1 ELSE s.version END
     WHERE s.user_id = p_target_user_id AND s.revoked_at IS NULL;
    GET DIAGNOSTICS v_revoked = ROW_COUNT;
    UPDATE auth_refresh_families f
       SET revoked_at = COALESCE(f.revoked_at, NOW()),
           revoke_reason = COALESCE(f.revoke_reason, p_revoke_reason)
     WHERE f.user_id = p_target_user_id AND f.revoked_at IS NULL;
    RETURN v_revoked;
END
$$;
REVOKE ALL ON FUNCTION app_revoke_user_auth_sessions(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_revoke_user_auth_sessions(UUID, TEXT) TO granete_app;

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('password_reset_tokens', 'platform-global', 'identity-credential', 'identity-command',
        'One-time reset credentials: direct table access revoked from the runtime role; issue/lock/consume go through SECURITY DEFINER functions')
ON CONFLICT (table_name) DO NOTHING;
