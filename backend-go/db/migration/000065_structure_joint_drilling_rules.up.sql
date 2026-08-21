-- F129: per-structure joint drilling rules override (32mm-system patterns).
-- Additive: NULL = workshop defaults. Mirrors the agregados JSONB pattern.
ALTER TABLE structures
  ADD COLUMN IF NOT EXISTS joint_drilling_rules JSONB;
