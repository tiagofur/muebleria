-- Grain (veta) moves from piece to material: a board's grain is a property of
-- the material (e.g. melamina without grain vs. veneer with grain), not of the
-- individual piece. Adds the persisted column to material_boards (it existed
-- only in Go/TS code before — drift fixed) and drops the per-piece grain column.
ALTER TABLE material_boards
  ADD COLUMN IF NOT EXISTS grain_default BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE board_parts
  DROP COLUMN IF EXISTS grain;
