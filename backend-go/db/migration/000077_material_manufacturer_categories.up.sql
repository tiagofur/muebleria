-- F142: material manufacturer (required on writes, backfilled for legacy rows)
-- and hierarchical material categories (subgrupos de tableros, mirror of
-- ambient_categories from F086).
ALTER TABLE material_boards
    ADD COLUMN IF NOT EXISTS manufacturer TEXT NOT NULL DEFAULT '';

-- Legacy rows sync as '(sin definir)' — matches domain MATERIAL_MANUFACTURER_UNSET,
-- so full-catalog PUTs never trip manufacturer validation.
UPDATE material_boards SET manufacturer = '(sin definir)' WHERE manufacturer = '';

CREATE TABLE IF NOT EXISTS material_categories (
    id TEXT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    parent_id TEXT REFERENCES material_categories(id) ON DELETE RESTRICT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_material_categories_parent
    ON material_categories (parent_id);

ALTER TABLE material_boards
    ADD COLUMN IF NOT EXISTS category_id TEXT
        REFERENCES material_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_material_boards_category
    ON material_boards (category_id);
