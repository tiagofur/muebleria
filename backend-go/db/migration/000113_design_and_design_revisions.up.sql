-- #387 / DT-3: Design aggregate and immutable DesignRevision snapshots (ADR-0003,
-- digital-thread §§7-10).
--
-- 1. Design: client-agnostic project-owned design aggregate. A project can
--    have 0..N designs. source_quote_revision_id expresses provenance only,
--    never ownership.
-- 2. DesignRevision: immutable published snapshot of spatial/authoring truth
--    (I4, I12). Numbered sequentially per design. parent_revision_id must
--    belong to the same design (structurally enforced by composite FK).
-- 3. DesignRevisionItem: authoring snapshot per physical FurnitureInstance (I2, I9).
--    Composite FKs structurally enforce that items can ONLY link FurnitureInstances
--    of the SAME project. Duplicate FI within one revision is rejected by unique index.
--
-- Classification: explicitly-shared, following project organizations.
-- Revisions and items are immutable once published (no UPDATE/DELETE grant, trigger backstop).

CREATE TABLE designs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    source_quote_revision_id UUID NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT designs_updated_after_created CHECK (updated_at >= created_at)
);

CREATE INDEX idx_designs_organization ON designs(organization_id);
CREATE INDEX idx_designs_project ON designs(project_id);
CREATE UNIQUE INDEX uq_designs_id_project ON designs(id, project_id);

ALTER TABLE designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE designs FORCE ROW LEVEL SECURITY;

CREATE POLICY design_read ON designs
    FOR SELECT TO granete_app
    USING (app_can_access_project(project_id));

CREATE POLICY design_insert ON designs
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

CREATE POLICY design_update ON designs
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

CREATE TRIGGER protect_shared_child_ownership
    BEFORE UPDATE OF organization_id, project_id ON designs
    FOR EACH ROW
    EXECUTE FUNCTION protect_shared_child_ownership('project_id');

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('designs', 'explicitly-shared', 'project-organizations', 'owner-organization', 'Project designs follow the explicit project organizations; creation and updates stay with the owning organization (#387 / ADR-0003)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT, UPDATE ON designs TO granete_app;
REVOKE DELETE ON designs FROM granete_app;

-- DesignRevision: immutable published snapshot.
CREATE TABLE design_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    design_id UUID NOT NULL,
    revision_number INT NOT NULL CHECK (revision_number >= 1),
    parent_revision_id UUID NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('sketchup', 'proyectar', 'import', 'system')),
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'approved', 'superseded')),
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_design_revisions_design_project
        FOREIGN KEY (design_id, project_id)
        REFERENCES designs(id, project_id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_design_revisions_design_number
    ON design_revisions(design_id, revision_number);
CREATE UNIQUE INDEX uq_design_revisions_id_design
    ON design_revisions(id, design_id);
CREATE UNIQUE INDEX uq_design_revisions_id_project
    ON design_revisions(id, project_id);

-- Parent revision must belong to the same design (composite FK).
ALTER TABLE design_revisions
    ADD CONSTRAINT fk_design_revisions_parent
    FOREIGN KEY (parent_revision_id, design_id)
    REFERENCES design_revisions(id, design_id);

CREATE INDEX idx_design_revisions_organization ON design_revisions(organization_id);
CREATE INDEX idx_design_revisions_project ON design_revisions(project_id);
CREATE INDEX idx_design_revisions_design ON design_revisions(design_id);
CREATE INDEX idx_design_revisions_parent ON design_revisions(parent_revision_id) WHERE parent_revision_id IS NOT NULL;

ALTER TABLE design_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_revisions FORCE ROW LEVEL SECURITY;

CREATE POLICY design_revisions_read ON design_revisions
    FOR SELECT TO granete_app
    USING (app_can_access_project(project_id));

CREATE POLICY design_revisions_insert ON design_revisions
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
        AND status = 'published'
    );

CREATE OR REPLACE FUNCTION protect_design_revision_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'design_revisions is immutable once published';
END;
$$;

CREATE TRIGGER protect_design_revisions_immutable
    BEFORE UPDATE OR DELETE ON design_revisions
    FOR EACH ROW
    EXECUTE FUNCTION protect_design_revision_immutability();

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('design_revisions', 'explicitly-shared', 'project-organizations', 'owner-organization-immutable', 'Published design revisions are immutable snapshots following project organizations (#387 / I4 / I12)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT ON design_revisions TO granete_app;
REVOKE UPDATE, DELETE ON design_revisions FROM granete_app;

-- DesignRevisionItem: authoring snapshot of one FurnitureInstance in a revision.
CREATE TABLE design_revision_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    design_revision_id UUID NOT NULL,
    furniture_instance_id UUID NOT NULL,
    furniture_definition_id UUID NULL REFERENCES modules(id) ON DELETE SET NULL,
    definition_version TEXT NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    material_choices JSONB NOT NULL DEFAULT '{}'::jsonb,
    transform JSONB NOT NULL,
    room_id TEXT NULL,
    technical_client_locator JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Structural same-project invariant: item, revision and furniture instance
    -- must all share the same project_id.
    CONSTRAINT fk_design_revision_items_revision
        FOREIGN KEY (design_revision_id, project_id)
        REFERENCES design_revisions(id, project_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_design_revision_items_instance
        FOREIGN KEY (furniture_instance_id, project_id)
        REFERENCES furniture_instances(id, project_id)
        ON DELETE CASCADE
);

-- Maximum 1 occurrence of any physical unit within ONE DesignRevision (Invariant §11).
CREATE UNIQUE INDEX uq_design_revision_items_revision_instance
    ON design_revision_items(design_revision_id, furniture_instance_id);

CREATE INDEX idx_design_revision_items_organization ON design_revision_items(organization_id);
CREATE INDEX idx_design_revision_items_project ON design_revision_items(project_id);
CREATE INDEX idx_design_revision_items_revision ON design_revision_items(design_revision_id);
CREATE INDEX idx_design_revision_items_instance ON design_revision_items(furniture_instance_id);

ALTER TABLE design_revision_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_revision_items FORCE ROW LEVEL SECURITY;

CREATE POLICY design_revision_items_read ON design_revision_items
    FOR SELECT TO granete_app
    USING (app_can_access_project(project_id));

CREATE POLICY design_revision_items_insert ON design_revision_items
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

CREATE OR REPLACE FUNCTION protect_design_revision_item_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'design_revision_items is immutable';
END;
$$;

CREATE TRIGGER protect_design_revision_items_immutable
    BEFORE UPDATE OR DELETE ON design_revision_items
    FOR EACH ROW
    EXECUTE FUNCTION protect_design_revision_item_immutability();

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('design_revision_items', 'explicitly-shared', 'project-organizations', 'owner-organization-immutable', 'Design revision items capture the authoring snapshot of furniture instances within an immutable revision (#387 / I4 / I12)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT ON design_revision_items TO granete_app;
REVOKE UPDATE, DELETE ON design_revision_items FROM granete_app;
