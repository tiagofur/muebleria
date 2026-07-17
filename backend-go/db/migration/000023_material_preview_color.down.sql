ALTER TABLE material_boards
  DROP COLUMN IF EXISTS preview_texture_url,
  DROP COLUMN IF EXISTS preview_color;
