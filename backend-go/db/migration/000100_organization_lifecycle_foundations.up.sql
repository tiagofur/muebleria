-- #452 / ORG-1: explicit organization lifecycle, credential epochs, and the
-- complete tenant entitlement authority. The legacy active flag remains only
-- for the bounded expand window and is removed by 000101.

ALTER TABLE organizations
    ADD COLUMN status TEXT,
    ADD COLUMN credential_version BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN status_changed_at TIMESTAMPTZ,
    ADD COLUMN status_changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN status_reason TEXT,
    ADD COLUMN suspended_at TIMESTAMPTZ,
    ADD COLUMN offboarding_started_at TIMESTAMPTZ,
    ADD COLUMN terminated_at TIMESTAMPTZ;

UPDATE organizations
SET status = CASE WHEN active THEN 'active' ELSE 'suspended' END,
    status_changed_at = updated_at,
    status_reason = CASE WHEN active THEN NULL ELSE 'legacy inactive organization' END,
    suspended_at = CASE WHEN active THEN NULL ELSE updated_at END;

ALTER TABLE organizations
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN status SET DEFAULT 'provisioning',
    ALTER COLUMN status_changed_at SET NOT NULL,
    ALTER COLUMN status_changed_at SET DEFAULT NOW(),
    ADD CONSTRAINT organizations_status_check CHECK (status IN (
        'provisioning', 'active', 'suspended', 'offboarding', 'terminated', 'provisioning_failed'
    )),
    ADD CONSTRAINT organizations_credential_version_check CHECK (credential_version >= 1),
    ADD CONSTRAINT organizations_status_reason_check CHECK (
        status NOT IN ('suspended', 'offboarding', 'terminated', 'provisioning_failed')
        OR nullif(btrim(status_reason), '') IS NOT NULL
    ),
    ADD CONSTRAINT organizations_offboarding_timestamp_check CHECK (
        status NOT IN ('offboarding', 'terminated') OR offboarding_started_at IS NOT NULL
    ),
    ADD CONSTRAINT organizations_termination_timestamp_check CHECK (
        status <> 'terminated' OR terminated_at IS NOT NULL
    );

CREATE INDEX idx_organizations_status ON organizations(status);
CREATE INDEX idx_organizations_parent_status ON organizations(parent_organization_id, status);
CREATE INDEX idx_organizations_recovery ON organizations(status, updated_at DESC)
    WHERE status IN ('suspended', 'offboarding', 'provisioning_failed');

