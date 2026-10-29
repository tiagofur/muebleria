-- #1422 slice 1: kit↔design-part link. When set, this hardware is a design
-- part of the referenced kit (the commercial set sold as one). Nullable =
-- standalone hardware (legacy rows byte-identical). Existence/self/kit-not-
-- part validated server-side (fail-closed 422), not via FK.
ALTER TABLE hardwares ADD COLUMN IF NOT EXISTS kit_hardware_id UUID;
