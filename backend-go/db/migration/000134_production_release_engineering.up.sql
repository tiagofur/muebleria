-- #740 PR 1: durable Engineering state bound to the EXACT ProductionRelease.
-- Absent row = pending. The row records the server-timestamped, actor-attributed
-- start and (later) completion of the engineering preparation of that release.
-- The legacy projects.engineering_log JSONB stays untouched (pre-DT
-- compatibility); it is never migrated onto a release without provable
-- release-scoped provenance.

CREATE TABLE production_release_engineering (
    release_id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
    started_by UUID NOT NULL REFERENCES users(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_release_engineering_owner
        FOREIGN KEY (release_id, project_id, organization_id)
        REFERENCES production_releases(id, project_id, organization_id),
    CONSTRAINT engineering_completion_shape CHECK (
        (status = 'in_progress' AND completed_by IS NULL AND completed_at IS NULL)
        OR (status = 'completed' AND completed_by IS NOT NULL AND completed_at IS NOT NULL)
    )
);
CREATE INDEX idx_release_engineering_owner_project
    ON production_release_engineering(organization_id, project_id);

ALTER TABLE production_release_engineering ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_release_engineering FORCE ROW LEVEL SECURITY;

CREATE POLICY release_engineering_read ON production_release_engineering
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id() AND app_can_access_project(project_id));

CREATE POLICY release_engineering_insert ON production_release_engineering
    FOR INSERT TO granete_app
    WITH CHECK (
        organization_id = app_current_organization_id()
        AND app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND EXISTS (
            SELECT 1 FROM production_releases pr
            WHERE pr.id = release_id
              AND pr.project_id = production_release_engineering.project_id
              AND pr.organization_id = production_release_engineering.organization_id
        )
    );

CREATE POLICY release_engineering_update ON production_release_engineering
    FOR UPDATE TO granete_app
    USING (organization_id = app_current_organization_id() AND app_can_access_project(project_id))
    WITH CHECK (organization_id = app_current_organization_id());

-- Controlled transitions only: identity columns are immutable, completion is
-- one-way, and version advances by exactly 1 on every accepted transition.
-- Rows are durable history: no deletes.
CREATE FUNCTION protect_release_engineering_transitions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'release engineering rows are durable history (#740)';
    END IF;
    IF NEW.release_id <> OLD.release_id OR NEW.project_id <> OLD.project_id
       OR NEW.organization_id <> OLD.organization_id
       OR NEW.started_by <> OLD.started_by OR NEW.started_at <> OLD.started_at THEN
        RAISE EXCEPTION 'release engineering identity is immutable (#740)';
    END IF;
    IF OLD.status = 'completed' THEN
        RAISE EXCEPTION 'release engineering completion is final (#740)';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'release engineering version must advance by 1 (#740)';
    END IF;
    IF NEW.status = 'completed' AND (NEW.completed_by IS NULL OR NEW.completed_at IS NULL) THEN
        RAISE EXCEPTION 'completion requires actor and timestamp (#740)';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_release_engineering_transitions_trigger
    BEFORE UPDATE OR DELETE ON production_release_engineering
    FOR EACH ROW EXECUTE FUNCTION protect_release_engineering_transitions();

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('production_release_engineering', 'tenant-owned', 'owner-organization',
    'owner-organization-versioned', 'Durable per-release Engineering start/completion evidence (#740); server-authored only, release-exact, never cross-org');

GRANT SELECT, INSERT, UPDATE ON production_release_engineering TO granete_app;
REVOKE DELETE, TRUNCATE ON production_release_engineering FROM granete_app;
