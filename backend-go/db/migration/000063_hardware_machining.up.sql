-- F127: CNC machining footprint on hardware (parts + drilling operations).
-- Additive: NULL = cost-only hardware (legacy rows keep no footprint).
ALTER TABLE hardwares
  ADD COLUMN IF NOT EXISTS machining JSONB;
