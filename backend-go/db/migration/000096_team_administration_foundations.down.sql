-- #451 rollback fails closed if revocation or provisioned seat facts would be lost.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM memberships WHERE credential_version <> 1 OR sessions_revoked_at IS NOT NULL OR sessions_revoked_by IS NOT NULL OR sessions_revocation_reason IS NOT NULL) THEN
        RAISE EXCEPTION 'cannot rollback TEAM-1: membership credential revocation history would be lost; restore a verified pre-migration backup' USING ERRCODE='55000';
    END IF;
    IF EXISTS (SELECT 1 FROM organization_entitlements WHERE max_active_members IS NOT NULL OR source <> 'legacy_unlimited' OR version <> 1) THEN
        RAISE EXCEPTION 'cannot rollback TEAM-1: provisioned entitlement facts would be lost; restore a verified pre-migration backup' USING ERRCODE='55000';
    END IF;
END $$;

DROP TRIGGER IF EXISTS initialize_organization_team_foundations ON organizations;
DROP TRIGGER IF EXISTS enforce_team_invariants_from_entitlements ON organization_entitlements;
DROP TRIGGER IF EXISTS enforce_team_invariants_from_organizations ON organizations;
DROP TRIGGER IF EXISTS enforce_team_invariants_from_memberships ON memberships;
DROP TRIGGER IF EXISTS refresh_team_state_on_membership_change ON memberships;
DROP FUNCTION IF EXISTS enforce_team_invariants_from_entitlement();
DROP FUNCTION IF EXISTS enforce_team_invariants_from_organization();
DROP FUNCTION IF EXISTS enforce_team_invariants_from_membership();
DROP FUNCTION IF EXISTS check_organization_team_invariants(UUID);
DROP FUNCTION IF EXISTS initialize_organization_team_foundations();
DROP FUNCTION IF EXISTS refresh_team_state_on_membership_change();
DROP FUNCTION IF EXISTS apply_organization_team_delta(UUID, INTEGER, INTEGER);
DELETE FROM rls_policy_inventory WHERE table_name IN ('organization_team_state', 'organization_entitlements');
DROP TABLE IF EXISTS organization_entitlements;
DROP TABLE IF EXISTS organization_team_state;
DROP INDEX IF EXISTS idx_memberships_active_admin;
ALTER TABLE memberships
    DROP CONSTRAINT IF EXISTS memberships_credential_version_check,
    DROP COLUMN IF EXISTS sessions_revocation_reason,
    DROP COLUMN IF EXISTS sessions_revoked_by,
    DROP COLUMN IF EXISTS sessions_revoked_at,
    DROP COLUMN IF EXISTS credential_version;
