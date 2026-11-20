-- #1648: committed delivery date of an accepted order. It is the date agreed
-- with the customer, written ONLY by the server command
-- POST /api/projects/{projectId}/delivery-commitment (never by the aggregate
-- PUT), and every set/change leaves a delivery_date_committed /
-- delivery_date_changed lifecycle event plus a security audit row. Estimated
-- and actual delivery are distinct facts: actual comes from the delivery
-- milestones (installation_completed / client_signed_off / project_closed),
-- never from this column or createdAt.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS committed_delivery_date DATE;

-- Overdue lists filter by tenant and date.
CREATE INDEX IF NOT EXISTS idx_projects_org_committed_delivery
    ON projects (organization_id, committed_delivery_date)
    WHERE committed_delivery_date IS NOT NULL;
