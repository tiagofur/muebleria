-- #772 [P1][LIB-1]: Manufacturing library identity, immutable releases, Free/Standard
-- packages and exact project/design pinning (Phase 1 foundation).
--
-- OWNER DECISIONS 2026-09-29:
--   * ManufacturingLibrary owns only identity/lineage. It does NOT own or copy
--     furniture/material/hardware semantic definitions — established typed domains
--     remain authoritative (ADR-0008, manufacturing-library-platform.md §6.3).
--   * Free is NOT a separate ManufacturingLibrary row. Free is expressed as
--     package_kind = 'free' on library_release_resource_refs within Standard releases.
--     This enforces the "no second catalog" invariant (§18, §22 non-goals).
--   * Granete Standard receives a deterministic fixed UUID constant. library code
--     ('0001', '0000') is a human support label ONLY — no authorization logic
--     may branch on library code (issue negative proof).
--   * Published release rows are immutable. Corrections create a new release.
--   * effective_library_release_id on design_revisions and production_releases is
--     nullable: NULL = provenance_unknown for legacy rows. No fabricated historical
--     versions are introduced (#772 acceptance criterion).
--   * Phase 1 explicitly excludes: manifest compiler/JSON distribution (LIB-2),
--     SketchUp LibraryStore/sync (LIB-3), overlay/rebase/conflict resolution (LIB-4).

-- ─── Granete Standard fixed UUID constant ─────────────────────────────────────
-- This is the ONLY authoritative identity for the Granete Standard library.
-- Any code path filtering by code='0001' for authorization is a bug.
-- Value: '00000000-0000-0000-0001-000000000001'

-- ─── Table: manufacturing_libraries ───────────────────────────────────────────
-- Mutable authoring identity for a managed library lineage.
-- Granete-owned rows have owner_organization_id IS NULL and are platform-global
-- (readable by all authenticated orgs). Organization-owned rows are tenant-scoped.

CREATE TABLE manufacturing_libraries (
    id                      UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    code                    TEXT        NOT NULL UNIQUE,      -- human label only, not auth
    kind                    TEXT        NOT NULL
        CHECK (kind IN ('standard', 'organization_overlay', 'private')),
    owner_organization_id   UUID        NULL REFERENCES organizations(id),
    upstream_library_id     UUID        NULL REFERENCES manufacturing_libraries(id),
    update_policy           TEXT        NOT NULL DEFAULT 'follow_upstream',
    status                  TEXT        NOT NULL DEFAULT 'active',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_manufacturing_libraries_owner
    ON manufacturing_libraries(owner_organization_id)
    WHERE owner_organization_id IS NOT NULL;

ALTER TABLE manufacturing_libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturing_libraries FORCE ROW LEVEL SECURITY;

-- Granete-owned (owner_organization_id IS NULL): readable by any authenticated request.
-- Org-owned: readable only by the owning organization.
CREATE POLICY manufacturing_libraries_read ON manufacturing_libraries
    FOR SELECT TO granete_app
    USING (
        owner_organization_id IS NULL
        OR owner_organization_id = app_current_organization_id()
    );

-- Only Granete-side processes (running outside normal tenant context) insert/update
-- Granete-owned libraries. Org-owned libraries are writeable by their owner org.
CREATE POLICY manufacturing_libraries_write ON manufacturing_libraries
    FOR ALL TO granete_app
    USING (
        owner_organization_id IS NOT NULL
        AND owner_organization_id = app_current_organization_id()
    )
    WITH CHECK (
        owner_organization_id IS NOT NULL
        AND owner_organization_id = app_current_organization_id()
    );

GRANT SELECT, INSERT, UPDATE ON manufacturing_libraries TO granete_app;
REVOKE DELETE, TRUNCATE ON manufacturing_libraries FROM granete_app;

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('manufacturing_libraries',
    'explicitly-shared',
    'platform-global-or-owner-organization',
    'owner-organization',
    'Granete-owned Standard library (owner_organization_id IS NULL) is platform-global readable; organization overlays are tenant-scoped to their owner (#772 / ADR-0008)');

-- ─── Table: library_releases ──────────────────────────────────────────────────
-- Immutable published snapshot of one library lineage.
-- Once published, a release row must not be mutated into a new meaning.
-- Corrections require publishing a new release version.
-- manifest_hash is NULL until LIB-2 implements the manifest compiler.

CREATE TABLE library_releases (
    id                  UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id          UUID        NOT NULL REFERENCES manufacturing_libraries(id),
    version             TEXT        NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'withdrawn')),
    schema_version      INTEGER     NOT NULL DEFAULT 1,
    min_plugin_version  TEXT        NULL,
    base_release_id     UUID        NULL REFERENCES library_releases(id),
    manifest_hash       TEXT        NULL,   -- populated by LIB-2 publisher
    changelog           TEXT        NULL,
    published_at        TIMESTAMPTZ NULL,
    published_by        UUID        NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (library_id, version)
);

