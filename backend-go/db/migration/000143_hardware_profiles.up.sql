-- 000143_hardware_profiles.up.sql
-- HW-PROFILE persistence (#913): tenant-owned Hardware Profiles over the frozen
-- #912 domain contract. A profile references catalog hardware by ID (items with
-- per-application quantities) and pins the versioned ContactOperationRecipe it
-- embodies — it never copies hardware codes, prices or units.

-- ─── Table: hardware_profiles ──────────────────────────────────────────────────
-- One reusable technical/commercial application solution per organization:
-- what to buy (hardware references + quantities) and which versioned recipe
-- machines it. `version` is the optimistic-concurrency token (#443/#448):
-- server-owned, surfaced as a strong ETag "v<N>", create starts at 1 and every
-- accepted update increments it inside the update transaction (000142 style).

CREATE TABLE hardware_profiles (
    id              UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code            TEXT        NOT NULL,
    name            TEXT        NOT NULL,
    description     TEXT        NOT NULL DEFAULT '',
    revision        TEXT        NOT NULL,
    items           JSONB       NOT NULL,
    recipe_ref      JSONB       NULL,
    active          BOOLEAN     NOT NULL DEFAULT TRUE,
    version         BIGINT      NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT hardware_profiles_code_shape CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
);

CREATE UNIQUE INDEX hardware_profiles_org_code_key
    ON hardware_profiles(organization_id, code);

CREATE INDEX idx_hardware_profiles_org
    ON hardware_profiles(organization_id);

ALTER TABLE hardware_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hardware_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY hardware_profiles_read ON hardware_profiles
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id());

CREATE POLICY hardware_profiles_write ON hardware_profiles
    FOR ALL TO granete_app
    USING (organization_id = app_current_organization_id())
    WITH CHECK (organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON hardware_profiles TO granete_app;

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('hardware_profiles',
    'tenant-owned',
    'current-organization',
    'current-organization',
    'Hardware profiles are the factory-owned application solutions over Granete Standard hardware references; strictly isolated by owning organization (#913 / HW-PROFILE)');
