-- #667 / M1: versioned 3D assets for the hardware catalog.
-- (Spec: docs/architecture/hardware-3d-assets-and-assemblies.md §§4-7, 10, 15;
-- program #666. Documentation lives on PR #672's branch until integrated.)
--
-- 1. hardware_assets: tenant-owned asset identity (display name, declared
--    provenance/license, active|retired lifecycle). Retirement withdraws the
--    asset from NEW selections only; historical references are never rewritten.
-- 2. hardware_asset_revisions: immutable per-representation revisions
--    (skp|glb|thumbnail) with server-computed size/SHA-256, inspected content
--    type, canonical storage keys, validated origin metadata (finite values,
--    explicit units) and a validation state that starts 'pending'. Host
--    compatibility is NEVER self-declared: only #668's authorized validator
--    records evidence (hardware_asset_validations).
-- 3. hardware_asset_upload_sessions: staged upload flow
--    (start → receive → finalize → consult → cancel). A temp/partial file can
--    never read as a finished asset: finalize is the only writer of revisions
--    and verifies the bytes on disk first. Expired sessions are abandoned
--    lazily and their staged files collected best-effort.
-- 4. hardware_asset_validations: append-only evidence records bound to
--    (revision, digest, tool, result). No UPDATE/DELETE ever.
-- 5. hardwares.visual_asset_id / visual_asset_revision_id: the visual binding
--    of a hardware to an EXACT asset revision. Composite foreign keys make a
--    cross-organization or cross-asset reference impossible even via direct
--    SQL. Digest/representation are always resolved server-side from the
--    referenced rows, never trusted from client echo.
-- 6. design_revision_hardware_assets: pins frozen at DesignRevision publish
--    time ({revision, hardware} → exact asset revision + representation +
--    digest). Immutable like the revision they belong to (#392 I4/I12). R1
--    keeps asset A after the catalog moves to revision B and R2 publishes.
--
-- Classification: hardware_assets family is tenant-owned (same as the catalog
-- tables, 000094); the publish pins follow the design family (explicitly
-- shared, 000113/000114).

-- Composite FK targets -------------------------------------------------------

-- hardwares gains the composite uniqueness its own binding FKs need (additive;
-- PK id remains the single-row identity used everywhere else).
CREATE UNIQUE INDEX IF NOT EXISTS uq_hardwares_organization_id
    ON hardwares (organization_id, id);

CREATE TABLE hardware_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 255),
    -- Declared (admin-entered) provenance and license. Free text, never parsed.
    provenance TEXT NOT NULL DEFAULT '' CHECK (char_length(provenance) <= 2000),
    license TEXT NOT NULL DEFAULT '' CHECK (char_length(license) <= 2000),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_hardware_assets_org_id UNIQUE (organization_id, id)
);

CREATE INDEX idx_hardware_assets_organization ON hardware_assets(organization_id);
CREATE INDEX idx_hardware_assets_status ON hardware_assets(organization_id, status);

ALTER TABLE hardware_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE hardware_assets FORCE ROW LEVEL SECURITY;

CREATE POLICY hardware_assets_read ON hardware_assets
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id());

CREATE POLICY hardware_assets_insert ON hardware_assets
    FOR INSERT TO granete_app
    WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY hardware_assets_update ON hardware_assets
    FOR UPDATE TO granete_app
    USING (organization_id = app_current_organization_id())
    WITH CHECK (organization_id = app_current_organization_id());

-- One shared immutability guard for the append-only/immutable tables below.
CREATE OR REPLACE FUNCTION protect_hardware_asset_row_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is immutable once written', TG_TABLE_NAME;
END;
$$;

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('hardware_assets', 'tenant-owned', 'owner-organization', 'owner-organization', 'Versioned 3D asset identities for the hardware catalog (#667 M1); retirement withdraws from new selections only')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT, UPDATE ON hardware_assets TO granete_app;
REVOKE DELETE ON hardware_assets FROM granete_app;

-- Immutable revisions --------------------------------------------------------

CREATE TABLE hardware_asset_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    asset_id UUID NOT NULL REFERENCES hardware_assets(id) ON DELETE CASCADE,
    revision_number INT NOT NULL CHECK (revision_number >= 1),
    representation TEXT NOT NULL CHECK (representation IN ('skp', 'glb', 'thumbnail')),
    storage_key TEXT NOT NULL CHECK (char_length(storage_key) BETWEEN 12 AND 512),
    content_type TEXT NOT NULL CHECK (char_length(content_type) BETWEEN 3 AND 255),
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    sha256 TEXT NOT NULL CHECK (sha256 ~ '^sha256-[0-9a-f]{64}$'),
    -- Validated origin metadata (optional): explicit units, file up-axis
    -- convention and the visual anchor offset (mm). Values are finite and
    -- bounded; no renderer ever fits a mesh to a received bounding box (§7).
    origin JSONB,
    -- Server-observed byte verification at finalize time. Distinct from host
    -- compatibility, which is never self-declared: the validation state is
    -- DERIVED from the append-only evidence in hardware_asset_validations
    -- (no evidence = pending; latest evidence decides) so the revision row
    -- stays truly immutable (#668 produces the evidence).
    integrity_verified_at TIMESTAMPTZ NOT NULL,
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Composite FK targets for the hardware binding, validation evidence and
    -- publish pins (revision must belong to the exact asset).
    CONSTRAINT uq_hardware_asset_revisions_id_asset UNIQUE (id, asset_id),
    CONSTRAINT uq_hardware_asset_revisions_number UNIQUE (asset_id, revision_number),
    CONSTRAINT uq_hardware_asset_revisions_org_id UNIQUE (organization_id, id)
);

