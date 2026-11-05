-- #1507 reversal: drop the hardware category link/brand columns and the
-- hardware_categories table with its tenant RLS surface.
ALTER TABLE hardwares DROP COLUMN IF EXISTS brand;
DROP INDEX IF EXISTS idx_hardwares_category;
ALTER TABLE hardwares DROP COLUMN IF EXISTS category_id;
DROP POLICY IF EXISTS tenant_isolation ON hardware_categories;
DROP INDEX IF EXISTS idx_hardware_categories_organization;
DROP INDEX IF EXISTS idx_hardware_categories_parent;
DROP TABLE IF EXISTS hardware_categories CASCADE;
DELETE FROM rls_policy_inventory WHERE table_name = 'hardware_categories';
