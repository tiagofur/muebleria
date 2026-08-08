-- Per-material PBR override for 3D preview. NULL = lighting-mode default
-- (undefined). Semantic range [0,1]. metalness 0.0 is a VALID value
-- (dielectric), so the Go layer stores these as nullable *float64 and never
-- coalesces 0.0 to NULL (see nullableFloat64Ptr helper).
ALTER TABLE material_boards ADD COLUMN IF NOT EXISTS preview_roughness DOUBLE PRECISION NULL;
ALTER TABLE material_boards ADD COLUMN IF NOT EXISTS preview_metalness DOUBLE PRECISION NULL;
ALTER TABLE material_boards ADD COLUMN IF NOT EXISTS preview_clearcoat DOUBLE PRECISION NULL;
