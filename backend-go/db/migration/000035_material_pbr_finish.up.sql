-- Add PBR finish attributes to material_boards table (#4150)
ALTER TABLE material_boards
  ADD COLUMN IF NOT EXISTS preview_roughness DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS preview_metalness DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS preview_clearcoat DOUBLE PRECISION;
