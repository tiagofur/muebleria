ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS nesting_import JSONB;
