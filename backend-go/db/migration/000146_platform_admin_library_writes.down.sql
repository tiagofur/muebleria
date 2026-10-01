-- 000146_platform_admin_library_writes.down.sql
-- Restore the exact 000139/000140 write policies (copied verbatim) and the
-- inventory rows they declared: a rollback must leave tenants with the surface
-- they had, not a table with no write policy at all.

DROP POLICY IF EXISTS library_releases_write ON library_releases;
CREATE POLICY library_releases_write ON library_releases
    FOR ALL TO granete_app
    USING (
        EXISTS (
            SELECT 1 FROM manufacturing_libraries ml
            WHERE ml.id = library_id
              AND ml.owner_organization_id IS NOT NULL
              AND ml.owner_organization_id = app_current_organization_id()
        )
        AND library_releases.status = 'draft'
    )
    WITH CHECK (
        EXISTS (
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
              AND ml.owner_organization_id IS NOT NULL
              AND ml.owner_organization_id = app_current_organization_id()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM library_releases lr
            JOIN manufacturing_libraries ml ON ml.id = lr.library_id
            WHERE lr.id = release_id
              AND lr.status = 'draft'
              AND ml.owner_organization_id IS NOT NULL
              AND ml.owner_organization_id = app_current_organization_id()
        )
    );


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
              )
        )
    );

DROP POLICY IF EXISTS library_release_manifests_write ON library_release_manifests;
CREATE POLICY library_release_manifests_write ON library_release_manifests
    FOR ALL TO granete_app
    USING (
        EXISTS (
            SELECT 1 FROM library_releases lr
            JOIN manufacturing_libraries ml ON ml.id = lr.library_id
            WHERE lr.id = library_release_manifests.release_id
              AND ml.owner_organization_id IS NOT NULL
              AND ml.owner_organization_id = app_current_organization_id()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM library_releases lr
            JOIN manufacturing_libraries ml ON ml.id = lr.library_id
            WHERE lr.id = library_release_manifests.release_id
              AND ml.owner_organization_id IS NOT NULL
              AND ml.owner_organization_id = app_current_organization_id()
        )
    );

UPDATE rls_policy_inventory
SET write_scope = CASE table_name
        WHEN 'library_releases' THEN 'owner-organization-draft-only'
        WHEN 'library_release_resource_refs' THEN 'owner-organization-draft-only-insert'
        ELSE 'owner-organization'
    END,
    rationale = CASE table_name
        WHEN 'library_releases' THEN 'Published Granete Standard releases visible to all; org overlay releases tenant-scoped; drafts restricted to owner; immutable once published (#772 / ADR-0008)'
        WHEN 'library_release_resource_refs' THEN 'Typed canonical resource references within a release; immutable once release published; package_kind separates Free/Standard without duplicating domain definitions (#772 / ADR-0008)'
        ELSE 'Materialized manifests are platform-global readable if standard/published, or owner-organization readable if draft/overlay; immutable once created (#773 / LIB-2)'
    END,
    policy_version = GREATEST(policy_version - 1, 1),
    updated_at = NOW()
WHERE table_name IN ('library_releases', 'library_release_resource_refs', 'library_release_manifests');

REVOKE UPDATE (resource_revision, package_kind) ON library_release_resource_refs FROM granete_app;

DROP FUNCTION IF EXISTS library_release_has_manifest(uuid);
DROP FUNCTION IF EXISTS app_platform_admin();