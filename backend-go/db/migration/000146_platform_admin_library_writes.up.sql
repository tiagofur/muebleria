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

-- Helper to check manifest existence without triggering mutual RLS recursion
-- between library_releases and library_release_manifests policies (#955).
CREATE OR REPLACE FUNCTION library_release_has_manifest(p_release_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM public.library_release_manifests WHERE release_id = p_release_id)
$$;

DROP POLICY IF EXISTS library_releases_write ON library_releases;
CREATE POLICY library_releases_write ON library_releases
    FOR ALL TO granete_app
    USING (
        (
            app_platform_admin()
            OR EXISTS (
                SELECT 1 FROM manufacturing_libraries ml
                WHERE ml.id = library_id
                  AND ml.owner_organization_id IS NOT NULL
                  AND ml.owner_organization_id = app_current_organization_id()
            )
        )
        AND (
            library_releases.status = 'draft'
            OR (
                app_platform_admin()
                AND library_releases.status = 'published'
                AND NOT library_release_has_manifest(library_releases.id)
                AND library_releases.manifest_hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000001'
            )
        )
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
        EXISTS (
            SELECT 1 FROM library_releases lr
            JOIN manufacturing_libraries ml ON ml.id = lr.library_id
            WHERE lr.id = release_id
              AND lr.status = 'draft'
              AND (
                  app_platform_admin()
                  OR (
                      ml.owner_organization_id IS NOT NULL
                      AND ml.owner_organization_id = app_current_organization_id()
                  )
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM library_releases lr
            JOIN manufacturing_libraries ml ON ml.id = lr.library_id
            WHERE lr.id = release_id
              AND lr.status = 'draft'
              AND (
                  app_platform_admin()
                  OR (
                      ml.owner_organization_id IS NOT NULL
                      AND ml.owner_organization_id = app_current_organization_id()
                  )
              )
        )
    );

-- Allow granete_app to update revision and package_kind when reconciling
-- draft refs with the compiled manifest at publish time (#955).
GRANT UPDATE (resource_revision, package_kind) ON library_release_resource_refs TO granete_app;

DROP POLICY IF EXISTS library_resource_blobs_read ON library_resource_blobs;
CREATE POLICY library_resource_blobs_read ON library_resource_blobs
    FOR SELECT TO granete_app
    USING (
        EXISTS (
            SELECT 1 FROM library_release_resource_refs r
            JOIN library_releases lr ON lr.id = r.release_id
            JOIN manufacturing_libraries ml ON ml.id = lr.library_id
            WHERE r.definition_hash = library_resource_blobs.sha256
              AND (
                  ml.owner_organization_id IS NULL
                  OR ml.owner_organization_id = app_current_organization_id()
              )
              AND (
                  lr.status = 'published'
                  OR ml.owner_organization_id = app_current_organization_id()
                  OR (app_platform_admin() AND ml.owner_organization_id IS NULL)
              )
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
    rationale = rationale || ' Platform staff carry the transactional app.platform_admin marker (#955) to compile and publish Standard releases; the tenant branch is unchanged.',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name IN ('library_releases', 'library_release_resource_refs', 'library_release_manifests');
