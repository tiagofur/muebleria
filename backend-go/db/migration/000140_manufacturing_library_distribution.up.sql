-- 000140_manufacturing_library_distribution.up.sql
-- Phase 2 of ADR-0008 (LIB-2 / #773): Deterministic manufacturing-library publisher,
-- manifest and content-addressed distribution blobs.
-- Manifests and resource blobs are stored immutably in PostgreSQL to guarantee
-- transactional publication atomicity, zero filesystem drift, and cryptographic deduplication.

-- ─── Table: library_release_manifests ─────────────────────────────────────────
-- Exact materialized versioned manifest for a published release.
-- Strictly immutable once inserted.

CREATE TABLE library_release_manifests (
    id                  UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id          UUID        NOT NULL UNIQUE REFERENCES library_releases(id) ON DELETE CASCADE,
    manifest_hash       TEXT        NOT NULL,
    manifest_json       JSONB       NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_library_release_manifests_release
    ON library_release_manifests(release_id);

CREATE INDEX idx_library_release_manifests_hash
    ON library_release_manifests(manifest_hash);

ALTER TABLE library_release_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_release_manifests FORCE ROW LEVEL SECURITY;

CREATE POLICY library_release_manifests_read ON library_release_manifests
    FOR SELECT TO granete_app
    USING (
        EXISTS (
            SELECT 1 FROM library_releases lr
            JOIN manufacturing_libraries ml ON ml.id = lr.library_id
            WHERE lr.id = library_release_manifests.release_id
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

GRANT SELECT, INSERT ON library_release_manifests TO granete_app;
REVOKE UPDATE, DELETE, TRUNCATE ON library_release_manifests FROM granete_app;

CREATE OR REPLACE FUNCTION protect_library_release_manifests_immutability()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'library_release_manifests rows are immutable once created';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER protect_library_release_manifests_immutable
    BEFORE UPDATE OR DELETE ON library_release_manifests
    FOR EACH ROW EXECUTE FUNCTION protect_library_release_manifests_immutability();

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('library_release_manifests',
    'explicitly-shared',
    'platform-global-or-owner-organization',
    'owner-organization',
    'Materialized manifests are platform-global readable if standard/published, or owner-organization readable if draft/overlay; immutable once created (#773 / LIB-2)');

-- ─── Table: library_resource_blobs ───────────────────────────────────────────
-- Cryptographically content-addressed JSON definition blobs.
-- Keyed strictly by sha256. Shared seamlessly across releases, Free, Standard,
-- and organization overlays without duplication.

CREATE TABLE library_resource_blobs (
    sha256              TEXT        NOT NULL PRIMARY KEY,
    resource_kind       TEXT        NOT NULL,
    resource_id         UUID        NOT NULL,
    content_type        TEXT        NOT NULL DEFAULT 'application/json',
    size_bytes          BIGINT      NOT NULL CHECK (size_bytes >= 0),
    content             JSONB       NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_library_resource_blobs_resource
    ON library_resource_blobs(resource_kind, resource_id);

ALTER TABLE library_resource_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_resource_blobs FORCE ROW LEVEL SECURITY;

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

CREATE POLICY library_resource_blobs_insert ON library_resource_blobs
    FOR INSERT TO granete_app
    WITH CHECK (true);

GRANT SELECT, INSERT ON library_resource_blobs TO granete_app;
REVOKE UPDATE, DELETE, TRUNCATE ON library_resource_blobs FROM granete_app;

CREATE OR REPLACE FUNCTION protect_library_resource_blobs_immutability()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'library_resource_blobs rows are immutable once created';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER protect_library_resource_blobs_immutable
    BEFORE UPDATE OR DELETE ON library_resource_blobs
    FOR EACH ROW EXECUTE FUNCTION protect_library_resource_blobs_immutability();

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('library_resource_blobs',
    'explicitly-shared',
    'platform-global-or-owner-organization',
    'insert-only-actor',
    'Content-addressed resource blobs are referenced by sha256 and readable under published release RLS; immutable once inserted (#773 / LIB-2)');

-- Grant update on definition_hash so granete_app can populate hashes at release publish time
GRANT UPDATE (definition_hash) ON library_release_resource_refs TO granete_app;
