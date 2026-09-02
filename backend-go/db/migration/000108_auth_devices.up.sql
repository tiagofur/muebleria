CREATE TABLE auth_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    credential_hash BYTEA NOT NULL,
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    credential_version BIGINT NOT NULL DEFAULT 1,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT 1
);

CREATE INDEX idx_auth_devices_user_id ON auth_devices(user_id);

CREATE TABLE auth_device_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    client_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT 1
);

CREATE INDEX idx_auth_device_enrollments_code ON auth_device_enrollments(code);
CREATE INDEX idx_auth_device_enrollments_user_id ON auth_device_enrollments(user_id);


ALTER TABLE auth_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_device_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_device_enrollments FORCE ROW LEVEL SECURITY;


CREATE POLICY select_own_auth_devices ON auth_devices
    FOR SELECT TO PUBLIC
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY select_own_auth_device_enrollments ON auth_device_enrollments
    FOR SELECT TO PUBLIC
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

-- Insert into RLS inventory
INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale, policy_version, updated_at)
VALUES 
('auth_devices', 'tenant-owned', 'self', 'self', 'Devices belong globally to a user, RLS restricts to the owner', 1, NOW()),
('auth_device_enrollments', 'tenant-owned', 'self', 'self', 'Enrollments belong globally to a user, RLS restricts to the owner', 1, NOW());

