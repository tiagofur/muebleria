-- #560: Reconcile auth_devices and auth_device_enrollments schema and RLS policies
-- for environments that applied the initial version of 000108 (commit 2eab774f).
-- The original migration shipped with SELECT-only policies (select_own_auth_devices
-- and select_own_auth_device_enrollments) under FORCE ROW LEVEL SECURITY, which
-- caused any insert or update under granete_app to fail with an RLS violation.
-- This migration brings existing databases into parity with the canonical 000108 contract.

-- 1. Schema adjustments on auth_devices
ALTER TABLE auth_devices
    ADD COLUMN IF NOT EXISTS current_session_id UUID REFERENCES auth_sessions(id);

-- Check constraints on auth_devices
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'auth_devices_client_type_check' AND conrelid = 'auth_devices'::regclass
    ) THEN
        ALTER TABLE auth_devices
            ADD CONSTRAINT auth_devices_client_type_check CHECK (client_type IN ('sketchup'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'auth_devices_credential_hash_check' AND conrelid = 'auth_devices'::regclass
    ) THEN
        ALTER TABLE auth_devices
            ADD CONSTRAINT auth_devices_credential_hash_check CHECK (length(credential_hash) = 32);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'auth_devices_revocation_after_creation' AND conrelid = 'auth_devices'::regclass
    ) THEN
        ALTER TABLE auth_devices
            ADD CONSTRAINT auth_devices_revocation_after_creation CHECK (revoked_at IS NULL OR revoked_at >= created_at);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auth_devices_open_by_user
    ON auth_devices(user_id, created_at DESC) WHERE revoked_at IS NULL;

-- 2. Constraints and indexes on auth_device_enrollments
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'auth_device_enrollments_code_check' AND conrelid = 'auth_device_enrollments'::regclass
    ) THEN
        ALTER TABLE auth_device_enrollments
            ADD CONSTRAINT auth_device_enrollments_code_check CHECK (char_length(code) = 6);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'auth_device_enrollments_client_type_check' AND conrelid = 'auth_device_enrollments'::regclass
    ) THEN
        ALTER TABLE auth_device_enrollments
            ADD CONSTRAINT auth_device_enrollments_client_type_check CHECK (client_type IN ('sketchup'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'auth_device_enrollments_status_check' AND conrelid = 'auth_device_enrollments'::regclass
    ) THEN
        ALTER TABLE auth_device_enrollments
            ADD CONSTRAINT auth_device_enrollments_status_check CHECK (status IN ('pending', 'approved', 'exchanged'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'auth_device_enrollments_check' AND conrelid = 'auth_device_enrollments'::regclass
    ) THEN
        ALTER TABLE auth_device_enrollments
            ADD CONSTRAINT auth_device_enrollments_check CHECK (expires_at > created_at);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auth_device_enrollments_open
    ON auth_device_enrollments(expires_at) WHERE status = 'pending';

-- 3. RLS policy reconciliation on auth_devices
ALTER TABLE auth_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_devices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_own_auth_devices ON auth_devices;
DROP POLICY IF EXISTS auth_device_read ON auth_devices;
DROP POLICY IF EXISTS auth_device_insert ON auth_devices;
DROP POLICY IF EXISTS auth_device_update ON auth_devices;

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

-- 4. RLS policy reconciliation on auth_device_enrollments
ALTER TABLE auth_device_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_device_enrollments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_own_auth_device_enrollments ON auth_device_enrollments;
DROP POLICY IF EXISTS auth_device_enrollment_read ON auth_device_enrollments;
DROP POLICY IF EXISTS auth_device_enrollment_insert ON auth_device_enrollments;
DROP POLICY IF EXISTS auth_device_enrollment_update ON auth_device_enrollments;

CREATE POLICY auth_device_enrollment_read ON auth_device_enrollments FOR SELECT
    USING (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
        OR id::text = current_setting('app.device_enrollment_id', true)
        OR code = current_setting('app.device_enrollment_code', true)
    );

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

-- 5. Inventory and Permissions
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
