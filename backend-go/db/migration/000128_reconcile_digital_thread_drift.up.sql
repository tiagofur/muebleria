-- Upgrade reconciliation, same class as 000126/000127: databases that
-- applied intermediate versions of several migration files before their
-- final commits are silently missing objects and constraints, because
-- applied migrations never rerun. Known instances on the 2026-09-02..09-08
-- development window: 000105/000106/000108/000109 (identity registry shape),
-- 000113/000115 (design working copies, quote immutability backstops,
-- revision column types/checks) and 000124 (pairing grant provenance). This
-- migration recreates the missing objects idempotently with their canonical
-- definitions; fresh databases already match and are unchanged.

-- --- design_working_copies (final 000113 definition) --------------------------

CREATE TABLE IF NOT EXISTS design_working_copies (
    design_id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    base_revision_id UUID NULL,
    source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('sketchup', 'proyectar', 'import', 'system', 'manual')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL DEFAULT '',
    CONSTRAINT fk_design_working_copies_design_project
        FOREIGN KEY (design_id, project_id)
        REFERENCES designs(id, project_id)
        ON DELETE CASCADE
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_design_working_copies_base_revision') THEN
        ALTER TABLE design_working_copies
            ADD CONSTRAINT fk_design_working_copies_base_revision
            FOREIGN KEY (base_revision_id, design_id)
            REFERENCES design_revisions(id, design_id)
            ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_design_working_copies_project ON design_working_copies(project_id);
CREATE INDEX IF NOT EXISTS idx_design_working_copies_organization ON design_working_copies(organization_id);

ALTER TABLE design_working_copies ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_working_copies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS design_working_copies_read ON design_working_copies;
CREATE POLICY design_working_copies_read ON design_working_copies
    FOR SELECT TO granete_app
    USING (app_can_access_project(project_id));

DROP POLICY IF EXISTS design_working_copies_insert ON design_working_copies;
CREATE POLICY design_working_copies_insert ON design_working_copies
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

DROP POLICY IF EXISTS design_working_copies_update ON design_working_copies;
CREATE POLICY design_working_copies_update ON design_working_copies
    FOR UPDATE TO granete_app
    USING (
        app_can_access_project(project_id)
        AND organization_id = app_current_organization_id()
    )
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

DROP TRIGGER IF EXISTS protect_shared_child_ownership_working_copies ON design_working_copies;
CREATE TRIGGER protect_shared_child_ownership_working_copies
    BEFORE UPDATE OF organization_id, project_id ON design_working_copies
    FOR EACH ROW
    EXECUTE FUNCTION protect_shared_child_ownership('project_id');

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('design_working_copies', 'explicitly-shared', 'project-organizations', 'owner-organization', 'Design working copy tracks the mutable authoring draft of a design (#387 / ADR-0003)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT, UPDATE, DELETE ON design_working_copies TO granete_app;

-- --- design_working_items (final 000113 definition) ---------------------------

CREATE TABLE IF NOT EXISTS design_working_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    design_id UUID NOT NULL,
    furniture_instance_id UUID NOT NULL,
    furniture_definition_id UUID NULL REFERENCES modules(id) ON DELETE SET NULL,
    definition_version INTEGER NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    material_choices JSONB NOT NULL DEFAULT '{}'::jsonb,
    transform JSONB NOT NULL,
    room_id TEXT NULL,
    technical_client_locator JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_design_working_items_design
        FOREIGN KEY (design_id, project_id)
        REFERENCES designs(id, project_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_design_working_items_instance
        FOREIGN KEY (furniture_instance_id, project_id)
        REFERENCES furniture_instances(id, project_id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_design_working_items_design_instance
    ON design_working_items(design_id, furniture_instance_id);
CREATE INDEX IF NOT EXISTS idx_design_working_items_organization ON design_working_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_design_working_items_project ON design_working_items(project_id);
CREATE INDEX IF NOT EXISTS idx_design_working_items_design ON design_working_items(design_id);
CREATE INDEX IF NOT EXISTS idx_design_working_items_instance ON design_working_items(furniture_instance_id);

ALTER TABLE design_working_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_working_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS design_working_items_read ON design_working_items;
CREATE POLICY design_working_items_read ON design_working_items
    FOR SELECT TO granete_app
    USING (app_can_access_project(project_id));

DROP POLICY IF EXISTS design_working_items_insert ON design_working_items;
CREATE POLICY design_working_items_insert ON design_working_items
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

DROP POLICY IF EXISTS design_working_items_update ON design_working_items;
CREATE POLICY design_working_items_update ON design_working_items
    FOR UPDATE TO granete_app
    USING (
        app_can_access_project(project_id)
        AND organization_id = app_current_organization_id()
    )
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
    );

DROP POLICY IF EXISTS design_working_items_delete ON design_working_items;
CREATE POLICY design_working_items_delete ON design_working_items
    FOR DELETE TO granete_app
    USING (
        app_can_access_project(project_id)
        AND organization_id = app_current_organization_id()
    );

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('design_working_items', 'explicitly-shared', 'project-organizations', 'owner-organization', 'Design working items represent the draft furniture instance positions and parameters in the working copy (#387 / ADR-0003)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT SELECT, INSERT, UPDATE, DELETE ON design_working_items TO granete_app;

-- --- design_pairing_grants provenance column (final 000124 definition) -------

ALTER TABLE design_pairing_grants ADD COLUMN IF NOT EXISTS created_by_session_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'design_pairing_grants_created_by_session_id_fkey') THEN
        ALTER TABLE design_pairing_grants
            ADD CONSTRAINT design_pairing_grants_created_by_session_id_fkey
            FOREIGN KEY (created_by_session_id) REFERENCES auth_sessions(id);
    END IF;
END
$$;

-- NOT NULL only converges when no drifted rows lack provenance: the creating
-- session of a historical grant cannot be reconstructed, so databases holding
-- such rows keep the column nullable (runtime always supplies it) instead of
-- failing the reconciliation.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM design_pairing_grants WHERE created_by_session_id IS NULL) THEN
        ALTER TABLE design_pairing_grants ALTER COLUMN created_by_session_id SET NOT NULL;
    END IF;
END
$$;

-- --- design revision shape (final 000113 definitions) -------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'design_revision_items' AND column_name = 'definition_version'
          AND data_type = 'text'
    ) THEN
        ALTER TABLE design_revision_items
            ALTER COLUMN definition_version TYPE INTEGER
            USING NULLIF(btrim(definition_version), '')::INTEGER;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'design_revisions_source_type_check'
          AND pg_get_constraintdef(oid) LIKE '%manual%'
    ) THEN
        ALTER TABLE design_revisions DROP CONSTRAINT design_revisions_source_type_check;
        ALTER TABLE design_revisions
            ADD CONSTRAINT design_revisions_source_type_check
            CHECK (source_type IN ('sketchup', 'proyectar', 'import', 'system', 'manual'));
    END IF;
