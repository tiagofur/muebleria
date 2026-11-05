-- #1507: hierarchical hardware categories (subgrupos de herrajes, mirror of
-- material_categories from F142 / ambient_categories from F086) plus the
-- hardware category link and free-form brand label. organization_id is baked
-- in from day one (materials needed a later backfill in 000083). Tenant RLS
-- follows the 000094 catalog-taxonomy discipline (same policies as
-- material_categories; physical delete is part of the category ABM).
CREATE TABLE IF NOT EXISTS hardware_categories (
    id TEXT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    parent_id TEXT REFERENCES hardware_categories(id) ON DELETE RESTRICT,
    sort_order INT NOT NULL DEFAULT 0,
    organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hardware_categories_parent
    ON hardware_categories (parent_id);

CREATE INDEX IF NOT EXISTS idx_hardware_categories_organization
    ON hardware_categories (organization_id);

ALTER TABLE hardware_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE hardware_categories FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON hardware_categories;
CREATE POLICY tenant_isolation ON hardware_categories
    USING (app_has_organization_access(organization_id))
    WITH CHECK (app_has_organization_access(organization_id));

INSERT INTO rls_policy_inventory
    (table_name, classification, read_scope, write_scope, rationale)
VALUES
    ('hardware_categories', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog taxonomy for hardware (#1507): org-scoped, no cross-tenant sharing, physical delete guarded by children in the app layer')
ON CONFLICT (table_name) DO UPDATE SET
    classification = EXCLUDED.classification,
    read_scope = EXCLUDED.read_scope,
    write_scope = EXCLUDED.write_scope,
    rationale = EXCLUDED.rationale,
    policy_version = rls_policy_inventory.policy_version + 1,
    updated_at = NOW();

ALTER TABLE hardwares
    ADD COLUMN IF NOT EXISTS category_id TEXT
        REFERENCES hardware_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hardwares_category
    ON hardwares (category_id);

-- Free-form manufacturer/series label (#1507, e.g. "Blum"). Nullable: unset =
-- sin marca; no purchase or machining meaning.
ALTER TABLE hardwares
    ADD COLUMN IF NOT EXISTS brand TEXT;
