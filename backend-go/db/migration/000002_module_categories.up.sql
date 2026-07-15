-- F025: hierarchical module categories (max 3 levels enforced in application)

CREATE TABLE IF NOT EXISTS module_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES module_categories(id) ON DELETE RESTRICT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_module_categories_parent
    ON module_categories (parent_id);

ALTER TABLE modules
    ADD COLUMN IF NOT EXISTS category_id UUID
        REFERENCES module_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_modules_category
    ON modules (category_id);
