-- #452 expand rollback is allowed only before lifecycle/entitlement facts use
-- semantics that the legacy active boolean cannot represent.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM organizations
        WHERE status NOT IN ('active', 'suspended')
           OR credential_version <> 1
           OR status_changed_by IS NOT NULL
           OR offboarding_started_at IS NOT NULL
           OR terminated_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'cannot rollback ORG-1 lifecycle facts; restore a verified pre-migration backup'
            USING ERRCODE='55000';
    END IF;
    IF EXISTS (
        SELECT 1 FROM organization_entitlements
        WHERE max_sales_partners <> 0
           OR manufacturing_enabled
           OR sales_network_enabled
           OR sketchup_seats <> 0
           OR advanced_audit_enabled
           OR source NOT IN ('legacy_unlimited', 'platform_override')
           OR defaults_revision <> 'legacy-v1'
    ) THEN
        RAISE EXCEPTION 'cannot rollback ORG-1 entitlement facts; restore a verified pre-migration backup'
            USING ERRCODE='55000';
    END IF;
END $$;

GRANT INSERT, UPDATE, DELETE ON organizations TO granete_app;
DROP FUNCTION command_transition_organization_status(UUID,TEXT,TEXT,UUID,TEXT,BIGINT);
DROP FUNCTION command_update_organization_metadata(UUID,TEXT,TEXT,TIMESTAMPTZ,BIGINT);
DROP FUNCTION command_create_organization(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID);

DROP POLICY support_session_update ON support_sessions;
CREATE POLICY support_session_update ON support_sessions FOR UPDATE
USING (
    platform_admin_user_id=app_current_user_id()
    AND (
        (app_current_support_session_id() IS NOT NULL
         AND id=app_current_support_session_id()
         AND organization_id=app_current_organization_id())
        OR
        (app_current_support_session_id() IS NULL
         AND app_current_organization_id() IS NULL
         AND app_has_organization_access(organization_id))
    )
)
WITH CHECK (
    platform_admin_user_id=app_current_user_id()
    AND (
        (app_current_support_session_id() IS NOT NULL
         AND id=app_current_support_session_id()
         AND organization_id=app_current_organization_id())
        OR
        (app_current_support_session_id() IS NULL
         AND app_current_organization_id() IS NULL
         AND app_has_organization_access(organization_id))
    )
);

DROP POLICY snapshot_price_write ON snapshot_prices;
DROP POLICY snapshot_price_read ON snapshot_prices;
CREATE POLICY snapshot_price_explicit_organizations ON snapshot_prices
USING (EXISTS (SELECT 1 FROM quote_snapshots qs WHERE qs.id=snapshot_prices.snapshot_id))
WITH CHECK (EXISTS (
    SELECT 1 FROM quote_snapshots qs
     WHERE qs.id=snapshot_prices.snapshot_id
       AND qs.organization_id=snapshot_prices.organization_id
));

DROP POLICY project_item_choice_write ON project_item_choices;
DROP POLICY project_item_choice_read ON project_item_choices;
CREATE POLICY project_item_choice_explicit_organizations ON project_item_choices
USING (EXISTS (SELECT 1 FROM project_items pi WHERE pi.id=project_item_choices.project_item_id))
WITH CHECK (EXISTS (
    SELECT 1 FROM project_items pi
     WHERE pi.id=project_item_choices.project_item_id
       AND pi.organization_id=project_item_choices.organization_id
));

DO $$
DECLARE table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['project_items', 'project_level_choices', 'quote_snapshots'] LOOP
        EXECUTE format('DROP POLICY project_shared_delete ON %I', table_name);
        EXECUTE format('DROP POLICY project_shared_update ON %I', table_name);
        EXECUTE format('DROP POLICY project_shared_insert ON %I', table_name);
        EXECUTE format('DROP POLICY project_shared_read ON %I', table_name);
        EXECUTE format(
            'CREATE POLICY project_explicit_organizations ON %I USING (app_can_access_project(project_id)) WITH CHECK (app_can_access_project(project_id) AND app_shared_child_matches_project(project_id, organization_id))',
            table_name
        );
    END LOOP;
END $$;

