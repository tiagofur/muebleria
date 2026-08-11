ALTER TABLE hardwares
  DROP COLUMN IF EXISTS preview_clearcoat,
  DROP COLUMN IF EXISTS preview_metalness,
  DROP COLUMN IF EXISTS preview_roughness,
  DROP COLUMN IF EXISTS preview_color,
  DROP COLUMN IF EXISTS preview_diameter_mm,
  DROP COLUMN IF EXISTS preview_projection_mm,
  DROP COLUMN IF EXISTS preview_size_mm,
  DROP COLUMN IF EXISTS preview_shape;
