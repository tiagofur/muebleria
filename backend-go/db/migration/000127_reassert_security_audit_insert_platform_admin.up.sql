-- Upgrade reconciliation (#616 follow-up): installations that applied an
-- intermediate version of 000110 before its platform-admin branch was
-- committed keep the older security_audit_insert policy forever, because
-- applied migrations never rerun. On those databases every platform command
-- that must write audit evidence for an organization (e.g. PATCH
-- /api/platform/organizations/{id}) fails the RLS check after the mutation
-- itself succeeded and rolls back with a 500. Recreating the policy converges
-- upgraded databases to 000110's final definition; fresh databases already
-- match it and are unchanged.

DROP POLICY IF EXISTS security_audit_insert ON security_audit_events;
CREATE POLICY security_audit_insert ON security_audit_events FOR INSERT
    WITH CHECK (
        actor_user_id IS NOT DISTINCT FROM app_current_user_id()
        AND (
            organization_id IS NULL
            OR app_has_organization_access(organization_id)
            OR app_current_user_is_platform_admin()
        )
    );
