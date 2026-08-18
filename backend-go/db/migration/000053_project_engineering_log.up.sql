-- roadmap-screens 2a.4 — engineering lifecycle log per project: who started
-- engineering, when docs were generated, when it was sent to production
-- (+ revision). Additive JSONB; NULL = engineering not started yet.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS engineering_log JSONB;
