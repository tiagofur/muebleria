-- #1453 F1: canonical hardware bounding box (W×H×D). Nullable JSONB,
-- complete object or nothing — partial states don't exist. Writes validate
-- finite/positive axes (HARDWARE_DIMENSIONS_INVALID 422).
ALTER TABLE hardwares ADD COLUMN IF NOT EXISTS dimensions JSONB;

-- Backfill ONLY the shapes with an unambiguous preview→bbox mapping, so the
-- values become visible/editable in the form immediately. Heights follow the
-- drawing defaults (32 grip tube for pulls; size as height for knob/hinge),
-- depths the standoff default (25). slide/rail/leg stay NULL: cross-section
-- not modeled in F1 — effective dims derive at runtime (TS/Go
-- resolveHardwareDimensions/HardwareFormulaDims parity fixture).
UPDATE hardwares
SET dimensions = jsonb_build_object(
  'widthMm', preview_size_mm,
  'heightMm', CASE
    WHEN preview_shape IN ('knob', 'hinge') THEN preview_size_mm
    ELSE COALESCE(preview_diameter_mm, 32)
  END,
  'depthMm', COALESCE(preview_projection_mm, 25)
)
WHERE dimensions IS NULL
  AND preview_shape IN ('bar-pull', 'cup-pull', 'knob', 'hinge')
  AND preview_size_mm IS NOT NULL
  AND preview_size_mm > 0;
