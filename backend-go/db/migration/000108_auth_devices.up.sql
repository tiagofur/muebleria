-- #460 / SEC-6: dedicated per-device credentials for the SketchUp extension
-- (ADR-0007 session model). A device enrollment is a short-lived, anonymous
-- claim (6-char PIN) that an authenticated user approves to bind the device
-- to their identity; the exchange mints a hash-only device secret plus the
-- registry session (auth_sessions, client_type='sketchup') whose id the
-- SketchUp transport token carries as sid. Access tokens are re-minted from
-- the stored secret; the 30-day absolute session bound is never extended —
-- an expired device session starts a NEW registry row, refresh never slides.
--
-- Classification: platform-global (identity-owned), like auth_sessions. A
-- device belongs to one user and crosses organizations; organization
-- administration of devices is NOT granted here. No DELETE grant: revocation
-- sets revoked_at and cuts the registry session in the same transaction.

CREATE TABLE auth_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- SEC-6 ships sketchup only; the CHECK keeps future transports explicit.
    client_type TEXT NOT NULL CHECK (client_type IN ('sketchup')),
    display_name TEXT NOT NULL,
    -- sha256(device_secret): the raw secret exists only in the exchange
    -- response and the device's secure storage.
    credential_hash BYTEA NOT NULL CHECK (length(credential_hash) = 32),
    -- Registry session currently backing this device's transport tokens.
    -- NULL until the first exchange/token mint; replaced (never extended)
    -- when the previous session passes its absolute bound or is revoked.
    current_session_id UUID REFERENCES auth_sessions(id),
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    credential_version BIGINT NOT NULL DEFAULT 1,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT auth_devices_revocation_after_creation
        CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX idx_auth_devices_user_id ON auth_devices(user_id);
CREATE INDEX idx_auth_devices_open_by_user
    ON auth_devices(user_id, created_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE auth_device_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Crockford-friendly 6-char PIN shown on the device and typed by the
    -- approving user. UNIQUE doubles as the lookup index for the claim.
    code TEXT NOT NULL UNIQUE CHECK (char_length(code) = 6),
    -- NULL while pending: the approving user claims the row by code and
    -- writes their own identity here (same-transaction RLS claim).
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    client_type TEXT NOT NULL CHECK (client_type IN ('sketchup')),
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'exchanged')),
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT 1
);

CREATE INDEX idx_auth_device_enrollments_user_id ON auth_device_enrollments(user_id);
CREATE INDEX idx_auth_device_enrollments_open ON auth_device_enrollments(expires_at)
    WHERE status = 'pending';

ALTER TABLE auth_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_device_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_device_enrollments FORCE ROW LEVEL SECURITY;

-- Access model (#460 SEC-6), mirroring the refresh credentials (000106):
--   * the owning user and platform staff read and update through their
--     explicit identity (app_current_user_id / platform admin);
--   * before any user context exists, the runtime may reach exactly the row
--     whose keyed secret/enrollment id it already knows — the unauthenticated
--     token path proves possession of the device secret by setting
--     app.device_secret_hash to the presented secret's sha256, and the
--     enroll/poll/exchange path scopes to the enrollment id it minted via
--     app.device_enrollment_id. After that keyed lookup the flow installs the
--     row's user as SET LOCAL actor in the SAME transaction, exactly like
--     refresh rotation;
--   * the approving user claims a pending enrollment by the PIN they typed:
--     app.device_enrollment_code scopes the claim to that single row.
CREATE POLICY auth_device_read ON auth_devices FOR SELECT
    USING (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
        OR encode(credential_hash, 'hex') = current_setting('app.device_secret_hash', true)
    );
CREATE POLICY auth_device_insert ON auth_devices FOR INSERT
    WITH CHECK (user_id = app_current_user_id());
CREATE POLICY auth_device_update ON auth_devices FOR UPDATE
    USING (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
    )
    WITH CHECK (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
    );

CREATE POLICY auth_device_enrollment_read ON auth_device_enrollments FOR SELECT
    USING (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
        OR id::text = current_setting('app.device_enrollment_id', true)
        OR code = current_setting('app.device_enrollment_code', true)
    );
-- Enrollments are created anonymously (pending, no user yet): only a pending
-- NULL-owner shape may enter without identity; anything else must be self.
CREATE POLICY auth_device_enrollment_insert ON auth_device_enrollments FOR INSERT
    WITH CHECK (
        user_id IS NULL AND status = 'pending'
    );
CREATE POLICY auth_device_enrollment_update ON auth_device_enrollments FOR UPDATE
    USING (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
        OR id::text = current_setting('app.device_enrollment_id', true)
        OR code = current_setting('app.device_enrollment_code', true)
    )
    WITH CHECK (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
    );

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale, policy_version, updated_at)
VALUES
 ('auth_devices', 'platform-global', 'self-keyed-or-platform', 'self-or-platform', 'Identity-owned hash-only device credentials; the unauthenticated token path is limited to exact secret-hash possession inside one transaction, mirroring refresh credentials', 1, NOW()),
 ('auth_device_enrollments', 'platform-global', 'self-keyed-or-platform', 'self-or-platform', 'Short-lived anonymous enrollment claims; the approving user claims a pending row by PIN in one transaction, the enrolling device reaches only the enrollment id it minted', 1, NOW())
ON CONFLICT (table_name) DO UPDATE SET classification=EXCLUDED.classification, read_scope=EXCLUDED.read_scope,
 write_scope=EXCLUDED.write_scope, rationale=EXCLUDED.rationale, policy_version=rls_policy_inventory.policy_version + 1, updated_at=NOW();

GRANT SELECT, INSERT, UPDATE ON auth_devices TO granete_app;
GRANT SELECT, INSERT, UPDATE ON auth_device_enrollments TO granete_app;
REVOKE DELETE ON auth_devices FROM granete_app;
REVOKE DELETE ON auth_device_enrollments FROM granete_app;
