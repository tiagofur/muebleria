-- #393 / DT-9: QuoteRevision and QuoteRevisionItem historical snapshots (ADR-0003,
-- digital-thread §§3, 6, 15, 16, 25).
--
-- 1. quote_revisions: immutable commercial revision snapshot per project.
--    Identified explicitly by (id, project_id) and numbered sequentially.
-- 2. quote_revision_items: immutable commercial items representing physical
--    FurnitureInstance units at the instant of the revision.
--    Composite FKs ensure items belong strictly to the SAME project.
--    Unique constraint enforces that an instance appears at most once in a revision.
--
-- Classification: explicitly-shared, following project organizations.
-- Items are immutable once written (no UPDATE/DELETE grant, trigger backstop).

CREATE TABLE quote_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision_number INT NOT NULL CHECK (revision_number >= 1),
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'accepted', 'superseded')),
    source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'imported', 'requote', 'system')),
    notes TEXT NULL,
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_quote_revisions_project_number
    ON quote_revisions(project_id, revision_number);
CREATE UNIQUE INDEX uq_quote_revisions_id_project
    ON quote_revisions(id, project_id);

CREATE INDEX idx_quote_revisions_organization ON quote_revisions(organization_id);
CREATE INDEX idx_quote_revisions_project ON quote_revisions(project_id);

ALTER TABLE quote_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_revisions FORCE ROW LEVEL SECURITY;

CREATE POLICY quote_revisions_read ON quote_revisions
    FOR SELECT TO granete_app
    USING (app_can_access_project(project_id));

CREATE POLICY quote_revisions_insert ON quote_revisions
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

CREATE POLICY quote_revisions_update ON quote_revisions
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
    BEFORE UPDATE OF organization_id, project_id ON quote_revisions
    FOR EACH ROW
    EXECUTE FUNCTION protect_shared_child_ownership('project_id');

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('quote_revisions', 'explicitly-shared', 'project-organizations', 'owner-organization', 'Project quote revisions follow the explicit project organizations; creation and updates stay with the owning organization (#393 / ADR-0003)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT, UPDATE ON quote_revisions TO granete_app;
REVOKE DELETE ON quote_revisions FROM granete_app;

-- QuoteRevisionItem: immutable historical item snapshot per physical unit.
CREATE TABLE quote_revision_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    quote_revision_id UUID NOT NULL,
    furniture_instance_id UUID NOT NULL,
    furniture_definition_id UUID NULL REFERENCES modules(id) ON DELETE SET NULL,
    definition_version INT NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    material_choices JSONB NOT NULL DEFAULT '{}'::jsonb,
    lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'removed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_quote_revision_items_revision
        FOREIGN KEY (quote_revision_id, project_id)
        REFERENCES quote_revisions(id, project_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_quote_revision_items_instance
        FOREIGN KEY (furniture_instance_id, project_id)
        REFERENCES furniture_instances(id, project_id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_quote_revision_items_rev_instance
    ON quote_revision_items(quote_revision_id, furniture_instance_id);

CREATE INDEX idx_quote_revision_items_organization ON quote_revision_items(organization_id);
CREATE INDEX idx_quote_revision_items_project ON quote_revision_items(project_id);
CREATE INDEX idx_quote_revision_items_revision ON quote_revision_items(quote_revision_id);
CREATE INDEX idx_quote_revision_items_instance ON quote_revision_items(furniture_instance_id);

ALTER TABLE quote_revision_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_revision_items FORCE ROW LEVEL SECURITY;

CREATE POLICY quote_revision_items_read ON quote_revision_items
    FOR SELECT TO granete_app
    USING (app_can_access_project(project_id));

CREATE POLICY quote_revision_items_insert ON quote_revision_items
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

CREATE TRIGGER protect_shared_child_ownership
    BEFORE UPDATE OF organization_id, project_id ON quote_revision_items
    FOR EACH ROW
    EXECUTE FUNCTION protect_shared_child_ownership('project_id');

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('quote_revision_items', 'explicitly-shared', 'project-organizations', 'owner-organization', 'Quote revision items are immutable per-instance commercial snapshots of the project (#393 / ADR-0003)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT ON quote_revision_items TO granete_app;
REVOKE UPDATE, DELETE ON quote_revision_items FROM granete_app;
