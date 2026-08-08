-- Drop PBR finish attributes from material_boards table (#4150)
ALTER TABLE material_boards
  DROP COLUMN IF EXISTS preview_roughness,
  DROP COLUMN IF EXISTS preview_metalness,
  DROP COLUMN IF EXISTS preview_clearcoat;
