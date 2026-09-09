-- 000127 reconciles drift toward 000110's final definition; it changes no
-- canonical schema. Rollback therefore keeps the canonical policy: removing
-- the platform-admin branch would break platform console audit writes on
-- every installation, drifted or not.

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
