ALTER TABLE material_boards
  DROP COLUMN IF EXISTS preview_texture_tile_width_mm,
  DROP COLUMN IF EXISTS preview_texture_tile_length_mm;