-- Some upgrade fixtures predate the bootstrap marker while already carrying
-- the team-state table. Normalize that historical shape before replacing the
-- trigger functions below.
ALTER TABLE organization_team_state
    ADD COLUMN IF NOT EXISTS admin_bootstrap_pending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE FUNCTION app_can_write_organization(candidate UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT app_has_organization_access(candidate)
       AND EXISTS (
            SELECT 1 FROM organizations o
             WHERE o.id = candidate
               AND (
                    o.status = 'active'
                    OR (
                        o.status = 'provisioning'
                        AND candidate::TEXT = ANY(string_to_array(
                            NULLIF(current_setting('app.authorized_organization_ids', TRUE), ''), ','
                        ))
                    )
               )
       )
$$;

REVOKE ALL ON FUNCTION app_can_write_organization(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_write_organization(UUID) TO granete_app;

CREATE FUNCTION app_current_user_is_platform_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users
         WHERE id=app_current_user_id()
           AND platform_admin
           AND account_status='active'
    )
$$;
REVOKE ALL ON FUNCTION app_current_user_is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_user_is_platform_admin() TO granete_app;

CREATE FUNCTION command_create_organization(
    p_name TEXT,
    p_slug TEXT,
    p_type TEXT,
    p_license_plan TEXT,
    p_license_expires_at TIMESTAMPTZ,
    p_status TEXT,
    p_status_reason TEXT,
    p_status_changed_by UUID,
    p_parent_organization_id UUID
) RETURNS SETOF organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    runtime_caller BOOLEAN := session_user = 'granete_app'
        OR current_setting('role', TRUE) = 'granete_app';
    current_organization UUID := app_current_organization_id();
BEGIN
    IF runtime_caller THEN
        IF p_status_changed_by IS DISTINCT FROM app_current_user_id() THEN
            RAISE EXCEPTION 'organization create actor mismatch' USING ERRCODE='42501';
        END IF;
        IF app_current_user_is_platform_admin() AND current_organization IS NULL THEN
            NULL;
        ELSIF current_organization IS NOT NULL
          AND p_parent_organization_id = current_organization
          AND p_type IN ('store', 'dealer')
          AND p_license_plan = 'none'
          AND p_status = 'provisioning'
          AND EXISTS (
              SELECT 1 FROM organizations source
              JOIN memberships membership ON membership.organization_id=source.id
               AND membership.user_id=app_current_user_id()
               AND membership.status='active'
               AND membership.roles @> ARRAY['admin']::TEXT[]
              WHERE source.id=current_organization
                AND source.type='factory'
                AND source.status='active'
          ) THEN
            NULL;
        ELSE
            RAISE EXCEPTION 'organization create is not authorized' USING ERRCODE='42501';
        END IF;
    END IF;

    RETURN QUERY
    INSERT INTO organizations (
        name, slug, type, license_plan, license_expires_at, status,
        status_reason, status_changed_by, parent_organization_id
    ) VALUES (
        p_name, p_slug, p_type, p_license_plan, p_license_expires_at, p_status,
        nullif(p_status_reason, ''), p_status_changed_by, p_parent_organization_id
    )
    RETURNING *;
END
$$;

CREATE FUNCTION command_update_organization_metadata(
    p_id UUID,
    p_name TEXT,
    p_license_plan TEXT,
    p_license_expires_at TIMESTAMPTZ,
    p_expected_version BIGINT
) RETURNS SETOF organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    runtime_caller BOOLEAN := session_user = 'granete_app'
        OR current_setting('role', TRUE) = 'granete_app';
BEGIN
    IF runtime_caller AND (
        NOT app_current_user_is_platform_admin()
        OR app_current_organization_id() IS NOT NULL
        OR p_expected_version IS NULL
    ) THEN
        RAISE EXCEPTION 'organization metadata update is not authorized' USING ERRCODE='42501';
    END IF;
    RETURN QUERY
    UPDATE organizations
       SET name=p_name,
           license_plan=p_license_plan,
           license_expires_at=p_license_expires_at,
           updated_at=NOW(),
           version=version+1
     WHERE id=p_id
       AND (p_expected_version IS NULL OR version=p_expected_version)
    RETURNING *;
END
$$;

CREATE FUNCTION command_transition_organization_status(
    p_id UUID,
    p_from TEXT,
    p_to TEXT,
    p_actor UUID,
    p_reason TEXT,
    p_expected_version BIGINT
) RETURNS SETOF organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    runtime_caller BOOLEAN := session_user = 'granete_app'
        OR current_setting('role', TRUE) = 'granete_app';
    current_organization UUID := app_current_organization_id();
BEGIN
    IF NOT (
        (p_from='provisioning' AND p_to IN ('active','provisioning_failed'))
        OR (p_from='provisioning_failed' AND p_to IN ('provisioning','terminated'))
        OR (p_from='active' AND p_to IN ('suspended','offboarding'))
        OR (p_from='suspended' AND p_to IN ('active','offboarding'))
        OR (p_from='offboarding' AND p_to='terminated')
    ) THEN
        RAISE EXCEPTION 'invalid organization status transition' USING ERRCODE='22023';
    END IF;
    IF p_to <> 'active' AND nullif(btrim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'organization lifecycle reason is required' USING ERRCODE='22023';
    END IF;
    IF runtime_caller THEN
        IF p_actor IS DISTINCT FROM app_current_user_id() THEN
            RAISE EXCEPTION 'organization lifecycle actor mismatch' USING ERRCODE='42501';
        END IF;
        IF app_current_user_is_platform_admin() AND current_organization IS NULL THEN
            NULL;
        ELSIF p_from='provisioning' AND p_to='active'
          AND EXISTS (
              SELECT 1 FROM organizations child
              JOIN organizations source ON source.id=child.parent_organization_id
              JOIN memberships membership ON membership.organization_id=source.id
               AND membership.user_id=app_current_user_id()
               AND membership.status='active'
               AND membership.roles @> ARRAY['admin']::TEXT[]
              WHERE child.id=p_id
                AND child.parent_organization_id=current_organization
                AND child.id::TEXT = ANY(string_to_array(
                    NULLIF(current_setting('app.authorized_organization_ids', TRUE), ''), ','
                ))
                AND source.type='factory'
                AND source.status='active'
          ) THEN
            NULL;
        ELSE
            RAISE EXCEPTION 'organization lifecycle transition is not authorized' USING ERRCODE='42501';
        END IF;
    END IF;

    RETURN QUERY
    UPDATE organizations
       SET status=p_to,
           status_changed_at=NOW(),
           status_changed_by=p_actor,
           status_reason=nullif(btrim(p_reason), ''),
           suspended_at=CASE WHEN p_to='suspended' THEN NOW() ELSE suspended_at END,
           offboarding_started_at=CASE
               WHEN p_to='offboarding' THEN NOW()
               WHEN p_to='terminated' THEN COALESCE(offboarding_started_at, NOW())
               ELSE offboarding_started_at
           END,
           terminated_at=CASE WHEN p_to='terminated' THEN NOW() ELSE terminated_at END,
           credential_version=credential_version+1,
           updated_at=NOW(),
           version=version+1
     WHERE id=p_id AND status=p_from AND version=p_expected_version
    RETURNING *;
END
$$;

REVOKE ALL ON FUNCTION command_create_organization(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION command_update_organization_metadata(UUID,TEXT,TEXT,TIMESTAMPTZ,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION command_transition_organization_status(UUID,TEXT,TEXT,UUID,TEXT,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_create_organization(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID) TO granete_app;
GRANT EXECUTE ON FUNCTION command_update_organization_metadata(UUID,TEXT,TEXT,TIMESTAMPTZ,BIGINT) TO granete_app;
GRANT EXECUTE ON FUNCTION command_transition_organization_status(UUID,TEXT,TEXT,UUID,TEXT,BIGINT) TO granete_app;
REVOKE INSERT, UPDATE, DELETE ON organizations FROM granete_app;

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
        EXECUTE format('DROP POLICY tenant_isolation ON %I', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_read ON %I FOR SELECT USING (app_has_organization_access(organization_id))',
            table_name
        );
        EXECUTE format(
            'CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK (app_can_write_organization(organization_id))',
            table_name
        );
        EXECUTE format(
            'CREATE POLICY tenant_update ON %I FOR UPDATE USING (app_can_write_organization(organization_id)) WITH CHECK (app_can_write_organization(organization_id))',
            table_name
        );
        EXECUTE format(
            'CREATE POLICY tenant_delete ON %I FOR DELETE USING (app_can_write_organization(organization_id))',
            table_name
        );
    END LOOP;
END $$;

DROP POLICY membership_write ON memberships;
CREATE POLICY membership_write ON memberships FOR ALL
USING (app_can_write_organization(organization_id))
WITH CHECK (app_can_write_organization(organization_id));

DROP POLICY tenant_isolation ON organization_team_state;
CREATE POLICY tenant_isolation ON organization_team_state
USING (app_has_organization_access(organization_id))
WITH CHECK (app_can_write_organization(organization_id));

DROP POLICY tenant_isolation ON organization_entitlements;
CREATE POLICY tenant_isolation ON organization_entitlements
USING (app_has_organization_access(organization_id))
WITH CHECK (app_can_write_organization(organization_id));

DROP POLICY project_explicit_organizations_insert ON projects;
CREATE POLICY project_explicit_organizations_insert ON projects FOR INSERT
WITH CHECK (
    app_current_organization_id() IN (organization_id, sales_organization_id, manufacturing_organization_id)
    AND organization_id = app_current_organization_id()
    AND app_can_write_organization(app_current_organization_id())
);
DROP POLICY project_explicit_organizations_update ON projects;
CREATE POLICY project_explicit_organizations_update ON projects FOR UPDATE
USING (
    app_current_organization_id() IN (organization_id, sales_organization_id, manufacturing_organization_id)
    AND app_can_write_organization(app_current_organization_id())
)
WITH CHECK (
    app_current_organization_id() IN (organization_id, sales_organization_id, manufacturing_organization_id)
    AND app_can_write_organization(app_current_organization_id())
);
DROP POLICY project_explicit_organizations_delete ON projects;
CREATE POLICY project_explicit_organizations_delete ON projects FOR DELETE
USING (
    app_current_organization_id() IN (organization_id, sales_organization_id)
    AND app_can_write_organization(app_current_organization_id())
);

DROP POLICY stock_movement_insert ON stock_movements;
CREATE POLICY stock_movement_insert ON stock_movements FOR INSERT
WITH CHECK (app_can_write_organization(organization_id));
DROP POLICY structure_revision_insert ON structure_revisions;
CREATE POLICY structure_revision_insert ON structure_revisions FOR INSERT
WITH CHECK (app_can_write_organization(organization_id));

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
    OR (
        app_current_support_session_id() IS NULL
        AND organization_id=app_current_organization_id()
        AND app_current_user_is_platform_admin()
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
    OR (
        app_current_support_session_id() IS NULL
        AND organization_id=app_current_organization_id()
        AND app_current_user_is_platform_admin()
    )
);

DO $$
DECLARE table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['project_items', 'project_level_choices', 'quote_snapshots'] LOOP
        EXECUTE format('DROP POLICY project_explicit_organizations ON %I', table_name);
        EXECUTE format(
			'CREATE POLICY project_shared_read ON %1$I FOR SELECT USING (EXISTS (SELECT 1 FROM projects p WHERE p.id=%1$I.project_id))',
            table_name
        );
        EXECUTE format(
			'CREATE POLICY project_shared_insert ON %1$I FOR INSERT WITH CHECK (app_can_write_organization(app_current_organization_id()) AND EXISTS (SELECT 1 FROM projects p WHERE p.id=%1$I.project_id AND p.organization_id=%1$I.organization_id))',
            table_name
        );
        EXECUTE format(
			'CREATE POLICY project_shared_update ON %1$I FOR UPDATE USING (app_can_write_organization(app_current_organization_id()) AND EXISTS (SELECT 1 FROM projects p WHERE p.id=%1$I.project_id)) WITH CHECK (app_can_write_organization(app_current_organization_id()) AND EXISTS (SELECT 1 FROM projects p WHERE p.id=%1$I.project_id AND p.organization_id=%1$I.organization_id))',
            table_name
        );
        EXECUTE format(
			'CREATE POLICY project_shared_delete ON %1$I FOR DELETE USING (app_can_write_organization(app_current_organization_id()) AND EXISTS (SELECT 1 FROM projects p WHERE p.id=%1$I.project_id))',
            table_name
        );
    END LOOP;
END $$;

DROP POLICY project_item_choice_explicit_organizations ON project_item_choices;
CREATE POLICY project_item_choice_read ON project_item_choices FOR SELECT
USING (EXISTS (SELECT 1 FROM project_items pi WHERE pi.id=project_item_choices.project_item_id));
CREATE POLICY project_item_choice_write ON project_item_choices FOR ALL
USING (
    app_can_write_organization(app_current_organization_id())
    AND EXISTS (SELECT 1 FROM project_items pi WHERE pi.id=project_item_choices.project_item_id)
)
WITH CHECK (
    app_can_write_organization(app_current_organization_id())
    AND EXISTS (
        SELECT 1 FROM project_items pi
         WHERE pi.id=project_item_choices.project_item_id
           AND pi.organization_id=project_item_choices.organization_id
    )
);

DROP POLICY snapshot_price_explicit_organizations ON snapshot_prices;
CREATE POLICY snapshot_price_read ON snapshot_prices FOR SELECT
USING (EXISTS (SELECT 1 FROM quote_snapshots qs WHERE qs.id=snapshot_prices.snapshot_id));
CREATE POLICY snapshot_price_write ON snapshot_prices FOR ALL
USING (
    app_can_write_organization(app_current_organization_id())
    AND EXISTS (SELECT 1 FROM quote_snapshots qs WHERE qs.id=snapshot_prices.snapshot_id)
)
WITH CHECK (
    app_can_write_organization(app_current_organization_id())
    AND EXISTS (
        SELECT 1 FROM quote_snapshots qs
         WHERE qs.id=snapshot_prices.snapshot_id
           AND qs.organization_id=snapshot_prices.organization_id
    )
);

ALTER TABLE organization_entitlements
    DROP CONSTRAINT organization_entitlements_source_check;

UPDATE organization_entitlements
SET source = CASE WHEN source = 'provisioned' THEN 'platform_override' ELSE source END;

ALTER TABLE organization_entitlements
    ADD COLUMN max_sales_partners INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN manufacturing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN sales_network_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN sketchup_seats INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN advanced_audit_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN defaults_revision TEXT NOT NULL DEFAULT 'legacy-v1',
    ADD CONSTRAINT organization_entitlements_max_sales_partners_check CHECK (max_sales_partners >= 0),
    ADD CONSTRAINT organization_entitlements_sketchup_seats_check CHECK (sketchup_seats >= 0),
    ADD CONSTRAINT organization_entitlements_defaults_revision_check CHECK (nullif(btrim(defaults_revision), '') IS NOT NULL),
    ADD CONSTRAINT organization_entitlements_source_check CHECK (
        source IN ('legacy_unlimited', 'plan_default', 'platform_override')
    );

CREATE OR REPLACE FUNCTION initialize_organization_team_foundations()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    INSERT INTO organization_team_state (organization_id, admin_bootstrap_pending)
    VALUES (NEW.id, TRUE) ON CONFLICT DO NOTHING;
    INSERT INTO organization_entitlements (
        organization_id, max_sales_partners, manufacturing_enabled,
        sales_network_enabled, sketchup_seats, advanced_audit_enabled,
        source, defaults_revision
    ) VALUES (NEW.id, 0, FALSE, FALSE, 0, FALSE, 'legacy_unlimited', 'legacy-v1')
    ON CONFLICT DO NOTHING;
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION check_organization_team_invariants(target UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE active_org BOOLEAN; admins INTEGER; members INTEGER; max_members INTEGER; bootstrap_pending BOOLEAN;
BEGIN
    SELECT o.status = 'active', s.active_admin_count, s.active_member_count,
           e.max_active_members, s.admin_bootstrap_pending
      INTO active_org, admins, members, max_members, bootstrap_pending
      FROM organizations o
      JOIN organization_team_state s ON s.organization_id = o.id
      JOIN organization_entitlements e ON e.organization_id = o.id
     WHERE o.id = target;
    IF active_org AND admins = 0 THEN
        RAISE EXCEPTION 'organization team invariant: active organization requires an active admin'
            USING ERRCODE='23514', CONSTRAINT='organization_requires_active_admin';
    END IF;
    IF max_members IS NOT NULL AND members > max_members THEN
        RAISE EXCEPTION 'organization team invariant: active member seat limit exceeded'
            USING ERRCODE='23514', CONSTRAINT='organization_active_member_seat_limit';
    END IF;
END $$;

DROP TRIGGER enforce_team_invariants_from_organizations ON organizations;
CREATE CONSTRAINT TRIGGER enforce_team_invariants_from_organizations
AFTER INSERT OR UPDATE OF status ON organizations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_team_invariants_from_organization();

DROP TRIGGER enforce_team_invariants_from_entitlements ON organization_entitlements;
CREATE CONSTRAINT TRIGGER enforce_team_invariants_from_entitlements
AFTER INSERT OR UPDATE OF max_active_members ON organization_entitlements DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_team_invariants_from_entitlement();

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
               AND o.status='active'
             FOR UPDATE OF i
        $query$ USING invitation_token_hash;
    ELSE
        RETURN QUERY EXECUTE $query$
            SELECT i.id, i.normalized_email, i.roles, i.status, i.expires_at,
                   i.invited_by, i.accepted_at, i.accepted_by, i.revoked_at,
                   i.revoked_by, i.revoked_reason, i.created_at, i.updated_at,
                   i.version, o.id, o.type, i.token_hash = $1
              FROM invitations i JOIN organizations o ON o.id=i.organization_id
             WHERE i.token_hash=$1 AND o.status='active'
             FOR UPDATE OF i
        $query$ USING invitation_token_hash;
    END IF;
END
$$;

REVOKE ALL ON FUNCTION lock_open_invitation_by_hash(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_open_invitation_by_hash(TEXT) TO granete_app;

UPDATE rls_policy_inventory
SET policy_version = policy_version + 1,
    rationale = 'Explicit tenant entitlement authority for seats, sales-network, manufacturing, SketchUp, and advanced audit capabilities',
    updated_at = NOW()
WHERE table_name = 'organization_entitlements';
