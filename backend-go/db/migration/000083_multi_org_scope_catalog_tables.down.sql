ALTER TABLE agregados DROP CONSTRAINT IF EXISTS agregados_org_code_unique;
DROP INDEX IF EXISTS idx_agregados_organization;
ALTER TABLE agregados DROP COLUMN IF EXISTS organization_id;
ALTER TABLE agregados ADD CONSTRAINT agregados_code_key UNIQUE (code);

ALTER TABLE ambient_materials DROP CONSTRAINT IF EXISTS ambient_materials_org_code_unique;
DROP INDEX IF EXISTS idx_ambient_materials_organization;
ALTER TABLE ambient_materials DROP COLUMN IF EXISTS organization_id;
ALTER TABLE ambient_materials ADD CONSTRAINT ambient_materials_code_key UNIQUE (code);

ALTER TABLE ambient_categories DROP COLUMN IF EXISTS organization_id;

ALTER TABLE components DROP CONSTRAINT IF EXISTS components_org_code_unique;
DROP INDEX IF EXISTS idx_components_organization;
ALTER TABLE components DROP COLUMN IF EXISTS organization_id;
ALTER TABLE components ADD CONSTRAINT components_code_key UNIQUE (code);

ALTER TABLE structure_components DROP COLUMN IF EXISTS organization_id;

ALTER TABLE structure_presets DROP COLUMN IF EXISTS organization_id;

ALTER TABLE structure_revisions DROP COLUMN IF EXISTS organization_id;

ALTER TABLE structures DROP CONSTRAINT IF EXISTS structures_org_code_unique;
DROP INDEX IF EXISTS idx_structures_organization;
ALTER TABLE structures DROP COLUMN IF EXISTS organization_id;
ALTER TABLE structures ADD CONSTRAINT structures_code_key UNIQUE (code);

ALTER TABLE module_presets DROP COLUMN IF EXISTS organization_id;

ALTER TABLE module_components DROP COLUMN IF EXISTS organization_id;

ALTER TABLE hardware_lines DROP COLUMN IF EXISTS organization_id;

ALTER TABLE board_parts DROP COLUMN IF EXISTS organization_id;

ALTER TABLE modules DROP CONSTRAINT IF EXISTS modules_org_code_unique;
DROP INDEX IF EXISTS idx_modules_organization;
ALTER TABLE modules DROP COLUMN IF EXISTS organization_id;
ALTER TABLE modules ADD CONSTRAINT modules_code_key UNIQUE (code);

ALTER TABLE module_categories DROP COLUMN IF EXISTS organization_id;

ALTER TABLE material_categories DROP COLUMN IF EXISTS organization_id;

ALTER TABLE option_group_members DROP COLUMN IF EXISTS organization_id;

ALTER TABLE option_groups DROP CONSTRAINT IF EXISTS option_groups_org_code_unique;
DROP INDEX IF EXISTS idx_option_groups_organization;
ALTER TABLE option_groups DROP COLUMN IF EXISTS organization_id;
ALTER TABLE option_groups ADD CONSTRAINT option_groups_code_key UNIQUE (code);

ALTER TABLE hardwares DROP CONSTRAINT IF EXISTS hardwares_org_code_unique;
DROP INDEX IF EXISTS idx_hardwares_organization;
ALTER TABLE hardwares DROP COLUMN IF EXISTS organization_id;
ALTER TABLE hardwares ADD CONSTRAINT hardwares_code_key UNIQUE (code);

ALTER TABLE edge_bands DROP CONSTRAINT IF EXISTS edge_bands_org_code_unique;
DROP INDEX IF EXISTS idx_edge_bands_organization;
ALTER TABLE edge_bands DROP COLUMN IF EXISTS organization_id;
ALTER TABLE edge_bands ADD CONSTRAINT edge_bands_code_key UNIQUE (code);

ALTER TABLE material_boards DROP CONSTRAINT IF EXISTS material_boards_org_code_unique;
DROP INDEX IF EXISTS idx_material_boards_organization;
ALTER TABLE material_boards DROP COLUMN IF EXISTS organization_id;
ALTER TABLE material_boards ADD CONSTRAINT material_boards_code_key UNIQUE (code);
