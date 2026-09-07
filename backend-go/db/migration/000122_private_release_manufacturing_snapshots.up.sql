-- #577: private manufacturing facts must not inherit shared release visibility.
-- Preparatory persistence only: no capture writes or backfill in this migration.
CREATE UNIQUE INDEX uq_production_releases_id_project_owner
    ON production_releases(id, project_id, organization_id);

CREATE TABLE production_release_manufacturing_snapshots (
    release_id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    schema_version INT NOT NULL CHECK (schema_version >= 1),
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_release_manufacturing_snapshot_owner
        FOREIGN KEY (release_id, project_id, organization_id)
        REFERENCES production_releases(id, project_id, organization_id)
);
CREATE INDEX idx_release_manufacturing_snapshots_owner_project
    ON production_release_manufacturing_snapshots(organization_id, project_id);

ALTER TABLE production_release_manufacturing_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_release_manufacturing_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY release_manufacturing_snapshots_read ON production_release_manufacturing_snapshots
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id() AND app_can_access_project(project_id));

CREATE POLICY release_manufacturing_snapshots_insert ON production_release_manufacturing_snapshots
    FOR INSERT TO granete_app
    WITH CHECK (
        organization_id = app_current_organization_id()
        AND app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND EXISTS (
            SELECT 1 FROM production_releases pr
            WHERE pr.id = release_id
              AND pr.project_id = production_release_manufacturing_snapshots.project_id
              AND pr.organization_id = production_release_manufacturing_snapshots.organization_id
        )
    );

CREATE FUNCTION protect_release_manufacturing_snapshot_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'production release manufacturing snapshots are immutable history (#577)';
END;
$$;
CREATE TRIGGER protect_release_manufacturing_snapshots_immutable
    BEFORE UPDATE OR DELETE ON production_release_manufacturing_snapshots
    FOR EACH ROW EXECUTE FUNCTION protect_release_manufacturing_snapshot_immutability();

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('production_release_manufacturing_snapshots', 'tenant-owned', 'owner-organization',
    'owner-organization-immutable', 'Private catalog and manufacturing facts pinned to an exact owner release; shared project access never exposes payload (#577)');

GRANT SELECT, INSERT ON production_release_manufacturing_snapshots TO granete_app;
REVOKE UPDATE, DELETE, TRUNCATE ON production_release_manufacturing_snapshots FROM granete_app;
