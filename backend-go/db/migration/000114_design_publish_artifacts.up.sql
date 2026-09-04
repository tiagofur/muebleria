-- #392 / DT-8: staged publish sessions + design revision artifacts
-- (ADR-0003, digital-thread §§17-18, 21, 26, 28).
--
-- 1. design_publish_sessions: staging rows for the prepare → upload →
--    finalize publication flow. A session pins the exact base revision the
--    client prepared against; finalize re-validates it under the design lock
--    so a publish that raced another client is rejected, never silently
--    rebased. Sessions expire; expired prepared sessions are abandoned
--    lazily and their staged files removed best-effort.
-- 2. design_publish_artifacts: staging metadata for uploaded artifacts
--    (storage key, MIME, size, SHA-256). Staging rows are mutable only while
--    the session is prepared (re-upload replaces).
-- 3. design_revision_artifacts: final immutable artifact metadata linked to
--    a published DesignRevision. Heavy bytes live on the filesystem under
--    the organization-partitioned media namespace; only metadata is
--    relational (ADR-0004 layout).
--
-- Classification: explicitly-shared, following project organizations, same
-- as the rest of the design family (000113).

CREATE TABLE design_publish_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    design_id UUID NOT NULL,
    base_revision_id UUID NULL,
    source JSONB NOT NULL,
    manifest JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'finalized', 'abandoned')),
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    finalized_at TIMESTAMPTZ NULL,
    finalized_revision_id UUID NULL,
    CONSTRAINT fk_design_publish_sessions_design
        FOREIGN KEY (design_id, project_id)
        REFERENCES designs(id, project_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_design_publish_sessions_base_revision
        FOREIGN KEY (base_revision_id, design_id)
        REFERENCES design_revisions(id, design_id),
    CONSTRAINT fk_design_publish_sessions_finalized_revision
        FOREIGN KEY (finalized_revision_id, design_id)
        REFERENCES design_revisions(id, design_id)
);

CREATE INDEX idx_design_publish_sessions_organization ON design_publish_sessions(organization_id);
CREATE INDEX idx_design_publish_sessions_project ON design_publish_sessions(project_id);
CREATE INDEX idx_design_publish_sessions_design ON design_publish_sessions(design_id);
CREATE INDEX idx_design_publish_sessions_finalized_revision ON design_publish_sessions(finalized_revision_id)
    WHERE finalized_revision_id IS NOT NULL;
-- Lazy expiry sweep lookup.
CREATE INDEX idx_design_publish_sessions_expired
    ON design_publish_sessions(design_id, expires_at)
    WHERE status = 'prepared';

ALTER TABLE design_publish_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_publish_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY design_publish_sessions_read ON design_publish_sessions
    FOR SELECT TO granete_app
    USING (app_can_access_project(project_id));

CREATE POLICY design_publish_sessions_insert ON design_publish_sessions
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

-- Only owner-org rows may transition status (finalize/abandon); ownership
-- columns themselves are immutable.
CREATE POLICY design_publish_sessions_update ON design_publish_sessions
    FOR UPDATE TO granete_app
    USING (
        app_can_access_project(project_id)
        AND organization_id = app_current_organization_id()
    )
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

CREATE TRIGGER protect_shared_child_ownership_publish_sessions
    BEFORE UPDATE OF organization_id, project_id ON design_publish_sessions
    FOR EACH ROW
    EXECUTE FUNCTION protect_shared_child_ownership('project_id');

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('design_publish_sessions', 'explicitly-shared', 'project-organizations', 'owner-organization', 'Staged publish sessions pin the base revision and manifest the client prepared against; only the owner organization may advance or abandon them (#392 / DT-8)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT, UPDATE ON design_publish_sessions TO granete_app;
REVOKE DELETE ON design_publish_sessions FROM granete_app;

-- Staging artifact metadata: one row per (session, kind) with replace
-- semantics while the session is prepared.
CREATE TABLE design_publish_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES design_publish_sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('model', 'manifest', 'preview')),
    storage_key TEXT NOT NULL CHECK (char_length(storage_key) BETWEEN 12 AND 512),
    content_type TEXT NOT NULL CHECK (char_length(content_type) BETWEEN 3 AND 255),
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL CHECK (sha256 ~ '^sha256-[0-9a-f]{64}$'),
    uploaded_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_design_publish_artifacts_session_kind UNIQUE (session_id, kind)
);

