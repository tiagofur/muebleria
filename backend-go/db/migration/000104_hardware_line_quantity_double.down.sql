-- Best-effort revert: round fractional quantities back to INT. Fractional
-- strip consumption (0.6 ml) loses precision on down — mirrors the 000061
-- edge-thickness downgrade pattern.
ALTER TABLE hardware_lines ALTER COLUMN quantity TYPE INTEGER USING CEIL(quantity);