CREATE INDEX idx_library_releases_library_status
    ON library_releases(library_id, status);

ALTER TABLE library_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_releases FORCE ROW LEVEL SECURITY;

-- Readable if the parent library is readable.
-- Draft releases of org-owned libraries are visible only to that org.
-- Granete Standard draft releases: not yet exposed to tenants via this RLS
-- (admin-side operations run outside tenant context).
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

-- Org-owned draft releases: writable by the owner org only.
-- Granete Standard releases: admin-side operations run outside tenant context.
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

GRANT SELECT, INSERT, UPDATE ON library_releases TO granete_app;
REVOKE DELETE, TRUNCATE ON library_releases FROM granete_app;

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('library_releases',
    'explicitly-shared',
    'platform-global-published-or-owner-organization',
    'owner-organization-draft-only',
    'Published Granete Standard releases visible to all; org overlay releases tenant-scoped; drafts restricted to owner; immutable once published (#772 / ADR-0008)');

-- ─── Table: library_release_resource_refs ─────────────────────────────────────
-- Typed references from a release to existing canonical resource revisions.
-- Does NOT own or duplicate furniture/material/hardware domain semantics.
-- package_kind distinguishes Free-eligible ('free') from Standard-only ('standard')
-- entries without creating a second catalog.
-- resource_id is a soft cross-domain ref (no FK) to keep this table domain-neutral.

CREATE TABLE library_release_resource_refs (
    id                  UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id          UUID        NOT NULL REFERENCES library_releases(id),
    resource_kind       TEXT        NOT NULL,  -- e.g. 'furniture_definition', 'hardware', 'material'
    resource_id         UUID        NOT NULL,  -- canonical domain ID (soft ref, no FK)
    resource_revision   TEXT        NOT NULL,  -- exact pinned revision/fingerprint
    definition_hash     TEXT        NULL,      -- content hash; populated by LIB-2
    package_kind        TEXT        NOT NULL
        CHECK (package_kind IN ('free', 'standard'))
);

CREATE INDEX idx_lib_release_refs_release_kind_resource
    ON library_release_resource_refs(release_id, resource_kind, resource_id);

ALTER TABLE library_release_resource_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_release_resource_refs FORCE ROW LEVEL SECURITY;

