-- #1531 down: put the converted blobs back on their overlay (from the
-- migration report), then drop the table, the trigger and its function.
-- Styles authored after the upgrade are lost with the table.
UPDATE library_overlays lo
   SET overrides = lo.overrides
           || CASE WHEN r.report ? 'capabilities'
                   THEN jsonb_build_object('opening.capabilities', r.report -> 'capabilities') ELSE '{}'::jsonb END
           || CASE WHEN r.report ? 'bottomOverhang'
                   THEN jsonb_build_object('opening.bottom-overhang', r.report -> 'bottomOverhang') ELSE '{}'::jsonb END,
       version = lo.version + 1,
       updated_at = NOW()
  FROM (
        SELECT DISTINCT ON (organization_id) organization_id, migration_report AS report
          FROM grip_styles
         WHERE migration_report ->> 'migration' = '000181' AND migration_report ? 'overlayId'
         ORDER BY organization_id, (migration_report ->> 'action') = 'seeded'
       ) r
 WHERE lo.id = (r.report ->> 'overlayId')::uuid;

DROP TRIGGER IF EXISTS initialize_organization_grip_styles ON organizations;
DROP FUNCTION IF EXISTS initialize_organization_grip_styles();
-- The down of 000094 walks rls_policy_inventory: the row goes before the table.
DELETE FROM rls_policy_inventory WHERE table_name = 'grip_styles';
DROP TABLE IF EXISTS grip_styles;
