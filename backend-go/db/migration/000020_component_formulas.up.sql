-- F054 / #101 (Fase 3): Parametric components — a Component may stretch its
-- geometry according to the selected preset dimensions (W/H/D) via optional
-- formulas, instead of always carrying a fixed length/width. When a formula is
-- present it overrides length_mm / width_mm at resolution time.
ALTER TABLE components ADD COLUMN IF NOT EXISTS length_formula VARCHAR(100);
ALTER TABLE components ADD COLUMN IF NOT EXISTS width_formula  VARCHAR(100);
