DROP INDEX IF EXISTS idx_projects_owner_user_id;
DROP INDEX IF EXISTS idx_customers_owner_user_id;
ALTER TABLE projects DROP COLUMN IF EXISTS owner_user_id;
ALTER TABLE customers DROP COLUMN IF EXISTS owner_user_id;
