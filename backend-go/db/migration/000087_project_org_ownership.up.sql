-- ADR-0005 / #327: Project ownership columns for multi-organization distribution.
-- Enables network cooperation between Store/Showroom organizations (sales) and
-- Factory/Workshop organizations (manufacturing) without data leakage.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS sales_organization_id UUID
        REFERENCES organizations(id),
    ADD COLUMN IF NOT EXISTS manufacturing_organization_id UUID
        REFERENCES organizations(id);

-- Backfill from existing organization_id and owner_user_id
UPDATE projects
SET sales_organization_id = organization_id
WHERE sales_organization_id IS NULL;

UPDATE projects
SET manufacturing_organization_id = organization_id
WHERE manufacturing_organization_id IS NULL;

UPDATE projects
SET created_by = owner_user_id
WHERE created_by IS NULL AND owner_user_id IS NOT NULL;

-- Add indexes for fast multi-organization queries
CREATE INDEX IF NOT EXISTS idx_projects_sales_org ON projects(sales_organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_mfg_org ON projects(manufacturing_organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
