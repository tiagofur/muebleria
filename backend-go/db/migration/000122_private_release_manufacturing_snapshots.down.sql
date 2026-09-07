-- Destructive rollback: export retained snapshots before downgrading after capture is enabled.
DELETE FROM rls_policy_inventory WHERE table_name = 'production_release_manufacturing_snapshots';
DROP TABLE IF EXISTS production_release_manufacturing_snapshots;
DROP FUNCTION IF EXISTS protect_release_manufacturing_snapshot_immutability();
DROP INDEX IF EXISTS uq_production_releases_id_project_owner;
