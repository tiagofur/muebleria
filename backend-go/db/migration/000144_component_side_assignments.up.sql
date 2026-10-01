-- 000144_component_side_assignments.up.sql
-- HW-PROFILE side assignments (#915 backend): one component definition side
-- can declare which Hardware Profile applies there. The side is one of the
-- six canonical board faces (frozen by the #912 contract — no L1/W1 aliases;
-- the physical mounting face is a contact concern and the tool entry face a
-- recipe concern). Assignments live on the DEFINITION (catalog component
-- row), never an instance override.

-- ─── Table: component_side_assignments ────────────────────────────────────────

CREATE TABLE component_side_assignments (
    id              UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    component_id    UUID        NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    side            TEXT        NOT NULL
        CHECK (side IN ('front', 'back', 'left', 'right', 'top', 'bottom')),
    profile_id      UUID        NOT NULL REFERENCES hardware_profiles(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (component_id, side)
);

CREATE INDEX idx_component_side_assignments_org
    ON component_side_assignments(organization_id);

CREATE INDEX idx_component_side_assignments_component
    ON component_side_assignments(component_id);

ALTER TABLE component_side_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE component_side_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY component_side_assignments_read ON component_side_assignments
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id());

CREATE POLICY component_side_assignments_write ON component_side_assignments
    FOR ALL TO granete_app
    USING (organization_id = app_current_organization_id())
    WITH CHECK (organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON component_side_assignments TO granete_app;

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('component_side_assignments',
    'tenant-owned',
    'current-organization',
    'current-organization',
    'Component definition side assignments declare which hardware profile applies per canonical board face; strictly isolated by owning organization (#915 / HW-PROFILE)');
