DROP TABLE IF EXISTS project_events;
DROP INDEX IF EXISTS idx_projects_commercial_status;
ALTER TABLE projects DROP COLUMN IF EXISTS commercial_status;