END
$$;

-- --- identity registry shape (final 000105/000106/000108/000109 definitions) --

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_id_user_key') THEN
        ALTER TABLE memberships ADD CONSTRAINT memberships_id_user_key UNIQUE (id, user_id);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_sessions_scope_shape') THEN
        ALTER TABLE auth_sessions
            ADD CONSTRAINT auth_sessions_scope_shape CHECK (
                (
                    client_type = 'support'
                    AND support_session_id IS NOT NULL
                    AND membership_id IS NULL
                    AND active_organization_id IS NOT NULL
                )
                OR (
                    client_type <> 'support'
                    AND support_session_id IS NULL
                    AND (
                        (membership_id IS NULL AND active_organization_id IS NULL)
                        OR (membership_id IS NOT NULL AND active_organization_id IS NOT NULL)
                    )
                )
            );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_sessions_membership_user_fk') THEN
        ALTER TABLE auth_sessions
            ADD CONSTRAINT auth_sessions_membership_user_fk
                FOREIGN KEY (membership_id, user_id)
                REFERENCES memberships (id, user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_sessions_membership_organization_fk') THEN
        ALTER TABLE auth_sessions
            ADD CONSTRAINT auth_sessions_membership_organization_fk
                FOREIGN KEY (membership_id, active_organization_id)
                REFERENCES memberships (id, organization_id);
    END IF;
    -- The intermediate 000105 carried standalone membership/org FKs with
    -- ON DELETE SET NULL; the final version keeps only the composite FKs so
    -- sessions never silently detach from a soft-lifecycle membership.
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_sessions_membership_id_fkey') THEN
        ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_membership_id_fkey;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'auth_sessions_active_organization_id_fkey'
          AND pg_get_constraintdef(oid) LIKE '%SET NULL%'
    ) THEN
        ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_active_organization_id_fkey;
        ALTER TABLE auth_sessions
            ADD CONSTRAINT auth_sessions_active_organization_id_fkey
                FOREIGN KEY (active_organization_id) REFERENCES organizations(id);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_refresh_family_membership_user_fk') THEN
        ALTER TABLE auth_refresh_families
            ADD CONSTRAINT auth_refresh_family_membership_user_fk
                FOREIGN KEY (membership_id, user_id)
                REFERENCES memberships (id, user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_refresh_family_membership_organization_fk') THEN
        ALTER TABLE auth_refresh_families
            ADD CONSTRAINT auth_refresh_family_membership_organization_fk
                FOREIGN KEY (membership_id, active_organization_id)
                REFERENCES memberships (id, organization_id);
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_mfa_factor_enabled_shape') THEN
        ALTER TABLE auth_mfa_factors DROP CONSTRAINT auth_mfa_factor_enabled_shape;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_mfa_factor_revoked_shape') THEN
        ALTER TABLE auth_mfa_factors DROP CONSTRAINT auth_mfa_factor_revoked_shape;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_mfa_factor_enabled_shape') THEN
        ALTER TABLE auth_mfa_factors
            ADD CONSTRAINT auth_mfa_factor_enabled_shape
            CHECK (status <> 'enabled' OR enabled_at IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_mfa_factor_pending_shape') THEN
        ALTER TABLE auth_mfa_factors
            ADD CONSTRAINT auth_mfa_factor_pending_shape
            CHECK (status <> 'pending' OR (enabled_at IS NULL AND revoked_at IS NULL));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_mfa_factor_revoked_shape') THEN
        ALTER TABLE auth_mfa_factors
            ADD CONSTRAINT auth_mfa_factor_revoked_shape
            CHECK (status <> 'revoked' OR revoked_at IS NOT NULL);
    END IF;
END
$$;

-- The intermediate 000108 created a redundant code-lookup index that the
-- final version dropped in favor of the unique code constraint.
DROP INDEX IF EXISTS idx_auth_device_enrollments_code;

-- --- quote revision immutability backstops (final 000115/000117 definitions) --

CREATE OR REPLACE FUNCTION protect_quote_revision_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'quote_revisions cannot be deleted once created';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id <> OLD.id OR NEW.project_id <> OLD.project_id OR NEW.organization_id <> OLD.organization_id THEN
            RAISE EXCEPTION 'quote_revision identity and project ownership are immutable';
        END IF;
        IF NEW.revision_number <> OLD.revision_number THEN
            RAISE EXCEPTION 'quote_revision revision_number is immutable';
        END IF;
        IF NEW.source_type <> OLD.source_type THEN
            RAISE EXCEPTION 'quote_revision source_type is immutable';
        END IF;
        IF NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'quote_revision created_at is immutable';
        END IF;
        IF NEW.base_quote_revision_id IS DISTINCT FROM OLD.base_quote_revision_id THEN
            RAISE EXCEPTION 'quote_revision base_quote_revision_id is immutable';
        END IF;
        IF NEW.source_design_revision_id IS DISTINCT FROM OLD.source_design_revision_id THEN
            RAISE EXCEPTION 'quote_revision source_design_revision_id is immutable';
        END IF;

        IF NEW.status <> OLD.status THEN
            IF OLD.status = 'draft' AND NEW.status <> 'published' THEN
                RAISE EXCEPTION 'draft quote_revision can only transition to published, not %', NEW.status;
            END IF;
            IF OLD.status = 'superseded' THEN
                RAISE EXCEPTION 'superseded quote_revision cannot transition to %', NEW.status;
            END IF;
            IF OLD.status = 'accepted' AND NEW.status <> 'superseded' THEN
                RAISE EXCEPTION 'accepted quote_revision can only transition to superseded, not %', NEW.status;
            END IF;
            IF OLD.status = 'published' AND NEW.status NOT IN ('accepted', 'superseded') THEN
                RAISE EXCEPTION 'published quote_revision can only transition to accepted or superseded, not %', NEW.status;
            END IF;
        END IF;

        IF OLD.status IN ('published', 'accepted', 'superseded') AND NEW.notes IS DISTINCT FROM OLD.notes THEN
            RAISE EXCEPTION '% quote_revision content cannot be modified', OLD.status;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_quote_revision_item_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'quote_revision_items is immutable once created';
END;
$$;

DROP TRIGGER IF EXISTS protect_quote_revisions_immutable ON quote_revisions;
CREATE TRIGGER protect_quote_revisions_immutable
    BEFORE UPDATE OR DELETE ON quote_revisions
    FOR EACH ROW
    EXECUTE FUNCTION protect_quote_revision_immutability();

DROP TRIGGER IF EXISTS protect_quote_revision_items_immutable ON quote_revision_items;
CREATE TRIGGER protect_quote_revision_items_immutable
    BEFORE UPDATE OR DELETE ON quote_revision_items
    FOR EACH ROW
    EXECUTE FUNCTION protect_quote_revision_item_immutability();
