-- Module floor base (zoclo / patas): mode + default height B (mm).
ALTER TABLE modules
    ADD COLUMN IF NOT EXISTS base_mode TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS base_clearance_mm INTEGER;

COMMENT ON COLUMN modules.base_mode IS
    'none | plinth_board | plinth_strip | legs; empty = none';
COMMENT ON COLUMN modules.base_clearance_mm IS
    'Default plinth/legs height B (mm); NULL = domain default when mode needs it';
