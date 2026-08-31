-- #442: hardware line quantity is fractional in real catalogs — the zoclo
-- strip profile is consumed in meters (0.6 ml for a 600 mm front) and TS
-- HardwareLine.quantity is a number. The original INT column could not
-- represent it, forcing Go to diverge from the TS BOM. Widen to DOUBLE
-- PRECISION; pieces stay integral so CHECK (quantity > 0) is preserved.
ALTER TABLE hardware_lines ALTER COLUMN quantity TYPE DOUBLE PRECISION;