CREATE INDEX idx_design_publish_artifacts_organization ON design_publish_artifacts(organization_id);
CREATE INDEX idx_design_publish_artifacts_project ON design_publish_artifacts(project_id);
CREATE INDEX idx_design_publish_artifacts_session ON design_publish_artifacts(session_id);

ALTER TABLE design_publish_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_publish_artifacts FORCE ROW LEVEL SECURITY;

CREATE POLICY design_publish_artifacts_read ON design_publish_artifacts
    FOR SELECT TO granete_app
    USING (app_can_access_project(project_id));

CREATE POLICY design_publish_artifacts_insert ON design_publish_artifacts
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

CREATE POLICY design_publish_artifacts_update ON design_publish_artifacts
    FOR UPDATE TO granete_app
    USING (
        app_can_access_project(project_id)
        AND organization_id = app_current_organization_id()
    )
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

CREATE POLICY design_publish_artifacts_delete ON design_publish_artifacts
    FOR DELETE TO granete_app
    USING (
        app_can_access_project(project_id)
        AND organization_id = app_current_organization_id()
    );

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('design_publish_artifacts', 'explicitly-shared', 'project-organizations', 'owner-organization', 'Staging artifact metadata for a prepared publish session; replaceable until the session finalizes or is abandoned (#392 / DT-8)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT, UPDATE, DELETE ON design_publish_artifacts TO granete_app;

-- Final artifact metadata linked to an immutable DesignRevision. Bytes stay
-- on the filesystem; these rows are immutable once written (I4/I12).
CREATE TABLE design_revision_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    design_revision_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('model', 'manifest', 'preview')),
    storage_key TEXT NOT NULL CHECK (char_length(storage_key) BETWEEN 12 AND 512),
    content_type TEXT NOT NULL CHECK (char_length(content_type) BETWEEN 3 AND 255),
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL CHECK (sha256 ~ '^sha256-[0-9a-f]{64}$'),
    uploaded_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_design_revision_artifacts_revision
        FOREIGN KEY (design_revision_id, project_id)
        REFERENCES design_revisions(id, project_id)
        ON DELETE CASCADE,
    CONSTRAINT uq_design_revision_artifacts_revision_kind UNIQUE (design_revision_id, kind)
);

CREATE INDEX idx_design_revision_artifacts_organization ON design_revision_artifacts(organization_id);
CREATE INDEX idx_design_revision_artifacts_project ON design_revision_artifacts(project_id);
CREATE INDEX idx_design_revision_artifacts_revision ON design_revision_artifacts(design_revision_id);

ALTER TABLE design_revision_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_revision_artifacts FORCE ROW LEVEL SECURITY;

CREATE POLICY design_revision_artifacts_read ON design_revision_artifacts
    FOR SELECT TO granete_app
    USING (app_can_access_project(project_id));

CREATE POLICY design_revision_artifacts_insert ON design_revision_artifacts
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

CREATE OR REPLACE FUNCTION protect_design_revision_artifact_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'design_revision_artifacts is immutable once published';
END;
$$;

CREATE TRIGGER protect_design_revision_artifacts_immutable
    BEFORE UPDATE OR DELETE ON design_revision_artifacts
    FOR EACH ROW
    EXECUTE FUNCTION protect_design_revision_artifact_immutability();

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('design_revision_artifacts', 'explicitly-shared', 'project-organizations', 'owner-organization-immutable', 'Published design revision artifact metadata (storage key, MIME, size, SHA-256) is immutable like the revision it belongs to (#392 / I4 / I12)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT ON design_revision_artifacts TO granete_app;
REVOKE UPDATE, DELETE ON design_revision_artifacts FROM granete_app;
