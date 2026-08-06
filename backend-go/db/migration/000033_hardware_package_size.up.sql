-- Commercial package size in the same unit as hardware.unit (e.g. 4 for 4 m bars).
ALTER TABLE hardwares
    ADD COLUMN IF NOT EXISTS package_size NUMERIC(12, 3);

COMMENT ON COLUMN hardwares.package_size IS
    'Purchase package size in unit of cost (e.g. 4 meters per bar); NULL = no ceil';
