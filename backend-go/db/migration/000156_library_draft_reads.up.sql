-- 000156_library_draft_reads.up.sql
-- #1102 Slice A: the bibliotecario authoring workspace must SEE the open
-- draft of the Granete Standard library. 000139 deliberately hid Standard
-- drafts from every granete_app connection (admin-side by design); #955
-- already introduced the transactional app.platform_admin marker and widened
-- the WRITE policies with it. This widens READS exactly the same way and no
-- further: platform staff may read drafts of owner-NULL (platform-global)
-- libraries. Org-owned drafts keep their owner-organization visibility for
-- tenants, and tenants keep the exact published-only surface they had.
-- (Platform staff already reach every library row through 000146's FOR ALL
-- policy — permissive policies compose with OR — so this migration only
-- adds the owner-NULL draft branch; it removes nothing.)

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
                  OR (app_platform_admin() AND ml.owner_organization_id IS NULL)
              )
        )
    );

UPDATE rls_policy_inventory
SET read_scope = 'platform-global-published-or-owner-organization-plus-platform-admin-standard-drafts',
    rationale = rationale || ' #1102 Slice A: platform staff (app.platform_admin) also read open drafts of platform-global libraries (authoring workspace); the tenant branch is unchanged.',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name = 'library_releases';
