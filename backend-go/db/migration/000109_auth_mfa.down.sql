-- #460 SEC-7 rollback: drop MFA factors, recovery codes and step-up grants.
-- auth_sessions.step_up_at (000105) stays: it belongs to the session registry.
DROP TABLE IF EXISTS auth_step_up_grants;
DROP TABLE IF EXISTS auth_mfa_recovery_codes;
DROP TABLE IF EXISTS auth_mfa_factors;
DELETE FROM rls_policy_inventory
WHERE table_name IN ('auth_mfa_factors', 'auth_mfa_recovery_codes', 'auth_step_up_grants');
