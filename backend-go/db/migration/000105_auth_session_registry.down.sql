-- #460 / SEC-1: remove the session registry (rollback slice).
DELETE FROM rls_policy_inventory WHERE table_name = 'auth_sessions';
DROP TABLE IF EXISTS auth_sessions;
