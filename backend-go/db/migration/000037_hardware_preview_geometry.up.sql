-- Per-hardware preview geometry + PBR for the 3D renderer (Fase 2: visible handles).
-- All nullable; ADD COLUMN IF NOT EXISTS (additive, never destructive).
-- metalness/clearcoat use DOUBLE PRECISION (NOT real-via-nullIfZero) so 0.0 is a
-- valid value that round-trips (dielectric metalness = 0).
ALTER TABLE hardwares
  ADD COLUMN IF NOT EXISTS preview_shape TEXT,
  ADD COLUMN IF NOT EXISTS preview_size_mm DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS preview_projection_mm DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS preview_diameter_mm DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS preview_color TEXT,
  ADD COLUMN IF NOT EXISTS preview_roughness DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS preview_metalness DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS preview_clearcoat DOUBLE PRECISION;
