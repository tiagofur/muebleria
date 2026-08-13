ALTER TABLE ambient_materials DROP COLUMN IF EXISTS category_id;
DROP TABLE IF EXISTS ambient_categories CASCADE;
