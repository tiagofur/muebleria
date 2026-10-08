-- #1130 (épica #1128 / ADR-0009): OpeningProfile — the physical grip profile
-- (gola L/C, REACH…) as a catalog entity. Org-scoped from birth (the same
-- multi-org shape every catalog family carries since 000083): Granete
-- Standard defines what exists (library release, #1102); the org row is the
-- catalog copy authoring consumes. The FE mints the id (TEXT, UUID-shaped)
-- and sends it on POST, exactly as it does for every other catalog entity.
--
-- Datasheet-backed geometry columns are NULLABLE on purpose: NULL = the
-- supplier datasheet has not provided the value yet (OQ-2) — a BLOCKED
-- authoring state, never a default (#1129 fail-closed contract). A profile
-- is authorable only with datasheet_status='verified' AND every geometry
-- value present AND its auditable origin (enforced at the write boundary by
-- domain validation).
--
-- body_modifiers are DATA (constructive-role addressable, #1052): consumed
-- by the body-modifier slice, never resolver logic. bom_members are
-- references/rules (exact SKU + length rule), never a second BOM resolver.
-- version drives the If-Match guarded writes the simple catalog families use
-- (#1091/#443). Additive + re-run safe (IF NOT EXISTS); applies automatically
-- on server start.
CREATE TABLE IF NOT EXISTS opening_profiles (
    id TEXT PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    grip_type TEXT NOT NULL CHECK (grip_type IN ('gola', 'handle', 'bottom_reveal', 'none')),
    cross_section_shape TEXT CHECK (cross_section_shape IN ('L', 'C', 'J', 'flat')),
    compatible_placements TEXT[] NOT NULL DEFAULT '{}' CHECK (compatible_placements <@ ARRAY['top', 'between', 'bottom']),
    datasheet_status TEXT NOT NULL DEFAULT 'pending' CHECK (datasheet_status IN ('pending', 'verified')),
    geometry_origin TEXT,
    front_reduction_mm INTEGER CHECK (front_reduction_mm IS NULL OR front_reduction_mm >= 0),
    grip_clearance_mm INTEGER CHECK (grip_clearance_mm IS NULL OR grip_clearance_mm >= 0),
    profile_height_mm INTEGER CHECK (profile_height_mm IS NULL OR profile_height_mm > 0),
    profile_depth_mm INTEGER CHECK (profile_depth_mm IS NULL OR profile_depth_mm > 0),
    body_modifiers JSONB NOT NULL DEFAULT '[]'::jsonb,
    bom_members JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT opening_profiles_org_code_unique UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_opening_profiles_organization ON opening_profiles(organization_id, active, code);
