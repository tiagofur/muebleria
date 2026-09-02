-- #460 / SEC-7: MFA factors, recovery codes and step-up authority
-- (ADR-0007 session model). A TOTP factor lives as an AES-256-GCM encrypted
-- secret under the dedicated MFA keyring (kid-pinned); a factor generated but
-- not verified is `pending` and never authorizes anything. Recovery codes
-- store only keyed HMAC-SHA256 verifiers. Step-up authority is a server-side
-- grant bound to one auth_session (sid) + user + scope with a short expiry —
-- a session replacement (new sid) structurally cannot inherit it, and session
-- revocation kills it because the freshness check joins the live session row.
--
-- Classification: platform-global (identity-owned), like auth_sessions and
-- auth_devices. MFA belongs to the USER across organizations; organization
-- administration of another member's factors is NOT granted here. No DELETE
-- grants: factors/recovery codes end by revocation marks, step-up grants are
-- immutable and expire.

CREATE TABLE auth_mfa_factors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- SEC-7 ships TOTP; the CHECK keeps future factor types explicit.
    factor_type TEXT NOT NULL CHECK (factor_type IN ('totp')),
    -- pending → enabled (verified); revoked is terminal for any state.
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'enabled', 'revoked')),
    label TEXT NOT NULL DEFAULT '',
    -- AES-256-GCM nonce(12) || ciphertext || tag(16). Never the raw secret.
    encrypted_secret BYTEA NOT NULL CHECK (length(encrypted_secret) > 28),
    -- Key version of the MFA keyring entry that encrypted the secret.
    encryption_kid TEXT NOT NULL,
    -- TOTP replay high-water mark: the newest accepted time-step counter.
    -- Verification requires counter > last_used_counter (atomic UPDATE).
    last_used_counter BIGINT,
    last_used_at TIMESTAMPTZ,
    -- Enrollment window: only meaningful while pending. An expired pending
    -- factor can never be enabled.
    pending_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enabled_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT auth_mfa_factor_lifecycle
        CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    -- enabled_at is HISTORICAL: it survives revocation. The shapes only
    -- require the marker of the CURRENT status to be present (and absent
    -- while pending).
    CONSTRAINT auth_mfa_factor_enabled_shape
        CHECK (status <> 'enabled' OR enabled_at IS NOT NULL),
    CONSTRAINT auth_mfa_factor_pending_shape
        CHECK (status <> 'pending' OR (enabled_at IS NULL AND revoked_at IS NULL)),
    CONSTRAINT auth_mfa_factor_revoked_shape
        CHECK (status <> 'revoked' OR revoked_at IS NOT NULL),
    CONSTRAINT auth_mfa_factor_pending_window
        CHECK (status <> 'pending' OR pending_expires_at IS NOT NULL)
);

CREATE INDEX idx_auth_mfa_factors_user ON auth_mfa_factors(user_id);
CREATE INDEX idx_auth_mfa_factors_enabled ON auth_mfa_factors(user_id)
    WHERE status = 'enabled';

CREATE TABLE auth_mfa_recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- HMAC-SHA256(verifier subkey, normalized code). Never the plaintext.
    verifier BYTEA NOT NULL CHECK (length(verifier) = 32),
    encryption_kid TEXT NOT NULL,
    -- Single use: consumption is the atomic UPDATE of used_at below.
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT auth_mfa_recovery_used_after_creation
        CHECK (used_at IS NULL OR used_at >= created_at)
);

CREATE INDEX idx_auth_mfa_recovery_codes_user ON auth_mfa_recovery_codes(user_id)
    WHERE revoked_at IS NULL;

CREATE TABLE auth_step_up_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The authority is server-side and sid-bound: one grant per session,
    -- scope and verification. Session replacement mints a new sid and can
    -- never inherit; the freshness check joins the live auth_sessions row so
    -- revocation cuts outstanding grants without any cleanup job.
    auth_session_id UUID NOT NULL REFERENCES auth_sessions(id),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN (
        'device_enrollment', 'support_access', 'security_admin',
        'organization_admin', 'platform_admin')),
    method TEXT NOT NULL CHECK (method IN ('totp', 'recovery')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at)
);

CREATE INDEX idx_auth_step_up_grants_lookup
    ON auth_step_up_grants(auth_session_id, scope, expires_at DESC);

ALTER TABLE auth_mfa_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_mfa_factors FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_mfa_recovery_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_step_up_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_step_up_grants FORCE ROW LEVEL SECURITY;

-- Access model (#460 SEC-7), mirroring auth_devices (000108): the owning
-- user and platform staff read and mutate through their explicit identity;
-- inserts carry the owning user; no cross-tenant access exists because MFA
-- is identity-owned, not organization-owned.
CREATE POLICY auth_mfa_factor_read ON auth_mfa_factors FOR SELECT
    USING (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
    );
CREATE POLICY auth_mfa_factor_insert ON auth_mfa_factors FOR INSERT
    WITH CHECK (user_id = app_current_user_id());
CREATE POLICY auth_mfa_factor_update ON auth_mfa_factors FOR UPDATE
    USING (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
    )
    WITH CHECK (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
    );

CREATE POLICY auth_mfa_recovery_read ON auth_mfa_recovery_codes FOR SELECT
    USING (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
    );
CREATE POLICY auth_mfa_recovery_insert ON auth_mfa_recovery_codes FOR INSERT
    WITH CHECK (user_id = app_current_user_id());
CREATE POLICY auth_mfa_recovery_update ON auth_mfa_recovery_codes FOR UPDATE
    USING (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
    )
    WITH CHECK (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
    );

CREATE POLICY auth_step_up_grant_read ON auth_step_up_grants FOR SELECT
    USING (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
    );
CREATE POLICY auth_step_up_grant_insert ON auth_step_up_grants FOR INSERT
    WITH CHECK (user_id = app_current_user_id());

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale, policy_version, updated_at)
VALUES
 ('auth_mfa_factors', 'platform-global', 'self-or-platform', 'self-or-platform', 'Identity-owned MFA factors with AES-256-GCM encrypted TOTP secrets; pending factors authorize nothing until a verified TOTP enables them', 1, NOW()),
 ('auth_mfa_recovery_codes', 'platform-global', 'self-or-platform', 'self-or-platform', 'Identity-owned single-use recovery verifiers (keyed HMAC-SHA256, never plaintext); consumption is an atomic conditional UPDATE', 1, NOW()),
 ('auth_step_up_grants', 'platform-global', 'self-or-platform', 'self-insert-only', 'Server-side step-up authority bound to one session+user+scope with short expiry; immutable after insert, invalidated structurally by session revocation (freshness joins the live session row) and never inheritable across session replacement', 1, NOW())
ON CONFLICT (table_name) DO UPDATE SET classification=EXCLUDED.classification, read_scope=EXCLUDED.read_scope,
 write_scope=EXCLUDED.write_scope, rationale=EXCLUDED.rationale, policy_version=rls_policy_inventory.policy_version + 1, updated_at=NOW();

GRANT SELECT, INSERT, UPDATE ON auth_mfa_factors TO granete_app;
GRANT SELECT, INSERT, UPDATE ON auth_mfa_recovery_codes TO granete_app;
GRANT SELECT, INSERT ON auth_step_up_grants TO granete_app;
REVOKE DELETE ON auth_mfa_factors FROM granete_app;
REVOKE DELETE ON auth_mfa_recovery_codes FROM granete_app;
REVOKE UPDATE, DELETE ON auth_step_up_grants FROM granete_app;