DROP POLICY structure_revision_insert ON structure_revisions;
CREATE POLICY structure_revision_insert ON structure_revisions FOR INSERT
WITH CHECK (organization_id=app_current_organization_id());
DROP POLICY stock_movement_insert ON stock_movements;
CREATE POLICY stock_movement_insert ON stock_movements FOR INSERT
WITH CHECK (organization_id=app_current_organization_id());

DROP POLICY project_explicit_organizations_delete ON projects;
CREATE POLICY project_explicit_organizations_delete ON projects FOR DELETE
USING (app_current_organization_id() IN (organization_id, sales_organization_id));
DROP POLICY project_explicit_organizations_update ON projects;
CREATE POLICY project_explicit_organizations_update ON projects FOR UPDATE
USING (app_current_organization_id() IN (organization_id, sales_organization_id, manufacturing_organization_id))
WITH CHECK (app_current_organization_id() IN (organization_id, sales_organization_id, manufacturing_organization_id));
DROP POLICY project_explicit_organizations_insert ON projects;
CREATE POLICY project_explicit_organizations_insert ON projects FOR INSERT
WITH CHECK (
    app_current_organization_id() IN (organization_id, sales_organization_id, manufacturing_organization_id)
    AND organization_id=app_current_organization_id()
);

DROP POLICY tenant_isolation ON organization_entitlements;
CREATE POLICY tenant_isolation ON organization_entitlements
USING (organization_id=app_current_organization_id())
WITH CHECK (organization_id=app_current_organization_id());
DROP POLICY tenant_isolation ON organization_team_state;
CREATE POLICY tenant_isolation ON organization_team_state
USING (organization_id=app_current_organization_id())
WITH CHECK (organization_id=app_current_organization_id());

DROP POLICY membership_write ON memberships;
CREATE POLICY membership_write ON memberships FOR ALL
USING (organization_id=app_current_organization_id())
WITH CHECK (organization_id=app_current_organization_id());

DO $$
DECLARE table_name TEXT;
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
        'structure_presets', 'structures', 'suppliers', 'membership_sectors',
        'warranty_ticket_photos', 'warranty_tickets', 'workshop_settings'
    ] LOOP
        EXECUTE format('DROP POLICY tenant_delete ON %I', table_name);
        EXECUTE format('DROP POLICY tenant_update ON %I', table_name);
        EXECUTE format('DROP POLICY tenant_insert ON %I', table_name);
        EXECUTE format('DROP POLICY tenant_read ON %I', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (app_has_organization_access(organization_id)) WITH CHECK (app_has_organization_access(organization_id))',
            table_name
        );
    END LOOP;
END $$;

REVOKE ALL ON FUNCTION app_can_write_organization(UUID) FROM granete_app;
DROP FUNCTION app_can_write_organization(UUID);
REVOKE ALL ON FUNCTION app_current_user_is_platform_admin() FROM granete_app;
DROP FUNCTION app_current_user_is_platform_admin();

DROP TRIGGER enforce_team_invariants_from_organizations ON organizations;
CREATE CONSTRAINT TRIGGER enforce_team_invariants_from_organizations
AFTER INSERT OR UPDATE OF active ON organizations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_team_invariants_from_organization();

