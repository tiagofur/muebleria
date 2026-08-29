-- #449 / TEN-1: transaction-scoped tenant context and PostgreSQL RLS.
--
-- The migration owner remains the schema/migration role. granete_app receives
-- only runtime privileges and owns no tables, so FORCE RLS remains effective.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'granete_app') THEN
        CREATE ROLE granete_app NOLOGIN;
    END IF;
END
$$;

ALTER ROLE granete_app
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

REVOKE SET ON PARAMETER row_security FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_current_organization_id()
RETURNS UUID
LANGUAGE SQL
STABLE
PARALLEL SAFE
AS $$
    SELECT NULLIF(current_setting('app.organization_id', TRUE), '')::UUID
$$;

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS UUID
LANGUAGE SQL
STABLE
PARALLEL SAFE
AS $$
    SELECT NULLIF(current_setting('app.user_id', TRUE), '')::UUID
$$;

CREATE OR REPLACE FUNCTION app_current_membership_id()
RETURNS UUID
LANGUAGE SQL
STABLE
PARALLEL SAFE
AS $$
    SELECT NULLIF(current_setting('app.membership_id', TRUE), '')::UUID
$$;

CREATE OR REPLACE FUNCTION app_current_support_session_id()
RETURNS UUID
LANGUAGE SQL
STABLE
PARALLEL SAFE
AS $$
    SELECT NULLIF(current_setting('app.support_session_id', TRUE), '')::UUID
$$;

