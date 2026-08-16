-- F080: per-part finishes on hardware (body/base/grip → finish preset id).
-- Additive: NULL = every part uses the global preview finish (legacy rows).
ALTER TABLE hardwares
  ADD COLUMN IF NOT EXISTS part_finishes JSONB;