-- Inherits access from parent release via library_releases RLS semantics.
CREATE POLICY library_release_refs_read ON library_release_resource_refs
    FOR SELECT TO granete_app
    USING (
        EXISTS (
            SELECT 1 FROM library_releases lr
            JOIN manufacturing_libraries ml ON ml.id = lr.library_id
            WHERE lr.id = release_id
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

-- Only writable on draft releases (immutability of published releases).
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

GRANT SELECT, INSERT ON library_release_resource_refs TO granete_app;
REVOKE UPDATE, DELETE, TRUNCATE ON library_release_resource_refs FROM granete_app;

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('library_release_resource_refs',
    'explicitly-shared',
    'inherits-library-release-scope',
    'owner-organization-draft-only-insert',
    'Typed canonical resource references within a release; immutable once release published; package_kind separates Free/Standard without duplicating domain definitions (#772 / ADR-0008)');

-- ─── T2: Project/Design pinning columns ───────────────────────────────────────
-- The exact effective library release at each immutable boundary of the Digital Thread.
-- NULL = provenance_unknown (legacy rows without recorded library binding).
-- No historical provenance is fabricated or backfilled.
--
-- NOTE: design_revisions is where the immutable freeze happens. design_working_copies
-- may carry an active library binding while work is in progress.

ALTER TABLE design_working_copies
    ADD COLUMN effective_library_release_id UUID NULL
        REFERENCES library_releases(id);

-- design_revisions is the primary immutable boundary: the exact effective release
-- at publish time is recorded here and cannot change after the row is written.
ALTER TABLE design_revisions
    ADD COLUMN effective_library_release_id UUID NULL
        REFERENCES library_releases(id);

-- production_releases pin the library release used at production start.
ALTER TABLE production_releases
    ADD COLUMN effective_library_release_id UUID NULL
        REFERENCES library_releases(id);

-- Update the immutability trigger for design_revisions to include the new column.
CREATE OR REPLACE FUNCTION protect_design_revision_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.allow_project_cascade_delete', true) IS DISTINCT FROM 'on' THEN
            RAISE EXCEPTION 'design_revisions cannot be deleted once published';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW.id <> OLD.id OR NEW.project_id <> OLD.project_id OR NEW.organization_id <> OLD.organization_id
       OR NEW.design_id <> OLD.design_id OR NEW.revision_number <> OLD.revision_number
       OR NEW.parent_revision_id IS DISTINCT FROM OLD.parent_revision_id OR NEW.source_type <> OLD.source_type
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at
       OR NEW.created_by_display_name IS DISTINCT FROM OLD.created_by_display_name
       OR NEW.authoring_defaults_snapshot IS DISTINCT FROM OLD.authoring_defaults_snapshot
       OR NEW.effective_library_release_id IS DISTINCT FROM OLD.effective_library_release_id THEN
        RAISE EXCEPTION 'design_revision snapshot fields are immutable';
    END IF;
    IF NOT (
        OLD.status = 'published' AND NEW.status = 'approved'
        AND OLD.approved_by IS NULL AND OLD.approved_at IS NULL
        AND OLD.approved_by_display_name IS NULL
        AND NEW.approved_by IS NOT NULL AND NEW.approved_at IS NOT NULL
        AND NEW.approved_by_display_name IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'design_revisions is immutable except the published→approved approval transition';
    END IF;
    RETURN NEW;
END;
$$;

UPDATE rls_policy_inventory
SET rationale = 'Immutable design revisions freeze the working copy authoring defaults of the publish moment (#784) and the exact effective library release used (#772); alongside human-readable presentation and actor provenance; legacy rows remain explicitly unavailable (#639 / #784 / #772)',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name = 'design_revisions';

UPDATE rls_policy_inventory
SET rationale = 'Design working copies carry the durable Design-scoped authoring defaults (#784) and active library binding (#772); reads follow project organizations and writes stay with the owner organization (#387 / #810 / ADR-0003)',
    policy_version = policy_version + 1,
    updated_at = NOW()
WHERE table_name = 'design_working_copies';

-- ─── T3: Seed Granete Standard identity ───────────────────────────────────────
-- Fixed, deterministic UUID. Never derive this from any config value.
-- Free = package_kind='free' on resource refs within Standard releases.
-- No separate ManufacturingLibrary row for Free.

INSERT INTO manufacturing_libraries (id, code, kind, status, created_at, updated_at)
VALUES (
    '00000000-0000-0000-0001-000000000001',
    '0001',
    'standard',
    'active',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;

-- First Granete Standard draft release: placeholder for LIB-2 to compile content into.
-- manifest_hash remains NULL until the release is published by LIB-2.
INSERT INTO library_releases (
    id,
    library_id,
    version,
    status,
    schema_version,
    changelog,
    created_at,
    updated_at
)
VALUES (
    '00000000-0000-0000-0002-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '0.1.0-draft',
    'draft',
    1,
    'Initial Granete Standard draft release. Content refs populated by LIB-2.',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;
