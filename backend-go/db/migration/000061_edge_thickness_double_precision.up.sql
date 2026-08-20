-- F116 C3: edge band thickness is fractional in real catalogs (0.4 / 0.5 /
-- 0.8 mm are industry standard). The original INT column plus
-- CHECK (thickness_mm > 0) rejected the TS default 0.5 (JSON decode error)
-- and the seed value 0 (constraint violation), so guest-created edges
-- silently vanished in API mode. Widen to DOUBLE PRECISION and allow 0
-- (= "no band" placeholder used by the TS seed).
ALTER TABLE edge_bands ALTER COLUMN thickness_mm TYPE DOUBLE PRECISION;
ALTER TABLE edge_bands DROP CONSTRAINT IF EXISTS edge_bands_thickness_mm_check;
ALTER TABLE edge_bands ADD CONSTRAINT edge_bands_thickness_mm_check
  CHECK (thickness_mm >= 0);
