-- #460 / SEC-1: server-side session registry (ADR-0007).
--
-- Every login/refresh/select-org/support start mints a ver5 token whose `sid`
-- must resolve to a live row here. The registry is the revocation and
-- absolute-lifetime authority: middleware re-validates the row on every
-- request, so logout/revocation cut access immediately even with an unexpired
-- JWT, and absolute_expires_at keeps the 18-hour bound (#441/#445) from ever
-- becoming sliding.
--
-- Classification: platform-global (identity-owned). A session belongs to one
-- user, not to one tenant: it may switch active organization via select-org
-- while keeping the same stable id. Organization admins can see the sessions
-- currently active in their organization; the owning user sees their own;
-- platform staff sees all. No DELETE grant: sessions end by revocation.

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- membership_id/active_organization_id are the CURRENT scope: NULL for the
    -- org-less selection phase (selection_required) and updated in place by
    -- select-org so the session id stays stable across the switch.
    membership_id UUID NULL REFERENCES memberships(id) ON DELETE SET NULL,
    active_organization_id UUID NULL REFERENCES organizations(id) ON DELETE SET NULL,
    -- Support sessions keep their own audited row (000086) and link here so the
    -- registry covers every client type exactly once.
    support_session_id UUID NULL REFERENCES support_sessions(id) ON DELETE SET NULL,
    client_type TEXT NOT NULL CHECK (client_type IN ('web', 'mobile', 'sketchup', 'support')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Absolute session bound: issued_at + 18h (web/mobile), + 30d (sketchup
    -- device policy), + 2h (support). Refresh NEVER extends it.
    absolute_expires_at TIMESTAMPTZ NOT NULL CHECK (absolute_expires_at > created_at),
    last_seen_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL,
    revoked_by UUID NULL REFERENCES users(id),
    revoke_reason TEXT NULL,
    -- Sanitized, length-capped device metadata only. No free-form PII.
    device_label TEXT NULL,
    device_hint TEXT NULL,
    -- Reserved for #460 SEC-7 (MFA step-up freshness). Server-authoritative.
    step_up_at TIMESTAMPTZ NULL,
    version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT auth_sessions_revocation_after_creation CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id, created_at DESC);
CREATE INDEX idx_auth_sessions_active_org
    ON auth_sessions(active_organization_id)
    WHERE active_organization_id IS NOT NULL;
CREATE INDEX idx_auth_sessions_absolute_expiry ON auth_sessions(absolute_expires_at);
CREATE INDEX idx_auth_sessions_open_by_user
    ON auth_sessions(user_id, absolute_expires_at)
    WHERE revoked_at IS NULL;

ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY auth_session_read ON auth_sessions FOR SELECT
    USING (
        user_id = app_current_user_id()
        OR active_organization_id = app_current_organization_id()
        OR app_current_user_is_platform_admin()
    );

CREATE POLICY auth_session_insert ON auth_sessions FOR INSERT
    WITH CHECK (user_id = app_current_user_id());

CREATE POLICY auth_session_update ON auth_sessions FOR UPDATE
    USING (
        user_id = app_current_user_id()
        OR active_organization_id = app_current_organization_id()
        OR app_current_user_is_platform_admin()
    )
    WITH CHECK (
        user_id = app_current_user_id()
        OR active_organization_id = app_current_organization_id()
        OR app_current_user_is_platform_admin()
    );

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('auth_sessions', 'platform-global', 'self-or-organization-or-platform', 'self-or-organization-or-platform', 'Identity-owned revocable session registry; one user may switch organizations on a stable session id')
ON CONFLICT (table_name) DO UPDATE SET classification=EXCLUDED.classification, read_scope=EXCLUDED.read_scope,
 write_scope=EXCLUDED.write_scope, rationale=EXCLUDED.rationale, policy_version=rls_policy_inventory.policy_version + 1, updated_at=NOW();

GRANT SELECT, INSERT, UPDATE ON auth_sessions TO granete_app;
REVOKE DELETE ON auth_sessions FROM granete_app;
