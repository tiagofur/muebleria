-- #499 / DT-SU-1: secure Web-to-SketchUp Project/Design pairing grants.
--
-- A pairing grant is a short-lived, one-time, exact-scope handoff claim. The
-- Web surface creates it against an exact organization + Project + Design
-- (+ optional pinned base DesignRevision for user-facing context) and shows
-- the opaque code to the creating user; the SketchUp extension exchanges the
-- code through its own device credential (#460) and receives the exact
-- authorized context via the #388 model-binding validation. The code lives in
-- the database only as a SHA-256 hash and never in URLs, logs or audit rows.
--
-- Authority rules (#499 security properties):
--   * one-time: exchange is a conditional pending→exchanged UPDATE, so a
--     replayed code loses atomically instead of re-revealing context;
--   * exact scope: organization/project/design are columns; exchange runs
--     under the exchanging device's own tenant scope, so a cross-org code is
--     indistinguishable from an unknown code (uniform not-found);
--   * short TTL: expires_at is enforced at exchange time; 'expired' status
--     is derived at read time (device-enrollment poll semantics), never
--     stored;
--   * revocable: the creator cancels a pending grant (pending→cancelled);
--   * audited without the raw code: creation, exchange and cancellation
--     write security audit events whose details never include code or hash.
--
-- Classification: tenant-owned (one grant belongs to exactly one
-- organization's project/design; no cross-organization sharing).

CREATE TABLE design_pairing_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    design_id UUID NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    -- User-facing base pinned at creation; NULL when the design has no
    -- published revision yet. Never authoritative: the working copy is.
    -- The composite FK structurally pins the revision to THIS design's
    -- lineage (uq_design_revisions_id_design) — a foreign revision can
    -- never enter, even by direct SQL.
    base_revision_id UUID,
    action TEXT NOT NULL CHECK (action IN ('open_design')),
    -- sha256(normalized code): the raw code exists only in the create
    -- response. UNIQUE doubles as the exchange lookup index.
    code_hash BYTEA NOT NULL UNIQUE CHECK (length(code_hash) = 32),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'exchanged', 'cancelled')),
    expires_at TIMESTAMPTZ NOT NULL,
    -- Full provenance of the creating web session (registry sid the token
    -- carried): organization + initiating user + initiating web session +
    -- project + design + pinned base + exchanging device session is the
    -- complete correlation the audit needs. No tokens, no secrets.
    created_by UUID NOT NULL REFERENCES users(id),
    created_by_session_id UUID NOT NULL REFERENCES auth_sessions(id),
    exchanged_at TIMESTAMPTZ,
    -- Registry session of the exchanging SketchUp credential: exact
    -- attribution without storing any device secret or token.
    exchanged_by_session_id UUID REFERENCES auth_sessions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT design_pairing_grants_ttl_positive CHECK (expires_at > created_at),
    CONSTRAINT design_pairing_grants_exchange_shape CHECK (
        (status = 'exchanged') = (exchanged_at IS NOT NULL)
    ),
    CONSTRAINT design_pairing_grants_design_matches_project
        FOREIGN KEY (design_id, project_id) REFERENCES designs (id, project_id) ON DELETE CASCADE,
    CONSTRAINT design_pairing_grants_base_revision_lineage
        FOREIGN KEY (base_revision_id, design_id) REFERENCES design_revisions (id, design_id) ON DELETE CASCADE
);

-- Organization-first index: the runtime readiness gate requires every
-- non-platform-global inventory table carrying organization_id to lead at
-- least one index with it (same rule as every other tenant-owned table).
CREATE INDEX idx_design_pairing_grants_organization ON design_pairing_grants(organization_id);
CREATE INDEX idx_design_pairing_grants_design ON design_pairing_grants(design_id, created_at DESC);
CREATE INDEX idx_design_pairing_grants_pending ON design_pairing_grants(expires_at)
    WHERE status = 'pending';

ALTER TABLE design_pairing_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_pairing_grants FORCE ROW LEVEL SECURITY;

CREATE POLICY design_pairing_grant_read ON design_pairing_grants
    FOR SELECT TO granete_app
    USING (
        organization_id = app_current_organization_id()
        OR app_current_user_is_platform_admin()
    );

CREATE POLICY design_pairing_grant_insert ON design_pairing_grants
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND organization_id = app_current_organization_id()
    );

CREATE POLICY design_pairing_grant_update ON design_pairing_grants
    FOR UPDATE TO granete_app
    USING (
        organization_id = app_current_organization_id()
        OR app_current_user_is_platform_admin()
    )
    WITH CHECK (
        organization_id = app_current_organization_id()
        OR app_current_user_is_platform_admin()
    );

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('design_pairing_grants', 'tenant-owned', 'owner-organization-or-platform', 'owner-organization-or-platform', 'One-time Web-to-SketchUp handoff claims scoped to the exact org/project/design (#499); the exchange reaches a row only through the exchanging device''s own tenant scope, so foreign codes are uniformly not-found')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT, UPDATE ON design_pairing_grants TO granete_app;
REVOKE DELETE ON design_pairing_grants FROM granete_app;
