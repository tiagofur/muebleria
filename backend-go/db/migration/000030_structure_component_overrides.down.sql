-- Reverse of 000030 (additive column).
ALTER TABLE structure_components
    DROP COLUMN IF EXISTS overrides;
