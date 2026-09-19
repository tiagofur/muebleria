-- #669 down: drop the GLB derivation/freeze additions in reverse dependency
-- order. Additive columns, indexes and constraints only; nothing pre-existing
-- is mutated. No rls_policy_inventory rows were added by the up migration.

ALTER TABLE design_revision_hardware_assets
    DROP CONSTRAINT IF EXISTS fk_design_revision_hardware_assets_glb_revision,
    DROP COLUMN IF EXISTS glb_sha256,
    DROP COLUMN IF EXISTS glb_revision_id;

ALTER TABLE hardware_asset_upload_sessions
    DROP COLUMN IF EXISTS source_revision_id,
    DROP COLUMN IF EXISTS exporter_name,
    DROP COLUMN IF EXISTS exporter_version,
    DROP COLUMN IF EXISTS export_options;

DROP INDEX IF EXISTS idx_hardware_asset_revisions_source_revision;

ALTER TABLE hardware_asset_revisions
    DROP CONSTRAINT IF EXISTS fk_hardware_asset_revisions_source_revision,
    DROP COLUMN IF EXISTS source_revision_id,
    DROP COLUMN IF EXISTS exporter_name,
    DROP COLUMN IF EXISTS exporter_version,
    DROP COLUMN IF EXISTS export_options;
