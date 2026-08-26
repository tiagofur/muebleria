DROP INDEX IF EXISTS idx_projects_created_by;
DROP INDEX IF EXISTS idx_projects_mfg_org;
DROP INDEX IF EXISTS idx_projects_sales_org;

ALTER TABLE projects
    DROP COLUMN IF EXISTS manufacturing_organization_id,
    DROP COLUMN IF EXISTS sales_organization_id;
