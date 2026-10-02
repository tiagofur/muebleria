-- 000147_hardware_profiles_platform_read.down.sql
-- Restore the strictly org-scoped read policy of 000143.

DROP POLICY IF EXISTS hardware_profiles_read ON hardware_profiles;
CREATE POLICY hardware_profiles_read ON hardware_profiles
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id());

UPDATE rls_policy_inventory
SET read_scope = 'current-organization',
    rationale = rationale || ' Reverted the #964 platform-admin read widening.',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name = 'hardware_profiles';