CREATE OR REPLACE FUNCTION app_has_organization_access(candidate UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
PARALLEL SAFE
AS $$
    SELECT candidate = app_current_organization_id()
        OR candidate::TEXT = ANY (
            string_to_array(
                NULLIF(current_setting('app.authorized_organization_ids', TRUE), ''),
                ','
            )
        )
$$;

CREATE OR REPLACE FUNCTION lookup_open_invitation(invitation_token_hash TEXT)
RETURNS TABLE (
    id UUID,
    email VARCHAR(255),
    roles TEXT[],
    expires_at TIMESTAMPTZ,
    invited_by TEXT,
    accepted_at TIMESTAMPTZ,
    accepted_by TEXT,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    version BIGINT,
    organization_id UUID,
    organization_type TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT i.id, i.email, i.roles, i.expires_at, i.invited_by::TEXT,
           i.accepted_at, i.accepted_by::TEXT, i.revoked_at, i.created_at,
           i.version, o.id, o.type
    FROM invitations i
    JOIN organizations o ON o.id = i.organization_id
    WHERE i.token_hash = invitation_token_hash
      AND i.accepted_at IS NULL
      AND i.revoked_at IS NULL
      AND i.expires_at > NOW()
      AND o.active
$$;

REVOKE ALL ON FUNCTION lookup_open_invitation(TEXT) FROM PUBLIC;

CREATE TABLE rls_policy_inventory (
    table_name TEXT PRIMARY KEY,
    classification TEXT NOT NULL CHECK (classification IN (
        'tenant-owned', 'explicitly-shared', 'platform-global', 'append-only'
    )),
    read_scope TEXT NOT NULL,
    write_scope TEXT NOT NULL,
    rationale TEXT NOT NULL,
    policy_version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE api_idempotency_receipts
    ADD COLUMN organization_id UUID REFERENCES organizations(id),
    ADD COLUMN actor_user_id UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_api_idempotency_receipts_org_actor
    ON api_idempotency_receipts(organization_id, actor_user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_ambient_categories_organization ON ambient_categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_board_parts_organization ON board_parts(organization_id);
CREATE INDEX IF NOT EXISTS idx_damage_reports_organization ON damage_reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_hardware_lines_organization ON hardware_lines(organization_id);
CREATE INDEX IF NOT EXISTS idx_material_categories_organization ON material_categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_module_categories_organization ON module_categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_module_components_organization ON module_components(organization_id);
CREATE INDEX IF NOT EXISTS idx_module_presets_organization ON module_presets(organization_id);
CREATE INDEX IF NOT EXISTS idx_option_group_members_organization ON option_group_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_production_activities_organization ON production_activities(organization_id);
CREATE INDEX IF NOT EXISTS idx_project_internal_messages_organization ON project_internal_messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_project_item_choices_organization ON project_item_choices(organization_id);
CREATE INDEX IF NOT EXISTS idx_project_item_floor_events_organization ON project_item_floor_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_project_level_choices_organization ON project_level_choices(organization_id);
CREATE INDEX IF NOT EXISTS idx_project_photos_organization ON project_photos(organization_id);
CREATE INDEX IF NOT EXISTS idx_project_picking_organization ON project_picking(organization_id);
CREATE INDEX IF NOT EXISTS idx_project_templates_organization ON project_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_organization ON purchase_order_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_quote_snapshots_organization ON quote_snapshots(organization_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_prices_organization ON snapshot_prices(organization_id);
CREATE INDEX IF NOT EXISTS idx_structure_components_organization ON structure_components(organization_id);
CREATE INDEX IF NOT EXISTS idx_structure_presets_organization ON structure_presets(organization_id);
CREATE INDEX IF NOT EXISTS idx_structure_revisions_organization ON structure_revisions(organization_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_organization ON suppliers(organization_id);
CREATE INDEX IF NOT EXISTS idx_warranty_ticket_photos_organization ON warranty_ticket_photos(organization_id);

INSERT INTO rls_policy_inventory
    (table_name, classification, read_scope, write_scope, rationale)
VALUES
    ('agregados', 'tenant-owned', 'organization', 'organization', 'Organization-owned reusable assemblies'),
    ('ambient_categories', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog taxonomy'),
    ('ambient_materials', 'tenant-owned', 'organization', 'organization', 'Organization-owned presentation catalog'),
    ('api_idempotency_receipts', 'tenant-owned', 'actor+organization', 'actor+organization', 'Command receipts are private to the authenticated actor and tenant'),
    ('board_parts', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog BOM rows'),
    ('components', 'tenant-owned', 'organization', 'organization', 'Organization-owned component catalog'),
    ('customers', 'tenant-owned', 'organization', 'organization', 'Customer data belongs to one organization'),
    ('damage_reports', 'tenant-owned', 'organization', 'organization', 'Manufacturing execution evidence belongs to the acting organization'),
    ('edge_bands', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog'),
    ('hardware_lines', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog BOM rows'),
    ('hardwares', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog'),
    ('invitations', 'tenant-owned', 'organization', 'organization', 'Organization access command rows'),
    ('material_boards', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog'),
    ('material_categories', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog taxonomy'),
    ('material_stock', 'tenant-owned', 'organization', 'organization', 'Inventory is organization-private'),
    ('memberships', 'tenant-owned', 'organization-or-self', 'organization', 'Self lookup supports organization selection; management remains tenant-scoped'),
    ('module_categories', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog taxonomy'),
    ('module_components', 'tenant-owned', 'organization', 'organization', 'Organization-owned component composition'),
    ('module_presets', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog'),
    ('modules', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog'),
    ('option_group_members', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog relation'),
    ('option_groups', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog'),
    ('organizations', 'platform-global', 'runtime-authorized-metadata', 'platform-command', 'Organization identity is platform metadata; business rows remain isolated'),
    ('production_activities', 'tenant-owned', 'organization', 'organization', 'Physical execution belongs to the acting manufacturing organization'),
    ('project_events', 'tenant-owned', 'organization', 'organization', 'Operational event visibility follows the emitting organization'),
    ('project_internal_messages', 'tenant-owned', 'organization', 'organization', 'Internal messages are not shared commercial projections'),
    ('project_item_choices', 'explicitly-shared', 'project-organizations', 'project-organizations', 'Commercial design input is shared only with named project organizations'),
    ('project_item_floor_events', 'tenant-owned', 'organization', 'organization', 'Physical floor execution is manufacturing-private'),
    ('project_items', 'explicitly-shared', 'project-organizations', 'project-organizations', 'Quoted furniture lines are shared only with named project organizations'),
    ('project_level_choices', 'explicitly-shared', 'project-organizations', 'project-organizations', 'Commercial design input is shared only with named project organizations'),
    ('project_photos', 'tenant-owned', 'organization', 'organization', 'Media metadata remains organization-private until a projection exists'),
    ('project_picking', 'tenant-owned', 'organization', 'organization', 'Warehouse execution is manufacturing-private'),
    ('project_templates', 'tenant-owned', 'organization', 'organization', 'Organization-owned templates'),
    ('projects', 'explicitly-shared', 'owner+sales+manufacturing', 'owner+sales+manufacturing', 'Current compatibility aggregate names every authorized organization explicitly'),
    ('purchase_order_items', 'tenant-owned', 'organization', 'organization', 'Procurement is organization-private'),
    ('purchase_orders', 'tenant-owned', 'organization', 'organization', 'Procurement is organization-private'),
    ('quote_snapshots', 'explicitly-shared', 'project-organizations', 'project-organizations', 'Pinned commercial snapshot follows explicit project organizations'),
    ('schema_migrations', 'platform-global', 'migration-only', 'migration-only', 'Migration ledger is never granted to runtime'),
    ('security_audit_events', 'append-only', 'organization', 'insert-only-organization', 'Security evidence is append-only and tenant-scoped'),
    ('snapshot_prices', 'explicitly-shared', 'project-organizations', 'project-organizations', 'Pinned quote prices follow their explicit project snapshot'),
    ('stock_movements', 'append-only', 'organization', 'insert-only-organization', 'Inventory ledger is append-only and organization-private'),
    ('structure_components', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog composition'),
    ('structure_presets', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog'),
    ('structure_revisions', 'append-only', 'organization', 'insert-only-organization', 'Published structure history is append-only per organization'),
    ('structures', 'tenant-owned', 'organization', 'organization', 'Organization-owned catalog'),
    ('suppliers', 'tenant-owned', 'organization', 'organization', 'Supplier data is organization-private'),
    ('support_sessions', 'append-only', 'actor+organization+session', 'actor-start-or-end', 'Support is scoped to one audited organization and real platform actor'),
    ('user_sectors', 'tenant-owned', 'organization', 'organization', 'Sector assignments belong to a membership tenant'),
    ('users', 'platform-global', 'identity-runtime', 'identity-command', 'Global identities are not business tenant rows'),
    ('warranty_ticket_photos', 'tenant-owned', 'organization', 'organization', 'After-sales media metadata is organization-private'),
    ('warranty_tickets', 'tenant-owned', 'organization', 'organization', 'After-sales cases belong to one organization'),
    ('workshop_settings', 'tenant-owned', 'organization', 'organization', 'Settings belong to one organization'),
    ('rls_policy_inventory', 'platform-global', 'runtime-readiness', 'migration-only', 'Versioned classification registry used by CI/readiness')
ON CONFLICT (table_name) DO UPDATE SET
    classification = EXCLUDED.classification,
    read_scope = EXCLUDED.read_scope,
    write_scope = EXCLUDED.write_scope,
    rationale = EXCLUDED.rationale,
    policy_version = EXCLUDED.policy_version,
    updated_at = NOW();

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'agregados', 'ambient_categories', 'ambient_materials', 'board_parts',
        'components', 'customers', 'damage_reports', 'edge_bands',
        'hardware_lines', 'hardwares', 'invitations', 'material_boards',
        'material_categories', 'material_stock', 'module_categories',
        'module_components', 'module_presets', 'modules', 'option_group_members',
        'option_groups', 'production_activities', 'project_events',
        'project_internal_messages', 'project_item_floor_events',
        'project_photos', 'project_picking', 'project_templates',
		'purchase_order_items', 'purchase_orders', 'structure_components',
		'structure_presets', 'structures', 'suppliers',
        'user_sectors', 'warranty_ticket_photos', 'warranty_tickets',
        'workshop_settings'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (app_has_organization_access(organization_id)) WITH CHECK (app_has_organization_access(organization_id))',
            table_name
        );
    END LOOP;
END
$$;

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY project_explicit_organizations_read ON projects FOR SELECT
    USING (app_current_organization_id() IN (
        organization_id, sales_organization_id, manufacturing_organization_id
    ));
CREATE POLICY project_explicit_organizations_insert ON projects FOR INSERT
    WITH CHECK (app_current_organization_id() IN (
        organization_id, sales_organization_id, manufacturing_organization_id
    ) AND organization_id = app_current_organization_id());
CREATE POLICY project_explicit_organizations_update ON projects FOR UPDATE
    USING (app_current_organization_id() IN (
        organization_id, sales_organization_id, manufacturing_organization_id
    ))
    WITH CHECK (app_current_organization_id() IN (
        organization_id, sales_organization_id, manufacturing_organization_id
    ));
CREATE POLICY project_explicit_organizations_delete ON projects FOR DELETE
    USING (app_current_organization_id() IN (
        organization_id, sales_organization_id
    ));

CREATE OR REPLACE FUNCTION protect_project_organization_ownership()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
    IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
        OR OLD.sales_organization_id IS DISTINCT FROM NEW.sales_organization_id
        OR OLD.manufacturing_organization_id IS DISTINCT FROM NEW.manufacturing_organization_id
    THEN
        RAISE EXCEPTION 'project organization ownership requires an explicit command'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER protect_project_organization_ownership
    BEFORE UPDATE OF organization_id, sales_organization_id, manufacturing_organization_id
    ON projects
    FOR EACH ROW
    EXECUTE FUNCTION protect_project_organization_ownership();

CREATE OR REPLACE FUNCTION app_can_access_project(candidate_project_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = candidate_project_id
    )
$$;

CREATE OR REPLACE FUNCTION app_shared_child_matches_project(candidate_project_id UUID, candidate_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = candidate_project_id
          AND p.organization_id = candidate_organization_id
    )
$$;

CREATE OR REPLACE FUNCTION protect_shared_child_ownership()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
    IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
       OR to_jsonb(OLD)->>TG_ARGV[0] IS DISTINCT FROM to_jsonb(NEW)->>TG_ARGV[0]
    THEN
        RAISE EXCEPTION 'shared child ownership requires an explicit command'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$$;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'project_items', 'project_level_choices', 'quote_snapshots'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY project_explicit_organizations ON %I USING (app_can_access_project(project_id)) WITH CHECK (app_can_access_project(project_id) AND app_shared_child_matches_project(project_id, organization_id))',
            table_name
        );
		EXECUTE format(
			'CREATE TRIGGER protect_shared_child_ownership BEFORE UPDATE OF organization_id, project_id ON %I FOR EACH ROW EXECUTE FUNCTION protect_shared_child_ownership(''project_id'')',
			table_name
		);
    END LOOP;
END
$$;

ALTER TABLE project_item_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_item_choices FORCE ROW LEVEL SECURITY;
CREATE POLICY project_item_choice_explicit_organizations ON project_item_choices
    USING (
        EXISTS (
            SELECT 1 FROM project_items pi
            WHERE pi.id = project_item_choices.project_item_id
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM project_items pi
            WHERE pi.id = project_item_choices.project_item_id
              AND pi.organization_id = project_item_choices.organization_id
        )
    );
CREATE TRIGGER protect_shared_child_ownership
    BEFORE UPDATE OF organization_id, project_item_id ON project_item_choices
    FOR EACH ROW EXECUTE FUNCTION protect_shared_child_ownership('project_item_id');

ALTER TABLE snapshot_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot_prices FORCE ROW LEVEL SECURITY;
CREATE POLICY snapshot_price_explicit_organizations ON snapshot_prices
    USING (
        EXISTS (
            SELECT 1 FROM quote_snapshots qs
            WHERE qs.id = snapshot_prices.snapshot_id
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM quote_snapshots qs
            WHERE qs.id = snapshot_prices.snapshot_id
              AND qs.organization_id = snapshot_prices.organization_id
        )
    );
CREATE TRIGGER protect_shared_child_ownership
    BEFORE UPDATE OF organization_id, snapshot_id ON snapshot_prices
    FOR EACH ROW EXECUTE FUNCTION protect_shared_child_ownership('snapshot_id');

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON memberships FOR SELECT
    USING (
        organization_id = app_current_organization_id()
        OR user_id = app_current_user_id()
    );
CREATE POLICY membership_write ON memberships FOR ALL
    USING (organization_id = app_current_organization_id())
    WITH CHECK (organization_id = app_current_organization_id());

ALTER TABLE api_idempotency_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_idempotency_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_actor_scope ON api_idempotency_receipts
    USING (
        actor_user_id IS NOT DISTINCT FROM app_current_user_id()
        AND organization_id IS NOT DISTINCT FROM app_current_organization_id()
    )
    WITH CHECK (
        actor_user_id IS NOT DISTINCT FROM app_current_user_id()
        AND organization_id IS NOT DISTINCT FROM app_current_organization_id()
    );

ALTER TABLE support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY support_session_read ON support_sessions FOR SELECT
    USING (
        platform_admin_user_id = app_current_user_id()
        AND (
            id = app_current_support_session_id()
            OR organization_id = app_current_organization_id()
            OR app_current_organization_id() IS NULL
        )
    );
CREATE POLICY support_session_insert ON support_sessions FOR INSERT
    WITH CHECK (platform_admin_user_id = app_current_user_id());
CREATE POLICY support_session_update ON support_sessions FOR UPDATE
    USING (
        platform_admin_user_id = app_current_user_id()
        AND (
            (app_current_support_session_id() IS NOT NULL
             AND id = app_current_support_session_id()
             AND organization_id = app_current_organization_id())
            OR
            (app_current_support_session_id() IS NULL
             AND app_current_organization_id() IS NULL
             AND app_has_organization_access(organization_id))
        )
    )
    WITH CHECK (
        platform_admin_user_id = app_current_user_id()
        AND (
            (app_current_support_session_id() IS NOT NULL
             AND id = app_current_support_session_id()
             AND organization_id = app_current_organization_id())
            OR
            (app_current_support_session_id() IS NULL
             AND app_current_organization_id() IS NULL
             AND app_has_organization_access(organization_id))
        )
    );

CREATE OR REPLACE FUNCTION protect_support_session_scope()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
    IF OLD.platform_admin_user_id IS DISTINCT FROM NEW.platform_admin_user_id
       OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
    THEN
        RAISE EXCEPTION 'support session actor and organization are immutable'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER protect_support_session_scope
    BEFORE UPDATE OF platform_admin_user_id, organization_id ON support_sessions
    FOR EACH ROW EXECUTE FUNCTION protect_support_session_scope();

ALTER TABLE security_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY security_audit_read ON security_audit_events FOR SELECT
    USING (organization_id IS NULL OR app_has_organization_access(organization_id));
CREATE POLICY security_audit_insert ON security_audit_events FOR INSERT
    WITH CHECK (
        actor_user_id IS NOT DISTINCT FROM app_current_user_id()
        AND (
            organization_id IS NULL
            OR app_has_organization_access(organization_id)
        )
    );

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_movement_read ON stock_movements FOR SELECT
    USING (organization_id = app_current_organization_id());
CREATE POLICY stock_movement_insert ON stock_movements FOR INSERT
    WITH CHECK (organization_id = app_current_organization_id());

ALTER TABLE structure_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE structure_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY structure_revision_read ON structure_revisions FOR SELECT
    USING (organization_id = app_current_organization_id());
CREATE POLICY structure_revision_insert ON structure_revisions FOR INSERT
    WITH CHECK (organization_id = app_current_organization_id());

GRANT USAGE ON SCHEMA public TO granete_app;
GRANT EXECUTE ON FUNCTION app_current_organization_id() TO granete_app;
GRANT EXECUTE ON FUNCTION app_current_user_id() TO granete_app;
GRANT EXECUTE ON FUNCTION app_current_membership_id() TO granete_app;
GRANT EXECUTE ON FUNCTION app_current_support_session_id() TO granete_app;
GRANT EXECUTE ON FUNCTION app_has_organization_access(UUID) TO granete_app;
GRANT EXECUTE ON FUNCTION lookup_open_invitation(TEXT) TO granete_app;
GRANT EXECUTE ON FUNCTION app_can_access_project(UUID) TO granete_app;
GRANT EXECUTE ON FUNCTION app_shared_child_matches_project(UUID, UUID) TO granete_app;
GRANT SELECT ON rls_policy_inventory TO granete_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO granete_app;
REVOKE ALL ON schema_migrations FROM granete_app;
REVOKE INSERT, UPDATE, DELETE ON rls_policy_inventory FROM granete_app;
REVOKE UPDATE, DELETE ON security_audit_events FROM granete_app;
REVOKE UPDATE, DELETE ON stock_movements FROM granete_app;
REVOKE UPDATE, DELETE ON structure_revisions FROM granete_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO granete_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO granete_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO granete_app;

COMMENT ON TABLE rls_policy_inventory IS
    'TEN-1 policy registry. A public table absent from this inventory fails readiness/CI.';
