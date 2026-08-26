-- ADR-0004 / #325: row-level scoping for catalog tables.
-- Catalogs are cloned per organization from the platform base (the initial
-- org's catalog acts as the base until a dedicated platform catalog exists).
-- Catalog codes become unique per organization: the same "MOD-GAB-01" can
-- exist in two talleres without colliding.
-- TRANSITIONAL: organization_id keeps a DEFAULT to the initial org until F170
-- scopes catalog writes explicitly and drops it.

ALTER TABLE material_boards
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_material_boards_organization ON material_boards(organization_id);
ALTER TABLE material_boards DROP CONSTRAINT IF EXISTS material_boards_code_key;
ALTER TABLE material_boards
    ADD CONSTRAINT material_boards_org_code_unique UNIQUE (organization_id, code);

ALTER TABLE edge_bands
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_edge_bands_organization ON edge_bands(organization_id);
ALTER TABLE edge_bands DROP CONSTRAINT IF EXISTS edge_bands_code_key;
ALTER TABLE edge_bands
    ADD CONSTRAINT edge_bands_org_code_unique UNIQUE (organization_id, code);

ALTER TABLE hardwares
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_hardwares_organization ON hardwares(organization_id);
ALTER TABLE hardwares DROP CONSTRAINT IF EXISTS hardwares_code_key;
ALTER TABLE hardwares
    ADD CONSTRAINT hardwares_org_code_unique UNIQUE (organization_id, code);

ALTER TABLE option_groups
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_option_groups_organization ON option_groups(organization_id);
ALTER TABLE option_groups DROP CONSTRAINT IF EXISTS option_groups_code_key;
ALTER TABLE option_groups
    ADD CONSTRAINT option_groups_org_code_unique UNIQUE (organization_id, code);

ALTER TABLE option_group_members
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE material_categories
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE module_categories
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE modules
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_modules_organization ON modules(organization_id);
ALTER TABLE modules DROP CONSTRAINT IF EXISTS modules_code_key;
ALTER TABLE modules
    ADD CONSTRAINT modules_org_code_unique UNIQUE (organization_id, code);

ALTER TABLE board_parts
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE hardware_lines
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE module_components
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE module_presets
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE structures
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_structures_organization ON structures(organization_id);
ALTER TABLE structures DROP CONSTRAINT IF EXISTS structures_code_key;
ALTER TABLE structures
    ADD CONSTRAINT structures_org_code_unique UNIQUE (organization_id, code);

ALTER TABLE structure_revisions
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE structure_presets
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE structure_components
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE components
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_components_organization ON components(organization_id);
ALTER TABLE components DROP CONSTRAINT IF EXISTS components_code_key;
ALTER TABLE components
    ADD CONSTRAINT components_org_code_unique UNIQUE (organization_id, code);

ALTER TABLE ambient_categories
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE ambient_materials
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_ambient_materials_organization ON ambient_materials(organization_id);
ALTER TABLE ambient_materials DROP CONSTRAINT IF EXISTS ambient_materials_code_key;
ALTER TABLE ambient_materials
    ADD CONSTRAINT ambient_materials_org_code_unique UNIQUE (organization_id, code);

ALTER TABLE agregados
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_agregados_organization ON agregados(organization_id);
ALTER TABLE agregados DROP CONSTRAINT IF EXISTS agregados_code_key;
ALTER TABLE agregados
    ADD CONSTRAINT agregados_org_code_unique UNIQUE (organization_id, code);
