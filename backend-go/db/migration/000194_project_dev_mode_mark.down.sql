DROP TRIGGER IF EXISTS trg_project_dev_mode_mark_permanent ON projects;
DROP FUNCTION IF EXISTS project_dev_mode_mark_is_permanent();
ALTER TABLE projects DROP COLUMN IF EXISTS dev_mode_marked_at;
