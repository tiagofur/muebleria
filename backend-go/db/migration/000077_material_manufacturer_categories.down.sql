ALTER TABLE material_boards DROP COLUMN IF EXISTS category_id;
DROP INDEX IF EXISTS idx_material_categories_parent;
DROP TABLE IF EXISTS material_categories CASCADE;
ALTER TABLE material_boards DROP COLUMN IF EXISTS manufacturer;
