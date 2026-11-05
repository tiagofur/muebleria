-- #1507: hierarchical hardware categories (subgrupos de herrajes, mirror of
-- material_categories from F142 / ambient_categories from F086) plus the
-- hardware category link and free-form brand label. organization_id is baked
-- in from day one (materials needed a later backfill in 000083).
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

ALTER TABLE hardwares
    ADD COLUMN IF NOT EXISTS category_id TEXT
        REFERENCES hardware_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hardwares_category
    ON hardwares (category_id);

-- Free-form manufacturer/series label (#1507, e.g. "Blum"). Nullable: unset =
-- sin marca; no purchase or machining meaning.
ALTER TABLE hardwares
    ADD COLUMN IF NOT EXISTS brand TEXT;
