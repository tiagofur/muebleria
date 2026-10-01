-- 000146_platform_admin_library_writes.up.sql
-- #955: the platform-staff publish path. The library write policies
-- (000139/000140) require an org-owned library — Granete Standard (owner
-- NULL) is admin-side by design, so granete_app could never write Standard
-- releases inside a tenant request and the demo seed's publish silently
-- matched zero rows. Platform staff now carry an explicit transactional
-- marker (app.platform_admin, set from the verified claim) that widens the
-- library write policies; tenants keep exactly the previous surface.

-- NULLIF(..., '') follows the 000094 tenant-GUC idiom: after a SET LOCAL of a
-- custom GUC, PostgreSQL reverts it to the session default, which is the EMPTY
-- STRING (not NULL) once the GUC has ever been set on the pooled connection.
-- Without NULLIF this function would raise 22P02 instead of reading "not admin".
CREATE OR REPLACE FUNCTION app_platform_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(current_setting('app.platform_admin', true), '')::text::boolean, false)
$$;

DROP POLICY IF EXISTS library_releases_write ON library_releases;
CREATE POLICY library_releases_write ON library_releases
    FOR ALL TO granete_app
    USING (
        app_platform_admin()
        OR EXISTS (
            SELECT 1 FROM manufacturing_libraries ml
            WHERE ml.id = library_id
              AND ml.owner_organization_id IS NOT NULL
              AND ml.owner_organization_id = app_current_organization_id()
        )
        AND library_releases.status = 'draft'
    )
    WITH CHECK (
        app_platform_admin()
        OR EXISTS (
            SELECT 1 FROM manufacturing_libraries ml
            WHERE ml.id = library_id
              AND ml.owner_organization_id IS NOT NULL
              AND ml.owner_organization_id = app_current_organization_id()
        )
    );

DROP POLICY IF EXISTS library_release_refs_write ON library_release_resource_refs;
CREATE POLICY library_release_refs_write ON library_release_resource_refs
    FOR ALL TO granete_app
    USING (
        app_platform_admin()
        OR EXISTS (
            SELECT 1 FROM library_releases lr
            JOIN manufacturing_libraries ml ON ml.id = lr.library_id
            WHERE lr.id = release_id
              AND lr.status = 'draft'
              AND ml.owner_organization_id IS NOT NULL
              AND ml.owner_organization_id = app_current_organization_id()
        )
    )
    WITH CHECK (
        app_platform_admin()
        OR EXISTS (
            SELECT 1 FROM library_releases lr
            JOIN manufacturing_libraries ml ON ml.id = lr.library_id
            WHERE lr.id = release_id
              AND lr.status = 'draft'
              AND ml.owner_organization_id IS NOT NULL
              AND ml.owner_organization_id = app_current_organization_id()
        )
    );

DROP POLICY IF EXISTS library_release_manifests_write ON library_release_manifests;
-- Tenant branch keeps 000140's exact shape (no status condition): narrowing it
-- would break a tenant publishing its own library, whose manifest row is
-- written after the status flip.
CREATE POLICY library_release_manifests_write ON library_release_manifests
    FOR ALL TO granete_app
    USING (
        app_platform_admin()
        OR EXISTS (
            SELECT 1 FROM library_releases lr
            JOIN manufacturing_libraries ml ON ml.id = lr.library_id
            WHERE lr.id = library_release_manifests.release_id
              AND ml.owner_organization_id IS NOT NULL
              AND ml.owner_organization_id = app_current_organization_id()
        )
    )
    WITH CHECK (
        app_platform_admin()
        OR EXISTS (
            SELECT 1 FROM library_releases lr
            JOIN manufacturing_libraries ml ON ml.id = lr.library_id
            WHERE lr.id = library_release_manifests.release_id
              AND ml.owner_organization_id IS NOT NULL
              AND ml.owner_organization_id = app_current_organization_id()
        )
    );

UPDATE rls_policy_inventory
SET write_scope = CASE table_name
        WHEN 'library_releases' THEN 'owner-organization-draft-only-or-platform-admin'
        WHEN 'library_release_resource_refs' THEN 'owner-organization-draft-only-insert-or-platform-admin'
        ELSE 'owner-organization-or-platform-admin'
    END,
    rationale = rationale || ' Platform staff carry the transactional app.platform_admin marker (#955) to compile and publish Standard releases; the tenant branch is unchanged.'
WHERE table_name IN ('library_releases', 'library_release_resource_refs', 'library_release_manifests');
