-- 000147_hardware_profiles_platform_read.up.sql
-- #964: per-org provisioning of recipe-bearing profiles feeds ONE Standard
-- publication — the platform-staff compile (POST
-- /manufacturing-libraries/standard/releases/{id}/publish and the seed's
-- publish step) gathers every active profile across organizations into the
-- release manifest (ListActiveHardwareProfilesAnyOrg). 000143's read policy
-- is strictly org-scoped, so a compile running inside the publisher's tenant
-- transaction saw only its own org's rows and the manifest silently missed
-- every other factory's provisioned profile (the A/B resolve stayed at
-- TECHNICAL_PROFILE_REQUIRED for the second organization).
--
-- Widen the READ with the transactional app.platform_admin marker — the
-- #955/000146 idiom: the marker is set per transaction from the live
-- verified claim, so the widening is reachable only through the
-- platform-gated publish path. Tenants without the marker keep the exact
-- org-scoped read. WRITES stay org-scoped: provisioning writes rows under
-- the caller's own organization and nobody authors another org's profiles.

DROP POLICY IF EXISTS hardware_profiles_read ON hardware_profiles;
CREATE POLICY hardware_profiles_read ON hardware_profiles
    FOR SELECT TO granete_app
    USING (
        organization_id = app_current_organization_id()
        OR app_platform_admin()
    );

UPDATE rls_policy_inventory
SET read_scope = 'current-organization-or-platform-admin',
    rationale = rationale || ' The Standard publish compile gathers every active profile across organizations under the transactional app.platform_admin marker (#964); tenant reads stay org-scoped.',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name = 'hardware_profiles';
