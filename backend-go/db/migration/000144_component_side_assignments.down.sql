-- 000144_component_side_assignments.down.sql
DELETE FROM rls_policy_inventory WHERE table_name = 'component_side_assignments';
DROP TABLE IF EXISTS component_side_assignments CASCADE;