CREATE OR REPLACE FUNCTION check_organization_team_invariants(target UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE active_org BOOLEAN; admins INTEGER; members INTEGER; max_members INTEGER; bootstrap_pending BOOLEAN;
BEGIN
    SELECT o.active, s.active_admin_count, s.active_member_count,
           e.max_active_members, s.admin_bootstrap_pending
      INTO active_org, admins, members, max_members, bootstrap_pending
      FROM organizations o
      JOIN organization_team_state s ON s.organization_id = o.id
      JOIN organization_entitlements e ON e.organization_id = o.id
     WHERE o.id = target;
    IF active_org AND admins = 0 AND NOT bootstrap_pending THEN
        RAISE EXCEPTION 'organization team invariant: active organization requires an active admin'
            USING ERRCODE='23514', CONSTRAINT='organization_requires_active_admin';
    END IF;
    IF max_members IS NOT NULL AND members > max_members THEN
        RAISE EXCEPTION 'organization team invariant: active member seat limit exceeded'
            USING ERRCODE='23514', CONSTRAINT='organization_active_member_seat_limit';
    END IF;
END $$;

DROP FUNCTION lock_open_invitation_by_hash(TEXT);
CREATE FUNCTION lock_open_invitation_by_hash(invitation_token_hash TEXT)
RETURNS TABLE (
    id UUID, normalized_email VARCHAR(255), roles TEXT[], status TEXT,
    expires_at TIMESTAMPTZ, invited_by UUID, accepted_at TIMESTAMPTZ,
    accepted_by UUID, revoked_at TIMESTAMPTZ, revoked_by UUID,
    revoked_reason TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
    version BIGINT, organization_id UUID, organization_type TEXT,
    current_token BOOLEAN
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public ROWS 1
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='invitations'
           AND column_name='previous_token_hashes'
    ) THEN
        RETURN QUERY EXECUTE $query$
            SELECT i.id, i.normalized_email, i.roles, i.status, i.expires_at,
                   i.invited_by, i.accepted_at, i.accepted_by, i.revoked_at,
                   i.revoked_by, i.revoked_reason, i.created_at, i.updated_at,
                   i.version, o.id, o.type, i.token_hash = $1
              FROM invitations i JOIN organizations o ON o.id=i.organization_id
             WHERE (i.token_hash=$1 OR $1=ANY(i.previous_token_hashes))
               AND o.active
             FOR UPDATE OF i
        $query$ USING invitation_token_hash;
    ELSE
        RETURN QUERY EXECUTE $query$
            SELECT i.id, i.normalized_email, i.roles, i.status, i.expires_at,
                   i.invited_by, i.accepted_at, i.accepted_by, i.revoked_at,
                   i.revoked_by, i.revoked_reason, i.created_at, i.updated_at,
                   i.version, o.id, o.type, i.token_hash = $1
              FROM invitations i JOIN organizations o ON o.id=i.organization_id
             WHERE i.token_hash=$1 AND o.active
             FOR UPDATE OF i
        $query$ USING invitation_token_hash;
    END IF;
END
$$;

ALTER TABLE organization_entitlements
    DROP CONSTRAINT organization_entitlements_source_check,
    DROP CONSTRAINT organization_entitlements_defaults_revision_check,
    DROP CONSTRAINT organization_entitlements_sketchup_seats_check,
    DROP CONSTRAINT organization_entitlements_max_sales_partners_check,
    DROP COLUMN defaults_revision,
    DROP COLUMN advanced_audit_enabled,
    DROP COLUMN sketchup_seats,
    DROP COLUMN sales_network_enabled,
    DROP COLUMN manufacturing_enabled,
    DROP COLUMN max_sales_partners;

UPDATE organization_entitlements
SET source = CASE WHEN source = 'platform_override' THEN 'provisioned' ELSE source END;

ALTER TABLE organization_entitlements
    ADD CONSTRAINT organization_entitlements_source_check CHECK (source IN ('legacy_unlimited', 'provisioned'));

UPDATE rls_policy_inventory
SET policy_version = GREATEST(1, policy_version - 1),
    rationale = 'Explicit tenant entitlement authority; NULL seat limit is legacy unlimited',
    updated_at = NOW()
WHERE table_name = 'organization_entitlements';

DROP INDEX idx_organizations_recovery;
DROP INDEX idx_organizations_parent_status;
DROP INDEX idx_organizations_status;

ALTER TABLE organizations
    DROP CONSTRAINT organizations_termination_timestamp_check,
    DROP CONSTRAINT organizations_offboarding_timestamp_check,
    DROP CONSTRAINT organizations_status_reason_check,
    DROP CONSTRAINT organizations_credential_version_check,
    DROP CONSTRAINT organizations_status_check,
    DROP COLUMN terminated_at,
    DROP COLUMN offboarding_started_at,
    DROP COLUMN suspended_at,
    DROP COLUMN status_reason,
    DROP COLUMN status_changed_by,
    DROP COLUMN status_changed_at,
    DROP COLUMN credential_version,
    DROP COLUMN status;
