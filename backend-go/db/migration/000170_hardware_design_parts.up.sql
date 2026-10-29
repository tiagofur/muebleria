-- #1417: internal design parts of a hardware's pinned SKP, declared by
-- SketchUp component name (per-part presentation membership + finish key).
-- NULL = monolithic hardware (legacy rows byte-identical).
ALTER TABLE hardwares ADD COLUMN IF NOT EXISTS design_parts JSONB;
