-- #1532 down: restore the migrated selections from the per-row reports (the
-- original JSON rides in opening_migration.selection), clear the per-furniture
-- override snapshots the migration wrote, and drop the columns. Styles applied
-- and snapshots frozen after the upgrade are lost with the columns.
DO $$
DECLARE
    wc RECORD;
    item RECORD;
BEGIN
    FOR wc IN SELECT design_id, opening_migration AS report
                FROM design_working_copies
               WHERE opening_migration ->> 'migration' = '000182'
               ORDER BY design_id LOOP
        FOR item IN SELECT value ->> 'furnitureInstanceId' AS fid,
                           value -> 'furnitureType' AS ftype,
                           value ->> 'action' AS action
                      FROM jsonb_array_elements(COALESCE(wc.report -> 'instances', '[]'::jsonb)) LOOP
            -- Handle overrides carried no frozen recipe beyond the flag; the
            -- snapshot is cleared either way (the project keeps its grip).
            UPDATE furniture_instances SET grip_snapshot = NULL WHERE id = item.fid::uuid;
        END LOOP;
        UPDATE design_working_copies
           SET authoring_defaults = jsonb_set(
                   authoring_defaults,
                   '{opening}',
                   wc.report -> 'selection',
                   TRUE),
               opening_migration = NULL
         WHERE design_id = wc.design_id;
    END LOOP;
END $$;

DROP INDEX IF EXISTS idx_projects_grip_style;

ALTER TABLE design_working_copies DROP COLUMN IF EXISTS opening_migration;
ALTER TABLE furniture_instances DROP COLUMN IF EXISTS grip_snapshot;

ALTER TABLE projects DROP COLUMN IF EXISTS grip_snapshot;
ALTER TABLE projects DROP COLUMN IF EXISTS grip_version;
ALTER TABLE projects DROP COLUMN IF EXISTS grip_style_id;