CREATE INDEX idx_hardware_asset_revisions_organization ON hardware_asset_revisions(organization_id);
CREATE INDEX idx_hardware_asset_revisions_asset ON hardware_asset_revisions(asset_id);

ALTER TABLE hardware_asset_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hardware_asset_revisions FORCE ROW LEVEL SECURITY;

CREATE POLICY hardware_asset_revisions_read ON hardware_asset_revisions
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id());

CREATE POLICY hardware_asset_revisions_insert ON hardware_asset_revisions
    FOR INSERT TO granete_app
    WITH CHECK (organization_id = app_current_organization_id());

CREATE TRIGGER protect_hardware_asset_revisions_immutable
    BEFORE UPDATE OR DELETE ON hardware_asset_revisions
    FOR EACH ROW
    EXECUTE FUNCTION protect_hardware_asset_row_immutability();

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('hardware_asset_revisions', 'tenant-owned', 'owner-organization', 'owner-organization-immutable', 'Immutable per-representation asset revisions with server-computed digest and pending host validation (#667 M1)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT ON hardware_asset_revisions TO granete_app;
REVOKE UPDATE, DELETE ON hardware_asset_revisions FROM granete_app;

-- Upload sessions ------------------------------------------------------------

CREATE TABLE hardware_asset_upload_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    representation TEXT NOT NULL CHECK (representation IN ('skp', 'glb', 'thumbnail')),
    display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 255),
    provenance TEXT NOT NULL DEFAULT '' CHECK (char_length(provenance) <= 2000),
    license TEXT NOT NULL DEFAULT '' CHECK (char_length(license) <= 2000),
    origin JSONB NULL,
    -- Staged bytes metadata (server-computed). NULL until first upload.
    staged_storage_key TEXT NULL CHECK (staged_storage_key IS NULL OR char_length(staged_storage_key) BETWEEN 12 AND 512),
    staged_content_type TEXT NULL CHECK (staged_content_type IS NULL OR char_length(staged_content_type) BETWEEN 3 AND 255),
    staged_size_bytes BIGINT NULL CHECK (staged_size_bytes IS NULL OR staged_size_bytes > 0),
    staged_sha256 TEXT NULL CHECK (staged_sha256 IS NULL OR staged_sha256 ~ '^sha256-[0-9a-f]{64}$'),
    -- When set, finalize appends revision N+1 to THIS asset instead of
    -- creating a new one ("reemplazar mediante nueva revisión"); the target
    -- must exist in the organization (validated at session start).
    target_asset_id UUID NULL REFERENCES hardware_assets(id),
    status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'finalized', 'cancelled')),
    finalized_asset_id UUID NULL,
    finalized_revision_id UUID NULL,
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_hardware_asset_upload_sessions_asset
        FOREIGN KEY (finalized_asset_id) REFERENCES hardware_assets(id),
    CONSTRAINT fk_hardware_asset_upload_sessions_revision
        FOREIGN KEY (finalized_revision_id) REFERENCES hardware_asset_revisions(id)
);

CREATE INDEX idx_hardware_asset_upload_sessions_organization ON hardware_asset_upload_sessions(organization_id);
CREATE INDEX idx_hardware_asset_upload_sessions_expired
    ON hardware_asset_upload_sessions(expires_at)
    WHERE status = 'prepared';

ALTER TABLE hardware_asset_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hardware_asset_upload_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY hardware_asset_upload_sessions_read ON hardware_asset_upload_sessions
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id());

CREATE POLICY hardware_asset_upload_sessions_insert ON hardware_asset_upload_sessions
    FOR INSERT TO granete_app
    WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY hardware_asset_upload_sessions_update ON hardware_asset_upload_sessions
    FOR UPDATE TO granete_app
    USING (organization_id = app_current_organization_id())
    WITH CHECK (organization_id = app_current_organization_id());

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('hardware_asset_upload_sessions', 'tenant-owned', 'owner-organization', 'owner-organization', 'Staged upload sessions for hardware 3D assets; only finalize creates the immutable revision (#667 M1)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT, UPDATE ON hardware_asset_upload_sessions TO granete_app;
REVOKE DELETE ON hardware_asset_upload_sessions FROM granete_app;

-- Validation evidence (producer arrives with #668; storage-writer only in M1) -

CREATE TABLE hardware_asset_validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    asset_id UUID NOT NULL,
    revision_id UUID NOT NULL,
    -- The digest the validation attests; finalize pins it to the revision's
    -- stored digest so evidence can never outlive or mismatch its bytes.
    sha256 TEXT NOT NULL CHECK (sha256 ~ '^sha256-[0-9a-f]{64}$'),
    tool TEXT NOT NULL CHECK (char_length(tool) BETWEEN 1 AND 255),
    result TEXT NOT NULL CHECK (result IN ('passed', 'failed')),
    details JSONB NOT NULL DEFAULT '{}',
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_hardware_asset_validations_revision
        FOREIGN KEY (revision_id, asset_id)
        REFERENCES hardware_asset_revisions (id, asset_id) ON DELETE CASCADE
);

CREATE INDEX idx_hardware_asset_validations_organization ON hardware_asset_validations(organization_id);
CREATE INDEX idx_hardware_asset_validations_revision ON hardware_asset_validations(revision_id);

ALTER TABLE hardware_asset_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hardware_asset_validations FORCE ROW LEVEL SECURITY;

CREATE POLICY hardware_asset_validations_read ON hardware_asset_validations
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id());

