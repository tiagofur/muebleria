-- #385 / DT-1: remove the project furniture identity slice.
DELETE FROM rls_policy_inventory WHERE table_name = 'furniture_instances';
DROP TABLE IF EXISTS furniture_instances;
