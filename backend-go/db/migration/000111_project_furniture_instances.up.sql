-- #385 / DT-1: stable project-owned furniture identity (ADR-0003).
--
-- FurnitureInstance is the stable business identity of ONE intended physical
-- furniture unit owned by exactly one Project. QuoteLine (#386),
-- DesignRevisionItem (#387+), SketchUp locators and production rows reference
-- this identity; none of them replaces it. The identity is not derived from
-- position, name, dimensions, parameters, SketchUp persistent_id or the
-- catalog definition: two identical physical units keep distinct rows (I2),
-- and configuration changes preserve the identity (I9).
--
-- The row stores identity/provenance/lifecycle ONLY. Quote data, design
-- state, transforms, BOM, machining and production state belong to their
-- owning revisions/contexts — FurnitureInstance must not become a mutable
-- mega-snapshot (digital-thread §5).
--
-- Classification: explicitly-shared, like project_items. Reads follow every
-- organization explicitly named by the project (owner/sales/manufacturing);
-- writes require the project's owning organization.

CREATE TABLE furniture_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Denormalized owning organization = projects.organization_id. The RLS
    -- insert check requires the match (app_shared_child_matches_project) and
    -- the ownership trigger below keeps it immutable, so an instance can
    -- never migrate projects or organizations through a plain UPDATE.
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- Optional catalog provenance. ON DELETE SET NULL: identity must survive
    -- catalog cleanup — the definition is provenance, never the identity.
    furniture_definition_id UUID NULL REFERENCES modules(id) ON DELETE SET NULL,
    origin TEXT NOT NULL CHECK (origin IN ('quote', 'design', 'manual', 'import', 'duplicate')),
    -- duplicate provenance (I8): the instance this one was copied from.
    origin_furniture_instance_id UUID NULL REFERENCES furniture_instances(id) ON DELETE SET NULL,
    -- Minimal lifecycle (digital-thread §5). removed/cancelled are terminal:
    -- IDs are never reused for replacement units (anti-pattern 12).
    lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'removed', 'cancelled')),
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT furniture_instances_updated_after_created CHECK (updated_at >= created_at)
);

CREATE INDEX idx_furniture_instances_organization ON furniture_instances(organization_id);
CREATE INDEX idx_furniture_instances_project ON furniture_instances(project_id);
CREATE INDEX idx_furniture_instances_origin_source
    ON furniture_instances(origin_furniture_instance_id)
    WHERE origin_furniture_instance_id IS NOT NULL;

ALTER TABLE furniture_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE furniture_instances FORCE ROW LEVEL SECURITY;

CREATE POLICY project_explicit_organizations ON furniture_instances
    USING (app_can_access_project(project_id))
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
    );

CREATE TRIGGER protect_shared_child_ownership
    BEFORE UPDATE OF organization_id, project_id ON furniture_instances
    FOR EACH ROW
    EXECUTE FUNCTION protect_shared_child_ownership('project_id');

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('furniture_instances', 'explicitly-shared', 'project-organizations', 'project-organizations', 'Project-owned furniture identity follows the explicit project organizations; creation/removal stays with the owning organization')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

-- No DELETE grant: instances follow a soft lifecycle and identity is never
-- recycled; only the project cascade may remove rows physically.
GRANT SELECT, INSERT, UPDATE ON furniture_instances TO granete_app;
REVOKE DELETE ON furniture_instances FROM granete_app;
