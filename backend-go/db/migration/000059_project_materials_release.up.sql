-- Process stage gating — Almacén's explicit "materials complete" stamp:
-- who released the project's materials to the production floor and when.
-- Additive JSONB; NULL = materials not released yet (project stays in the
-- warehouse queue and is NOT visible to the production floor).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS materials_release JSONB;
