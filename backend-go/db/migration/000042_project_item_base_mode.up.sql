-- F087 — zócalo como terminación automática: base treatment override per
-- quote line. Empty string = use the catalog module's baseMode.
ALTER TABLE project_items
    ADD COLUMN IF NOT EXISTS base_mode TEXT NOT NULL DEFAULT '';
