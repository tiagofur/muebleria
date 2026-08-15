-- Migration: 000044_project_technical_workflow.down.sql

DROP TABLE IF EXISTS project_internal_messages;

DROP INDEX IF EXISTS idx_projects_technical_status;
DROP INDEX IF EXISTS idx_projects_assigned_engineer_id;

ALTER TABLE projects
  DROP COLUMN IF EXISTS installation_scheduled_date,
  DROP COLUMN IF EXISTS survey_completed_at,
  DROP COLUMN IF EXISTS technical_status,
  DROP COLUMN IF EXISTS assigned_engineer_id;
