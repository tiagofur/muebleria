-- Preview color / texture for 3D and fast client swatches.
ALTER TABLE material_boards
  ADD COLUMN IF NOT EXISTS preview_color TEXT,
  ADD COLUMN IF NOT EXISTS preview_texture_url TEXT;
