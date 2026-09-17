-- #670 Increment B: versioned Agregado recipes & published assembly snapshots.
-- (Spec: docs/architecture/hardware-3d-assets-and-assemblies.md; refs #670)
--
-- 1. agregados gains:
--    - composite uniqueness (organization_id, id) for cross-tenant foreign key protection.
--    - current_revision_id UUID NULL referencing the latest mutable catalog revision pointer.
-- 2. agregado_revisions: immutable per-version recipe definitions (components with
--    parametric overrides, hardware lines, commercial kit hardware id, rigid members,
--    variant sets, compatibility rules, reference dimensions).
--    Append-only; once written, rows cannot be updated or deleted.
-- 3. published_assembly_snapshots: frozen deterministic resolution results with
--    exact dimensions, selected variants, rigid members with #668 visual pins,
--    fabricated components, and BOM lines. Never re-evaluates at read time.
-- 4. design_revision_assembly_snapshots: pins frozen at DesignRevision publish
--    time ({design_revision_id, agregado_id, slot_key} -> snapshot_id).
--    Historical designs stay pinned to their original published snapshots.
--
-- Classification: agregado_revisions and published_assembly_snapshots are tenant-owned;
-- design_revision_assembly_snapshots follows the design family (explicitly shared).

CREATE UNIQUE INDEX IF NOT EXISTS uq_agregados_organization_id
    ON agregados (organization_id, id);

-- Immutability guard for append-only tables in this migration.
CREATE OR REPLACE FUNCTION protect_agregado_assembly_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is immutable once written', TG_TABLE_NAME;
END;
$$;

-- 1. Immutable Agregado Recipe Revisions -------------------------------------

CREATE TABLE agregado_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    agregado_id TEXT NOT NULL,
    revision_number INT NOT NULL CHECK (revision_number >= 1),
    recipe JSONB NOT NULL,
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_agregado_revisions_agregado
        FOREIGN KEY (organization_id, agregado_id)
        REFERENCES agregados (organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT uq_agregado_revisions_number UNIQUE (agregado_id, revision_number),
    CONSTRAINT uq_agregado_revisions_id_agregado UNIQUE (id, agregado_id),
    CONSTRAINT uq_agregado_revisions_org_id UNIQUE (organization_id, id)
);

CREATE INDEX idx_agregado_revisions_organization ON agregado_revisions(organization_id);
CREATE INDEX idx_agregado_revisions_agregado ON agregado_revisions(agregado_id);

ALTER TABLE agregado_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agregado_revisions FORCE ROW LEVEL SECURITY;

CREATE POLICY agregado_revisions_read ON agregado_revisions
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id());

CREATE POLICY agregado_revisions_insert ON agregado_revisions
    FOR INSERT TO granete_app
    WITH CHECK (organization_id = app_current_organization_id());

CREATE TRIGGER protect_agregado_revisions_immutable
    BEFORE UPDATE OR DELETE ON agregado_revisions
    FOR EACH ROW
    EXECUTE FUNCTION protect_agregado_assembly_immutability();

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('agregado_revisions', 'tenant-owned', 'owner-organization', 'owner-organization-immutable', 'Immutable Agregado recipe revisions (#670 Increment B); history cannot be mutated once written')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT ON agregado_revisions TO granete_app;
REVOKE UPDATE, DELETE ON agregado_revisions FROM granete_app;

-- 2. Agregados current revision pointer --------------------------------------

ALTER TABLE agregados
    ADD COLUMN current_revision_id UUID NULL,
    ADD CONSTRAINT fk_agregados_current_revision
        FOREIGN KEY (current_revision_id, id)
        REFERENCES agregado_revisions (id, agregado_id)
        ON DELETE SET NULL;

CREATE INDEX idx_agregados_current_revision ON agregados(current_revision_id)
    WHERE current_revision_id IS NOT NULL;

-- 3. Published Assembly Snapshots --------------------------------------------

