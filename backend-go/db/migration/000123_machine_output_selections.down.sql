-- 000094.down walks rls_policy_inventory dropping policies: remove our row
-- BEFORE the table or its down-walk breaks on a missing relation.
DELETE FROM rls_policy_inventory WHERE table_name = 'machine_output_selections';
DROP TABLE IF EXISTS machine_output_selections;
