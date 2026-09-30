-- 000141_manufacturing_library_overlays.up.sql
-- Phase 4 of ADR-0008 (LIB-4 / #775): Organization manufacturing-library overlays,
-- 3-way rebase conflict detection, and safe upstream update tracking.

-- ─── Table: library_overlays ───────────────────────────────────────────────────
-- Represents an organization-specific overlay attached to an upstream Standard release.
-- Stores only customized parameters/rules (JSONB) and organization-owned custom resource references.
-- Does NOT clone or duplicate the canonical catalog.

CREATE TABLE library_overlays (
    id                      UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    library_id              UUID        NOT NULL REFERENCES manufacturing_libraries(id) ON DELETE CASCADE,
    base_release_id         UUID        NOT NULL REFERENCES library_releases(id),
    status                  TEXT        NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'draft', 'rebase_conflict', 'archived')),
    overrides               JSONB       NOT NULL DEFAULT '{}'::jsonb,
    custom_resource_ids     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_library_overlays_org
    ON library_overlays(organization_id);

CREATE INDEX idx_library_overlays_library
    ON library_overlays(library_id);

CREATE INDEX idx_library_overlays_base_release
    ON library_overlays(base_release_id);

ALTER TABLE library_overlays ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_overlays FORCE ROW LEVEL SECURITY;

CREATE POLICY library_overlays_read ON library_overlays
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id());

CREATE POLICY library_overlays_write ON library_overlays
    FOR ALL TO granete_app
    USING (organization_id = app_current_organization_id())
    WITH CHECK (organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON library_overlays TO granete_app;

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('library_overlays',
    'tenant-owned',
    'current-organization',
    'current-organization',
    'Manufacturing library overlays customize Granete Standard per tenant; strictly isolated by owning organization (#775 / LIB-4)');

-- ─── Table: library_overlay_conflicts ──────────────────────────────────────────
-- Stores explicit collision records detected during 3-way rebase (OLD BASE, NEW BASE, CUSTOM).
-- Blocks automated publication until explicit human resolution.

CREATE TABLE library_overlay_conflicts (
    id                      UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    overlay_id              UUID        NOT NULL REFERENCES library_overlays(id) ON DELETE CASCADE,
    organization_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    old_base_release_id     UUID        NOT NULL REFERENCES library_releases(id),
    new_base_release_id     UUID        NOT NULL REFERENCES library_releases(id),
    conflict_type           TEXT        NOT NULL
        CHECK (conflict_type IN ('same_field', 'cross_field_dependency', 'structural_incompatibility')),
    path                    TEXT        NOT NULL,
    old_base_value          JSONB       NULL,
    new_base_value          JSONB       NULL,
    custom_value            JSONB       NULL,
    status                  TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'resolved', 'ignored')),
    resolution_action       TEXT        NULL
        CHECK (resolution_action IS NULL OR resolution_action IN ('keep_custom', 'adopt_upstream', 'custom_value', 'replace_resource')),
    resolved_value          JSONB       NULL,
    resolved_by             UUID        NULL REFERENCES users(id),
    resolved_at             TIMESTAMPTZ NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_library_overlay_conflicts_overlay
    ON library_overlay_conflicts(overlay_id);

CREATE INDEX idx_library_overlay_conflicts_org
    ON library_overlay_conflicts(organization_id);

CREATE INDEX idx_library_overlay_conflicts_status
    ON library_overlay_conflicts(status);

ALTER TABLE library_overlay_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_overlay_conflicts FORCE ROW LEVEL SECURITY;

CREATE POLICY library_overlay_conflicts_read ON library_overlay_conflicts
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id());

CREATE POLICY library_overlay_conflicts_write ON library_overlay_conflicts
    FOR ALL TO granete_app
    USING (organization_id = app_current_organization_id())
    WITH CHECK (organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON library_overlay_conflicts TO granete_app;

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('library_overlay_conflicts',
    'tenant-owned',
    'current-organization',
    'current-organization',
    'Rebase conflicts detected between upstream releases and organization overrides; tenant-scoped and resolved by factory staff (#775 / LIB-4)');