CREATE TABLE published_assembly_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    agregado_id TEXT NOT NULL,
    agregado_revision_id UUID NOT NULL,
    agregado_revision_number INT NOT NULL CHECK (agregado_revision_number >= 1),
    resolved_width_mm DOUBLE PRECISION NOT NULL,
    resolved_depth_mm DOUBLE PRECISION NOT NULL,
    resolved_height_mm DOUBLE PRECISION NOT NULL,
    payload_hash TEXT NOT NULL,
    snapshot JSONB NOT NULL,
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_published_assembly_snapshots_agregado
        FOREIGN KEY (organization_id, agregado_id)
        REFERENCES agregados (organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_published_assembly_snapshots_revision
        FOREIGN KEY (agregado_revision_id, agregado_id)
        REFERENCES agregado_revisions (id, agregado_id)
        ON DELETE RESTRICT,
    CONSTRAINT uq_published_assembly_snapshots_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_published_assembly_snapshots_payload_hash UNIQUE (organization_id, payload_hash)
);

CREATE INDEX idx_published_assembly_snapshots_org ON published_assembly_snapshots(organization_id);
CREATE INDEX idx_published_assembly_snapshots_agregado ON published_assembly_snapshots(agregado_id);
CREATE INDEX idx_published_assembly_snapshots_revision ON published_assembly_snapshots(agregado_revision_id);
CREATE INDEX idx_published_assembly_snapshots_hash ON published_assembly_snapshots(organization_id, payload_hash);

ALTER TABLE published_assembly_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE published_assembly_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY published_assembly_snapshots_read ON published_assembly_snapshots
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id());

CREATE POLICY published_assembly_snapshots_insert ON published_assembly_snapshots
    FOR INSERT TO granete_app
    WITH CHECK (organization_id = app_current_organization_id());

CREATE TRIGGER protect_published_assembly_snapshots_immutable
    BEFORE UPDATE OR DELETE ON published_assembly_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION protect_agregado_assembly_immutability();

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('published_assembly_snapshots', 'tenant-owned', 'owner-organization', 'owner-organization-immutable', 'Frozen published assembly snapshots (#670 Increment B); verified deterministic results with visual pins')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT ON published_assembly_snapshots TO granete_app;
REVOKE UPDATE, DELETE ON published_assembly_snapshots FROM granete_app;

-- 4. DesignRevision Assembly Snapshot Pins -----------------------------------

CREATE TABLE design_revision_assembly_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    design_revision_id UUID NOT NULL,
    furniture_instance_id UUID NULL,
    agregado_id TEXT NOT NULL,
    slot_key TEXT NOT NULL DEFAULT '',
    snapshot_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_design_revision_assembly_snapshots_revision
        FOREIGN KEY (design_revision_id, project_id)
        REFERENCES design_revisions (id, project_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_design_revision_assembly_snapshots_snapshot
        FOREIGN KEY (organization_id, snapshot_id)
        REFERENCES published_assembly_snapshots (organization_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_design_revision_assembly_snapshots_instance
    ON design_revision_assembly_snapshots (design_revision_id, furniture_instance_id, slot_key)
    WHERE furniture_instance_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_design_revision_assembly_snapshots_no_instance
    ON design_revision_assembly_snapshots (design_revision_id, agregado_id, slot_key)
    WHERE furniture_instance_id IS NULL;

CREATE INDEX idx_design_revision_assembly_snapshots_org ON design_revision_assembly_snapshots(organization_id);
CREATE INDEX idx_design_revision_assembly_snapshots_project ON design_revision_assembly_snapshots(project_id);
CREATE INDEX idx_design_revision_assembly_snapshots_revision ON design_revision_assembly_snapshots(design_revision_id);
CREATE INDEX idx_design_revision_assembly_snapshots_snapshot ON design_revision_assembly_snapshots(snapshot_id);

ALTER TABLE design_revision_assembly_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_revision_assembly_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY design_revision_assembly_snapshots_read ON design_revision_assembly_snapshots
    FOR SELECT TO granete_app
    USING (app_can_access_project(project_id));

CREATE POLICY design_revision_assembly_snapshots_insert ON design_revision_assembly_snapshots
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

CREATE TRIGGER protect_design_revision_assembly_snapshots_immutable
    BEFORE UPDATE OR DELETE ON design_revision_assembly_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION protect_agregado_assembly_immutability();

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('design_revision_assembly_snapshots', 'explicitly-shared', 'project-organizations', 'owner-organization-immutable', 'Assembly snapshot pins frozen at DesignRevision publish (#670 Increment B); immutable historical references')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT ON design_revision_assembly_snapshots TO granete_app;
REVOKE UPDATE, DELETE ON design_revision_assembly_snapshots FROM granete_app;
