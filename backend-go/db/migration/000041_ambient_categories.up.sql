-- F086: hierarchical ambient / finish material categories (max 3 levels)
CREATE TABLE IF NOT EXISTS ambient_categories (
    id TEXT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    parent_id TEXT REFERENCES ambient_categories(id) ON DELETE RESTRICT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ambient_categories_parent
    ON ambient_categories (parent_id);

ALTER TABLE ambient_materials
    ADD COLUMN IF NOT EXISTS category_id TEXT
        REFERENCES ambient_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ambient_materials_category
    ON ambient_materials (category_id);
