ALTER TABLE hardwares DROP COLUMN IF EXISTS brand;
DROP INDEX IF EXISTS idx_hardwares_category;
ALTER TABLE hardwares DROP COLUMN IF EXISTS category_id;
DROP INDEX IF EXISTS idx_hardware_categories_organization;
DROP INDEX IF EXISTS idx_hardware_categories_parent;
DROP TABLE IF EXISTS hardware_categories CASCADE;
