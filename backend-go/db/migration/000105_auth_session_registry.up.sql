-- #460 / SEC-1: server-side session registry (ADR-0007).
--
-- Every login/refresh/select-org/support start mints a ver5 token whose `sid`
-- must resolve to a live row here. The registry is the revocation, absolute
-- lifetime AND current-scope authority: middleware re-validates the row on
-- every request, so logout/revocation cut access immediately even with an
-- unexpired JWT, absolute_expires_at keeps the 18-hour bound (#441/#445) from
-- ever becoming sliding, and a token whose organization/membership scope no
-- longer matches the session's CURRENT scope stops validating the moment
-- select-org switches it.
--
-- Classification: platform-global (identity-owned). A session belongs to one
-- user; its scope is (membership, organization) — both NULL for the org-less
-- selection phase — or a linked support session. Coherence is enforced by the
-- database itself: the membership must belong to the session's user (composite
-- FK) and to the session's active organization (composite FK), and only the
-- support shape may carry an organization without a membership. No DELETE
-- grant: sessions end by revocation.

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- membership_id/active_organization_id are the CURRENT scope: NULL for the
    -- org-less selection phase (selection_required) and updated in place by
    -- select-org so the session id stays stable across the switch. For normal
    -- clients both are set together; support carries organization +
    -- support_session_id without a membership. Coherence with user/org is
    -- enforced by the composite FKs below (NO ACTION: memberships and
    -- organizations follow soft lifecycles, sessions must not silently detach).
    membership_id UUID NULL,
    active_organization_id UUID NULL REFERENCES organizations(id),
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
    CONSTRAINT auth_sessions_revocation_after_creation CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    -- Scope shape: exactly one of org-less / normal scoped / support.
    --   org-less: membership NULL AND active_organization NULL AND no support.
    --   scoped:   membership AND active_organization set, no support.
    --   support:  active_organization AND support_session set, membership NULL.
    CONSTRAINT auth_sessions_scope_shape CHECK (
        (
            client_type = 'support'
            AND support_session_id IS NOT NULL
            AND membership_id IS NULL
            AND active_organization_id IS NOT NULL
        )
        OR (
            client_type <> 'support'
            AND support_session_id IS NULL
            AND (
                (membership_id IS NULL AND active_organization_id IS NULL)
                OR (membership_id IS NOT NULL AND active_organization_id IS NOT NULL)
            )
        )
    )
);

-- Composite FKs enforce membership coherence in the database itself: the
-- membership must belong to the session's user AND to the session's active
-- organization. The (id, organization_id) unique key already exists since
-- 000097's sector locking; only the user pair is added here. Both are guarded
-- so re-running against an already-migrated base stays safe.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'memberships_id_user_key'
    ) THEN
        ALTER TABLE memberships ADD CONSTRAINT memberships_id_user_key UNIQUE (id, user_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'memberships_id_organization_key'
    ) THEN
        ALTER TABLE memberships ADD CONSTRAINT memberships_id_organization_key UNIQUE (id, organization_id);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'auth_sessions_membership_user_fk'
    ) THEN
        ALTER TABLE auth_sessions
            ADD CONSTRAINT auth_sessions_membership_user_fk
                FOREIGN KEY (membership_id, user_id)
                REFERENCES memberships (id, user_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'auth_sessions_membership_organization_fk'
    ) THEN
        ALTER TABLE auth_sessions
            ADD CONSTRAINT auth_sessions_membership_organization_fk
                FOREIGN KEY (membership_id, active_organization_id)
                REFERENCES memberships (id, organization_id);
    END IF;
END
$$;

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id, created_at DESC);
CREATE INDEX idx_auth_sessions_active_org
    ON auth_sessions(active_organization_id)
    WHERE active_organization_id IS NOT NULL;
CREATE INDEX idx_auth_sessions_absolute_expiry ON auth_sessions(absolute_expires_at);
CREATE INDEX idx_auth_sessions_open_by_user
    ON auth_sessions(user_id, absolute_expires_at)
    WHERE revoked_at IS NULL;

-- Access model (#460 SEC-1):
--   * the owning user reads and updates (last_seen, revoke, scope switch) their
--     own sessions — that is the only access the runtime request path needs;
--   * platform staff reach every row through their explicit authority
--     (app_current_user_is_platform_admin, which re-validates the live flag);
--   * organization administration of other members' sessions is NOT granted
--     here: it arrives with the SEC-2 session-directory command boundary
--     (capability-checked), never as a blanket tenant policy. An ordinary
--     member of the same organization must not read or revoke someone else's
--     session through the app role.
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY auth_session_read ON auth_sessions FOR SELECT
    USING (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
    );

CREATE POLICY auth_session_insert ON auth_sessions FOR INSERT
    WITH CHECK (user_id = app_current_user_id());

CREATE POLICY auth_session_update ON auth_sessions FOR UPDATE
    USING (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
    )
    WITH CHECK (
        user_id = app_current_user_id()
        OR app_current_user_is_platform_admin()
    );

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('auth_sessions', 'platform-global', 'self-or-platform', 'self-or-platform', 'Identity-owned revocable session registry; same-organization administration of other members sessions arrives via the SEC-2 capability-checked command boundary, not tenant RLS')
ON CONFLICT (table_name) DO UPDATE SET classification=EXCLUDED.classification, read_scope=EXCLUDED.read_scope,
 write_scope=EXCLUDED.write_scope, rationale=EXCLUDED.rationale, policy_version=rls_policy_inventory.policy_version + 1, updated_at=NOW();

GRANT SELECT, INSERT, UPDATE ON auth_sessions TO granete_app;
REVOKE DELETE ON auth_sessions FROM granete_app;
