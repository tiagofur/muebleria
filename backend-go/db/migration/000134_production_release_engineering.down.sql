DROP TRIGGER IF EXISTS protect_release_engineering_transitions_trigger ON production_release_engineering;
DROP FUNCTION IF EXISTS protect_release_engineering_transitions();
DROP TABLE IF EXISTS production_release_engineering;
DELETE FROM rls_policy_inventory WHERE table_name = 'production_release_engineering';
