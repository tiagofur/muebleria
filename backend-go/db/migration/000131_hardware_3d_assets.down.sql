-- #667 / M1 down: drop the versioned hardware 3D asset foundation in
-- dependency order. Additive migration; nothing pre-existing is mutated.

DROP TABLE IF EXISTS design_revision_hardware_assets;
DROP TRIGGER IF EXISTS protect_hardware_asset_validations_append_only ON hardware_asset_validations;
DROP TABLE IF EXISTS hardware_asset_validations;

ALTER TABLE hardwares
    DROP CONSTRAINT IF EXISTS fk_hardwares_visual_asset_revision,
    DROP CONSTRAINT IF EXISTS fk_hardwares_visual_asset,
    DROP COLUMN IF EXISTS visual_asset_revision_id,
    DROP COLUMN IF EXISTS visual_asset_id;
DROP INDEX IF EXISTS idx_hardwares_visual_asset;

ALTER TABLE hardware_asset_upload_sessions DROP COLUMN IF EXISTS target_asset_id;
DROP TABLE IF EXISTS hardware_asset_upload_sessions;

DROP TRIGGER IF EXISTS protect_hardware_asset_revisions_immutable ON hardware_asset_revisions;
DROP TABLE IF EXISTS hardware_asset_revisions;

DROP TABLE IF EXISTS hardware_assets;
DROP INDEX IF EXISTS uq_hardwares_organization_id;

DELETE FROM rls_policy_inventory
WHERE table_name IN (
    'hardware_assets',
    'hardware_asset_revisions',
    'hardware_asset_upload_sessions',
    'hardware_asset_validations',
    'design_revision_hardware_assets'
);

DROP FUNCTION IF EXISTS protect_hardware_asset_row_immutability();
