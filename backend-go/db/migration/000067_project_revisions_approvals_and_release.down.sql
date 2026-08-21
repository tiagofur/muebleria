ALTER TABLE projects
  DROP COLUMN IF EXISTS design_revisions,
  DROP COLUMN IF EXISTS approvals,
  DROP COLUMN IF EXISTS production_release;
