-- Best-effort revert: round fractional thickness back to INT and restore the
-- original strict check. Fractional data (0.5 mm) loses precision on down.
ALTER TABLE edge_bands DROP CONSTRAINT IF EXISTS edge_bands_thickness_mm_check;
ALTER TABLE edge_bands ALTER COLUMN thickness_mm TYPE INTEGER USING ROUND(thickness_mm);
ALTER TABLE edge_bands ADD CONSTRAINT edge_bands_thickness_mm_check
  CHECK (thickness_mm > 0);
