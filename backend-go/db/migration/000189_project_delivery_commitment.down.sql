-- #1648 reversal: the lifecycle events keep the full history of commitments.
DROP INDEX IF EXISTS idx_projects_org_committed_delivery;
ALTER TABLE projects DROP COLUMN IF EXISTS committed_delivery_date;
