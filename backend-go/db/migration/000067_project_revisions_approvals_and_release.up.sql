-- OC-020, OC-021, OC-022 — Design revisions, approvals and production release.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS design_revisions JSONB,
  ADD COLUMN IF NOT EXISTS approvals JSONB,
  ADD COLUMN IF NOT EXISTS production_release JSONB;
