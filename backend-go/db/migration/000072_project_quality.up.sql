-- OC-060..OC-062 (#302): quality job per project (issues, rework actions with
-- costing, per-unit QC records) as a JSONB column on projects, same convention
-- as installation (000070). Writes only through the dedicated quality endpoints.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS quality JSONB;
