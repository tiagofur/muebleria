-- #669: coherent GLB representation of hardware 3D assets.
--
-- 1. hardware_asset_revisions gains derivation provenance for GLB revisions
--    exported from an SKP revision of the SAME asset:
--    - source_revision_id: composite FK (source_revision_id, asset_id) ->
--      hardware_asset_revisions(id, asset_id). A derived GLB can never point
--      at another asset's (or another tenant's) revision. Default RESTRICT:
--      the table is immutable once written, so the FK only guards the INSERT.
--    - exporter_name/exporter_version/export_options: declared export-tool
--      provenance (bounded text + bounded JSONB; validated server-side before
--      the INSERT, never re-trusted from read paths).
--    A partial index on source_revision_id backs the deterministic "latest
--    derived GLB of revision R" lookup (ORDER BY revision_number DESC LIMIT 1).
-- 2. hardware_asset_upload_sessions stages the derivation block requested at
--    session start; finalize copies it onto the new immutable revision (only
--    representation 'glb' accepts a derivation — SKP/thumbnail uploads are
--    refused at session start).
-- 3. design_revision_hardware_assets freezes the derived GLB at publish time:
--    glb_revision_id + glb_sha256 resolved with the same deterministic rule,
--    NULL when the pinned SKP revision has no derived GLB. Historical pins
--    keep their exact GLB revision even after later re-exports create newer
--    derived revisions (a new revision is a new immutable row; old pins are
--    untouched).
--
-- No new tables: every touched table keeps its classification, RLS policies,
-- grants and immutability triggers from 000131, so no new rls_policy_inventory
-- rows are required (documented here instead of mutating the inventory).

-- 1. Derivation provenance on immutable revisions --------------------------------

ALTER TABLE hardware_asset_revisions
    ADD COLUMN IF NOT EXISTS source_revision_id UUID NULL,
    ADD COLUMN IF NOT EXISTS exporter_name VARCHAR(64) NULL
        CHECK (exporter_name IS NULL OR char_length(exporter_name) BETWEEN 1 AND 64),
    ADD COLUMN IF NOT EXISTS exporter_version VARCHAR(32) NULL
        CHECK (exporter_version IS NULL OR char_length(exporter_version) BETWEEN 1 AND 32),
    ADD COLUMN IF NOT EXISTS export_options JSONB NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_hardware_asset_revisions_source_revision'
          AND conrelid = 'hardware_asset_revisions'::regclass
    ) THEN
        ALTER TABLE hardware_asset_revisions
            ADD CONSTRAINT fk_hardware_asset_revisions_source_revision
            FOREIGN KEY (source_revision_id, asset_id)
            REFERENCES hardware_asset_revisions (id, asset_id);
    END IF;
END $$;

-- Deterministic derived-representation lookup: latest derived GLB per source.
CREATE INDEX IF NOT EXISTS idx_hardware_asset_revisions_source_revision
    ON hardware_asset_revisions (source_revision_id)
    WHERE source_revision_id IS NOT NULL;

-- 2. Derivation block staged on the upload session --------------------------------

ALTER TABLE hardware_asset_upload_sessions
    ADD COLUMN IF NOT EXISTS source_revision_id UUID NULL,
    ADD COLUMN IF NOT EXISTS exporter_name VARCHAR(64) NULL
        CHECK (exporter_name IS NULL OR char_length(exporter_name) BETWEEN 1 AND 64),
    ADD COLUMN IF NOT EXISTS exporter_version VARCHAR(32) NULL
        CHECK (exporter_version IS NULL OR char_length(exporter_version) BETWEEN 1 AND 32),
    ADD COLUMN IF NOT EXISTS export_options JSONB NULL;

-- 3. Publish-pin GLB freeze --------------------------------------------------------

ALTER TABLE design_revision_hardware_assets
    ADD COLUMN IF NOT EXISTS glb_revision_id UUID NULL,
    ADD COLUMN IF NOT EXISTS glb_sha256 VARCHAR(128) NULL
        CHECK (glb_sha256 IS NULL OR glb_sha256 ~ '^sha256-[0-9a-f]{64}$');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_design_revision_hardware_assets_glb_revision'
          AND conrelid = 'design_revision_hardware_assets'::regclass
    ) THEN
        ALTER TABLE design_revision_hardware_assets
            ADD CONSTRAINT fk_design_revision_hardware_assets_glb_revision
            FOREIGN KEY (glb_revision_id, asset_id)
            REFERENCES hardware_asset_revisions (id, asset_id);
    END IF;
END $$;
