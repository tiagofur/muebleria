-- #395 / DT-11: ProductionRelease pinned to the exact approved DesignRevision
-- and its authoritative manufacturing fingerprint (ADR-0003, digital-thread
-- §§17, 21–23, 25.6, 28 Phase 8, invariant I6).
--
-- A release is productive history, never editable state: it records the exact
-- design_revision_id, the exact quote_revision_id when a commercial baseline
-- exists (both composite FKs so a release can never point at another
-- project's revisions), and the server-computed manufacturing fingerprint the
-- gates validated at commit time. Publishing newer revisions afterwards never
-- mutates an existing release (§25.6); new production requires a new release.
-- Writing a row requires the revision to be approved — enforced again by the
-- insert policy as an RLS backstop on top of the transactional gate.

CREATE TABLE production_releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    release_number INT NOT NULL CHECK (release_number >= 1),
    design_revision_id UUID NOT NULL,
    quote_revision_id UUID NULL,
    manufacturing_fingerprint TEXT NOT NULL CHECK (manufacturing_fingerprint ~ '^sha256-[0-9a-f]{64}$'),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active')),
    -- The releasing actor is durable history: user deletion is blocked while
    -- releases reference it (NOT NULL + NO ACTION), never silently nulled.
    released_by UUID NOT NULL REFERENCES users(id),
    released_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_production_releases_design_revision
        FOREIGN KEY (design_revision_id, project_id)
        REFERENCES design_revisions(id, project_id),
    CONSTRAINT fk_production_releases_quote_revision
        FOREIGN KEY (quote_revision_id, project_id)
        REFERENCES quote_revisions(id, project_id)
);

CREATE UNIQUE INDEX uq_production_releases_project_number
    ON production_releases(project_id, release_number);
CREATE UNIQUE INDEX uq_production_releases_id_project
    ON production_releases(id, project_id);
CREATE INDEX idx_production_releases_organization ON production_releases(organization_id);
CREATE INDEX idx_production_releases_project ON production_releases(project_id);
CREATE INDEX idx_production_releases_design_revision ON production_releases(design_revision_id);
CREATE INDEX idx_production_releases_quote_revision ON production_releases(quote_revision_id) WHERE quote_revision_id IS NOT NULL;

ALTER TABLE production_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_releases FORCE ROW LEVEL SECURITY;

CREATE POLICY production_releases_read ON production_releases
    FOR SELECT TO granete_app
    USING (app_can_access_project(project_id));

CREATE POLICY production_releases_insert ON production_releases
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
        AND status = 'active'
        AND EXISTS (
            SELECT 1 FROM design_revisions dr
            WHERE dr.id = design_revision_id
              AND dr.project_id = production_releases.project_id
              AND dr.status = 'approved'
        )
    );

-- A release is an immutable historical pin: no UPDATE or DELETE ever.
CREATE OR REPLACE FUNCTION protect_production_release_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'production_releases are immutable history pinned to their exact revisions (#395 / I6 / §25.6)';
END;
$$;

CREATE TRIGGER protect_production_releases_immutable
    BEFORE UPDATE OR DELETE ON production_releases
    FOR EACH ROW
    EXECUTE FUNCTION protect_production_release_immutability();

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('production_releases', 'explicitly-shared', 'project-organizations', 'owner-organization-immutable-approved-only', 'Production releases follow project organizations; only the owner organization inserts them, exclusively against an approved same-project DesignRevision, and rows are immutable history (#395 / I6 / §§17, 25.6)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT ON production_releases TO granete_app;
REVOKE UPDATE, DELETE ON production_releases FROM granete_app;