CREATE POLICY hardware_asset_validations_insert ON hardware_asset_validations
    FOR INSERT TO granete_app
    WITH CHECK (organization_id = app_current_organization_id());

CREATE TRIGGER protect_hardware_asset_validations_append_only
    BEFORE UPDATE OR DELETE ON hardware_asset_validations
    FOR EACH ROW
    EXECUTE FUNCTION protect_hardware_asset_row_immutability();

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('hardware_asset_validations', 'tenant-owned', 'owner-organization', 'owner-organization-append-only', 'Append-only authorized validation evidence per exact asset revision/digest/tool; the SketchUp host validator producer is #668 (#667 M1 contract)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT ON hardware_asset_validations TO granete_app;
REVOKE UPDATE, DELETE ON hardware_asset_validations FROM granete_app;

-- Hardware visual binding ----------------------------------------------------

ALTER TABLE hardwares
    ADD COLUMN visual_asset_id UUID NULL,
    ADD COLUMN visual_asset_revision_id UUID NULL,
    ADD CONSTRAINT fk_hardwares_visual_asset
        FOREIGN KEY (organization_id, visual_asset_id)
        REFERENCES hardware_assets (organization_id, id),
    ADD CONSTRAINT fk_hardwares_visual_asset_revision
        FOREIGN KEY (visual_asset_revision_id, visual_asset_id)
        REFERENCES hardware_asset_revisions (id, asset_id);

CREATE INDEX idx_hardwares_visual_asset ON hardwares(visual_asset_id)
    WHERE visual_asset_id IS NOT NULL;

-- DesignRevision publish pins ------------------------------------------------

CREATE TABLE design_revision_hardware_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    design_revision_id UUID NOT NULL,
    hardware_id UUID NOT NULL,
    asset_id UUID NOT NULL,
    asset_revision_id UUID NOT NULL,
    representation TEXT NOT NULL CHECK (representation IN ('skp', 'glb', 'thumbnail')),
    sha256 TEXT NOT NULL CHECK (sha256 ~ '^sha256-[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_design_revision_hardware_assets_revision
        FOREIGN KEY (design_revision_id, project_id)
        REFERENCES design_revisions (id, project_id) ON DELETE CASCADE,
    CONSTRAINT fk_design_revision_hardware_assets_hardware
        FOREIGN KEY (organization_id, hardware_id)
        REFERENCES hardwares (organization_id, id),
    CONSTRAINT fk_design_revision_hardware_assets_asset
        FOREIGN KEY (organization_id, asset_id)
        REFERENCES hardware_assets (organization_id, id),
    CONSTRAINT fk_design_revision_hardware_assets_asset_revision
        FOREIGN KEY (asset_revision_id, asset_id)
        REFERENCES hardware_asset_revisions (id, asset_id),
    CONSTRAINT uq_design_revision_hardware_assets UNIQUE (design_revision_id, hardware_id)
);

CREATE INDEX idx_design_revision_hardware_assets_organization ON design_revision_hardware_assets(organization_id);
CREATE INDEX idx_design_revision_hardware_assets_project ON design_revision_hardware_assets(project_id);
CREATE INDEX idx_design_revision_hardware_assets_revision ON design_revision_hardware_assets(design_revision_id);

ALTER TABLE design_revision_hardware_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_revision_hardware_assets FORCE ROW LEVEL SECURITY;

CREATE POLICY design_revision_hardware_assets_read ON design_revision_hardware_assets
    FOR SELECT TO granete_app
    USING (app_can_access_project(project_id));

CREATE POLICY design_revision_hardware_assets_insert ON design_revision_hardware_assets
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

CREATE TRIGGER protect_design_revision_hardware_assets_immutable
    BEFORE UPDATE OR DELETE ON design_revision_hardware_assets
    FOR EACH ROW
    EXECUTE FUNCTION protect_hardware_asset_row_immutability();

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('design_revision_hardware_assets', 'explicitly-shared', 'project-organizations', 'owner-organization-immutable', 'Hardware 3D asset pins frozen at DesignRevision publish (exact asset revision + digest per hardware); R1 never follows catalog rebinds (#667 M1)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT ON design_revision_hardware_assets TO granete_app;
REVOKE UPDATE, DELETE ON design_revision_hardware_assets FROM granete_app;
