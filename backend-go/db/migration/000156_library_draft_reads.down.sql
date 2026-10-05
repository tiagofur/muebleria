-- Restore the exact 000139 read policy and inventory row (copied verbatim):
-- a rollback must leave tenants and platform staff with the read surface they
-- had before the authoring workspace slice.

DROP POLICY IF EXISTS library_releases_read ON library_releases;
CREATE POLICY library_releases_read ON library_releases
    FOR SELECT TO granete_app
    USING (
        EXISTS (
            SELECT 1 FROM manufacturing_libraries ml
            WHERE ml.id = library_id
              AND (
                  ml.owner_organization_id IS NULL
                  OR ml.owner_organization_id = app_current_organization_id()
              )
              AND (
                  library_releases.status = 'published'
                  OR ml.owner_organization_id = app_current_organization_id()
              )
        )
    );

UPDATE rls_policy_inventory
SET read_scope = 'platform-global-published-or-owner-organization',
    rationale = 'Published Granete Standard releases visible to all; org overlay releases tenant-scoped; drafts restricted to owner; immutable once published (#772 / ADR-0008)',
    policy_version = GREATEST(policy_version - 1, 1),
    updated_at = NOW()
WHERE table_name = 'library_releases';
