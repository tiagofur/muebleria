-- Physical size (mm) of one texture image tile for 3D UV mapping.
-- Width = across grain (U); length = along grain (V).
ALTER TABLE material_boards
  ADD COLUMN IF NOT EXISTS preview_texture_tile_width_mm DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS preview_texture_tile_length_mm DOUBLE PRECISION;
