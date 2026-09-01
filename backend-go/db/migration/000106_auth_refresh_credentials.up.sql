-- #460 / SEC-2A: single-use opaque refresh credentials bound to auth_sessions.
-- Raw credentials never enter PostgreSQL; secret_verifier is HMAC-SHA-256
-- under the dedicated REFRESH_TOKEN_PEPPER.

ALTER TABLE auth_sessions
    ADD CONSTRAINT auth_sessions_id_user_absolute_key
    UNIQUE (id, user_id, absolute_expires_at);

CREATE TABLE auth_refresh_families (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL,
    user_id UUID NOT NULL,
    client_type TEXT NOT NULL CHECK (client_type IN ('web', 'mobile')),
    membership_id UUID NULL,
    active_organization_id UUID NULL,
    membership_credential_version BIGINT NULL,
    organization_credential_version BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    absolute_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    revoke_reason TEXT NULL,
    last_generation BIGINT NOT NULL DEFAULT 1 CHECK (last_generation >= 1),
    CONSTRAINT auth_refresh_family_session_unique UNIQUE (session_id),
    CONSTRAINT auth_refresh_family_identity_unique UNIQUE (id, session_id, user_id, absolute_expires_at),
    CONSTRAINT auth_refresh_family_session_fk FOREIGN KEY (session_id, user_id, absolute_expires_at)
        REFERENCES auth_sessions (id, user_id, absolute_expires_at),
    CONSTRAINT auth_refresh_family_membership_user_fk FOREIGN KEY (membership_id, user_id)
        REFERENCES memberships (id, user_id),
    CONSTRAINT auth_refresh_family_membership_organization_fk FOREIGN KEY (membership_id, active_organization_id)
        REFERENCES memberships (id, organization_id),
    CONSTRAINT auth_refresh_family_scope_shape CHECK (
        (membership_id IS NULL AND active_organization_id IS NULL
         AND membership_credential_version IS NULL AND organization_credential_version IS NULL)
        OR
        (membership_id IS NOT NULL AND active_organization_id IS NOT NULL
         AND membership_credential_version >= 1 AND organization_credential_version >= 1)
    ),
    CONSTRAINT auth_refresh_family_lifetime CHECK (absolute_expires_at > created_at),
    CONSTRAINT auth_refresh_family_revocation CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE auth_refresh_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL,
    session_id UUID NOT NULL,
    user_id UUID NOT NULL,
    secret_verifier BYTEA NOT NULL CHECK (octet_length(secret_verifier) = 32),
    generation BIGINT NOT NULL CHECK (generation >= 1),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL,
    parent_id UUID NULL REFERENCES auth_refresh_credentials(id),
    replacement_id UUID NULL REFERENCES auth_refresh_credentials(id),
    CONSTRAINT auth_refresh_credential_verifier_unique UNIQUE (secret_verifier),
    CONSTRAINT auth_refresh_credential_generation_unique UNIQUE (family_id, generation),
    CONSTRAINT auth_refresh_credential_parent_unique UNIQUE (parent_id),
    CONSTRAINT auth_refresh_credential_replacement_unique UNIQUE (replacement_id),
    CONSTRAINT auth_refresh_credential_family_fk
        FOREIGN KEY (family_id, session_id, user_id, expires_at)
        REFERENCES auth_refresh_families (id, session_id, user_id, absolute_expires_at),
    CONSTRAINT auth_refresh_credential_lifetime CHECK (expires_at > issued_at),
    CONSTRAINT auth_refresh_credential_use_after_issue CHECK (used_at IS NULL OR used_at >= issued_at),
    CONSTRAINT auth_refresh_credential_revoke_after_issue CHECK (revoked_at IS NULL OR revoked_at >= issued_at),
    CONSTRAINT auth_refresh_credential_replacement_state CHECK (
        (used_at IS NULL AND replacement_id IS NULL)
        OR (used_at IS NOT NULL AND replacement_id IS NOT NULL)
    )
);

CREATE INDEX idx_auth_refresh_families_user ON auth_refresh_families(user_id, created_at DESC);
CREATE INDEX idx_auth_refresh_families_membership ON auth_refresh_families(membership_id) WHERE membership_id IS NOT NULL;
CREATE INDEX idx_auth_refresh_families_open_session ON auth_refresh_families(session_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_auth_refresh_credentials_family ON auth_refresh_credentials(family_id, generation DESC);
CREATE INDEX idx_auth_refresh_credentials_active ON auth_refresh_credentials(expires_at) WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE auth_refresh_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_refresh_families FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_refresh_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_refresh_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY auth_refresh_family_read ON auth_refresh_families FOR SELECT
    USING (user_id = app_current_user_id() OR app_current_user_is_platform_admin());
CREATE POLICY auth_refresh_family_insert ON auth_refresh_families FOR INSERT
    WITH CHECK (user_id = app_current_user_id());
CREATE POLICY auth_refresh_family_update ON auth_refresh_families FOR UPDATE
    USING (user_id = app_current_user_id() OR app_current_user_is_platform_admin())
    WITH CHECK (user_id = app_current_user_id() OR app_current_user_is_platform_admin());

-- Before the bearer is authenticated there is no app.user_id. The runtime may
-- read exactly the credential whose keyed verifier it already knows; after
-- that lookup it installs the row's user as SET LOCAL actor in the SAME tx.
CREATE POLICY auth_refresh_credential_read ON auth_refresh_credentials FOR SELECT
    USING (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
        OR encode(secret_verifier, 'hex') = current_setting('app.refresh_verifier', true)
    );
CREATE POLICY auth_refresh_credential_insert ON auth_refresh_credentials FOR INSERT
    WITH CHECK (user_id = app_current_user_id());
CREATE POLICY auth_refresh_credential_update ON auth_refresh_credentials FOR UPDATE
    USING (user_id = app_current_user_id() OR app_current_user_is_platform_admin())
    WITH CHECK (user_id = app_current_user_id() OR app_current_user_is_platform_admin());

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('auth_refresh_families', 'platform-global', 'self-or-platform', 'self-or-platform', 'Identity-owned refresh family bound one-to-one to an auth session; organization administration remains a capability-checked command'),
 ('auth_refresh_credentials', 'platform-global', 'self-verifier-or-platform', 'self-or-platform', 'Hash-only single-use refresh rows; unauthenticated lookup is limited to exact keyed verifier possession inside one transaction')
ON CONFLICT (table_name) DO UPDATE SET classification=EXCLUDED.classification, read_scope=EXCLUDED.read_scope,
 write_scope=EXCLUDED.write_scope, rationale=EXCLUDED.rationale, policy_version=rls_policy_inventory.policy_version + 1, updated_at=NOW();

GRANT SELECT, INSERT, UPDATE ON auth_refresh_families TO granete_app;
GRANT SELECT, INSERT, UPDATE ON auth_refresh_credentials TO granete_app;
REVOKE DELETE ON auth_refresh_families FROM granete_app;
REVOKE DELETE ON auth_refresh_credentials FROM granete_app;
