-- #1530 down: undo the row changes recorded in the per-row report, then drop
-- the v2 columns. Rows edited after the upgrade keep those edits.

-- Reactivate the rows 000180 deactivated (only if they were active before).
UPDATE opening_profiles
SET active = TRUE,
    version = version + 1,
    updated_at = NOW()
WHERE v2_migration->>'migration' = '000180'
  AND v2_migration->>'action' = 'deactivated'
  AND (v2_migration->>'was_active')::BOOLEAN;

-- Move the strip member back to its original key and drop the default height.
UPDATE opening_profiles
SET bom_members = (bom_members - 'strip')
        || jsonb_build_object(
               v2_migration->>'strip_renamed_from',
               CASE WHEN v2_migration ? 'strip_height_default_mm'
                    THEN (bom_members->'strip') - 'height_mm'
                    ELSE bom_members->'strip'
               END),
    version = version + 1,
    updated_at = NOW()
WHERE v2_migration->>'migration' = '000180'
  AND v2_migration ? 'strip_renamed_from'
  AND bom_members ? 'strip';

UPDATE opening_profiles
SET bom_members = jsonb_set(bom_members, '{strip}', (bom_members->'strip') - 'height_mm'),
    version = version + 1,
    updated_at = NOW()
WHERE v2_migration->>'migration' = '000180'
  AND NOT (v2_migration ? 'strip_renamed_from')
  AND v2_migration ? 'strip_height_default_mm'
  AND bom_members ? 'strip';

ALTER TABLE opening_profiles
    DROP COLUMN IF EXISTS v2_migration,
    DROP COLUMN IF EXISTS front_discount_between_mm,
    DROP COLUMN IF EXISTS front_discount_top_mm,
    DROP COLUMN IF EXISTS positions,
    DROP COLUMN IF EXISTS material;
