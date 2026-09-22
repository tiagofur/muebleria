-- #815: DELETE /api/projects/{id} must remove a project together with its
-- commercial/durable family. Three layers blocked the projects ON DELETE
-- CASCADE under the runtime role:
--   1. Absolute immutability triggers raising on DELETE
--      (quote_revisions, design_revisions, production_release_engineering,
--      production_release_manufacturing_snapshots).
--   2. NO ACTION grandchildren referencing revisions/releases
--      (design_publish_sessions, design_working_copies, production_releases,
--      production_release_engineering, manufacturing snapshots).
--
-- The guard: the storage layer's DeleteProject opens ONE transaction that
-- sets app.allow_project_cascade_delete = 'on' with set_config(..., true) —
-- transaction scoped, discarded at commit/rollback, never visible to another
-- session or to the next borrower of the pooled connection. Every durability
-- guarantee below stays absolute OUTSIDE that transaction.

-- 1) Durability triggers: DELETE passes only under the guard; UPDATE rules
--    are byte-identical to their previous definitions (latest: 000130 / 000129
--    / 000134 / 000122).

CREATE OR REPLACE FUNCTION protect_quote_revision_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.allow_project_cascade_delete', true) IS DISTINCT FROM 'on' THEN
            RAISE EXCEPTION 'quote_revisions cannot be deleted once created';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        -- Existing rows are the only legacy exception: they predate this
        -- trigger. Every post-migration INSERT must carry canonical authority.
        IF NEW.commercial_snapshot IS NULL THEN
            RAISE EXCEPTION 'new quote_revision requires commercial_snapshot; NULL is reserved for pre-#642 legacy rows';
        END IF;
        IF NOT valid_quote_commercial_snapshot_v1(NEW.commercial_snapshot) THEN
            RAISE EXCEPTION 'quote_revision commercial_snapshot is not a valid granete.quote-commercial-snapshot.v1 payload';
        END IF;
        IF NEW.status <> 'draft' OR NEW.published_at IS NOT NULL OR NEW.accepted_at IS NOT NULL THEN
            RAISE EXCEPTION 'quote_revision with commercial_snapshot must be inserted as draft without lifecycle timestamps';
        END IF;
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

        -- #642: the commercial snapshot is written exactly once, at creation.
        -- It can never be rewritten — not even from NULL (a revision without a
        -- snapshot is a legacy row and must stay honestly snapshot-less; the
        -- actionable path is a NEW revision, never a backfill mutation).
        IF NEW.commercial_snapshot IS DISTINCT FROM OLD.commercial_snapshot THEN
            RAISE EXCEPTION 'quote_revision commercial_snapshot is immutable once written';
        END IF;

        -- #642: real lifecycle timestamps. published_at may only be set by the
        -- draft → published transition; accepted_at only by published →
        -- accepted. Both are immutable afterwards (superseding keeps them).
        IF NEW.published_at IS DISTINCT FROM OLD.published_at THEN
            IF NOT (OLD.status = 'draft' AND NEW.status = 'published'
                    AND OLD.published_at IS NULL AND NEW.published_at IS NOT NULL) THEN
                RAISE EXCEPTION 'quote_revision published_at is set exactly once by the draft → published transition';
            END IF;
        END IF;
        IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
            IF NOT (OLD.status = 'published' AND NEW.status = 'accepted'
                    AND OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL) THEN
                RAISE EXCEPTION 'quote_revision accepted_at is set exactly once by the published → accepted transition';
            END IF;
        END IF;

        IF NEW.status <> OLD.status THEN
            IF OLD.status = 'draft' AND NEW.status <> 'published' THEN
                RAISE EXCEPTION 'draft quote_revision can only transition to published, not %', NEW.status;
            END IF;
            -- #642 fail-closed backstop: publishing requires the immutable
            -- commercial snapshot (legacy drafts must re-quote, not publish
            -- unpriced history).
            IF OLD.status = 'draft' AND NEW.status = 'published'
                    AND (NEW.commercial_snapshot IS NULL
                         OR NOT valid_quote_commercial_snapshot_v1(NEW.commercial_snapshot)) THEN
                RAISE EXCEPTION 'draft quote_revision without a valid commercial_snapshot cannot be published';
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
       OR NEW.created_by_display_name IS DISTINCT FROM OLD.created_by_display_name THEN
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

CREATE OR REPLACE FUNCTION protect_release_engineering_transitions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.allow_project_cascade_delete', true) IS DISTINCT FROM 'on' THEN
            RAISE EXCEPTION 'release engineering rows are durable history (#740)';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW.release_id <> OLD.release_id OR NEW.project_id <> OLD.project_id
       OR NEW.organization_id <> OLD.organization_id
       OR NEW.started_by <> OLD.started_by OR NEW.started_at <> OLD.started_at THEN
        RAISE EXCEPTION 'release engineering identity is immutable (#740)';
    END IF;
    IF OLD.status = 'completed' THEN
        RAISE EXCEPTION 'release engineering completion is final (#740)';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'release engineering version must advance by 1 (#740)';
    END IF;
    IF NEW.status = 'completed' AND (NEW.completed_by IS NULL OR NEW.completed_at IS NULL) THEN
        RAISE EXCEPTION 'completion requires actor and timestamp (#740)';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_release_manufacturing_snapshot_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'production release manufacturing snapshots are immutable history (#577)';
    END IF;
    IF current_setting('app.allow_project_cascade_delete', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'production release manufacturing snapshots are immutable history (#577)';
    END IF;
    RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION protect_production_release_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.allow_project_cascade_delete', true) IS DISTINCT FROM 'on' THEN
            RAISE EXCEPTION 'production_releases are immutable history pinned to their exact revisions (#395 / I6 / §25.6)';
        END IF;
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'production_releases are immutable history pinned to their exact revisions (#395 / I6 / §25.6)';
END;
$$;

CREATE OR REPLACE FUNCTION protect_design_revision_artifact_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.allow_project_cascade_delete', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'design_revision_artifacts is immutable once published';
END;
$$;

CREATE OR REPLACE FUNCTION protect_design_revision_item_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.allow_project_cascade_delete', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'design_revision_items is immutable';
END;
$$;

CREATE OR REPLACE FUNCTION protect_quote_revision_item_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.allow_project_cascade_delete', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'quote_revision_items is immutable once created';
END;
$$;

-- Shared by agregado_revisions / published_assembly_snapshots /
-- design_revision_assembly_snapshots. Only the project family is ever deleted
-- under the guard; catalog agregado revisions keep raising as before.
CREATE OR REPLACE FUNCTION protect_agregado_assembly_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.allow_project_cascade_delete', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is immutable once written', TG_TABLE_NAME;
END;
$$;

-- Shared by hardware_assets / hardware_asset_revisions /
-- hardware_asset_validations / design_revision_hardware_assets. Project
-- deletion only reaches design_revision_hardware_assets; the catalog tables
-- keep raising as before.
CREATE OR REPLACE FUNCTION protect_hardware_asset_row_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.allow_project_cascade_delete', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is immutable once written', TG_TABLE_NAME;
END;
$$;

-- 2) Guard trigger for the protected tables whose only barrier was
--    REVOKE DELETE. Outside the project-delete transaction nothing changes:
--    direct deletes keep failing; inside it the storage layer deletes by
--    exact project_id.

CREATE FUNCTION protect_project_scoped_delete_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF current_setting('app.allow_project_cascade_delete', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION '% rows are only deletable through project deletion', TG_TABLE_NAME;
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER protect_furniture_instances_delete_guard
    BEFORE DELETE ON furniture_instances
    FOR EACH ROW EXECUTE FUNCTION protect_project_scoped_delete_guard();
CREATE TRIGGER protect_designs_delete_guard
    BEFORE DELETE ON designs
    FOR EACH ROW EXECUTE FUNCTION protect_project_scoped_delete_guard();
CREATE TRIGGER protect_design_publish_sessions_delete_guard
    BEFORE DELETE ON design_publish_sessions
    FOR EACH ROW EXECUTE FUNCTION protect_project_scoped_delete_guard();

-- 3) Canonical, narrow project-delete boundary.
--
-- Cascades execute with table-owner privilege; the original blockers were
-- durability triggers, RLS on explicit NO ACTION cleanup, and those NO ACTION
-- FKs.  This function is SECURITY DEFINER solely so an authorized Store/Sales
-- actor can remove the one project tree that includes Factory-private release
-- rows.  It validates that actor against the project before disabling RLS,
-- fixes search_path, scopes the trigger guard to this transaction, and exposes
-- no generic cross-organization DELETE capability.
--
-- Direct DELETE privileges stay revoked.  `app.allow_project_cascade_delete`
-- is meaningful only while this function executes with table-owner authority;
-- setting it in an ordinary app transaction cannot grant table DELETE rights.
REVOKE DELETE ON projects FROM granete_app;

CREATE OR REPLACE FUNCTION delete_project_tree(project_to_delete uuid)
RETURNS TABLE(owner_organization_id uuid, project_media_url text, project_storage_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
    actor_organization uuid;
BEGIN
    actor_organization := public.app_current_organization_id();
    IF actor_organization IS NULL OR NOT public.app_can_write_organization(actor_organization) THEN
        RAISE EXCEPTION 'project delete requires a writable organization scope';
    END IF;

    -- The GUC tuple is only a transport mechanism. Bind it back to a live,
    -- active membership before using SECURITY DEFINER privileges so a forged
    -- user_id/membership_id/organization_id combination cannot authorize a tree.
    PERFORM 1
      FROM public.memberships membership
     WHERE membership.id = public.app_current_membership_id()
       AND membership.user_id = public.app_current_user_id()
       AND membership.organization_id = actor_organization
       AND membership.status = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'project delete requires an active actor membership';
    END IF;

    PERFORM 1
      FROM public.projects
     WHERE id = project_to_delete
       AND (organization_id = actor_organization OR sales_organization_id = actor_organization);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'project not found';
    END IF;

    -- Materialize project-owned physical references before metadata disappears.
    RETURN QUERY
      SELECT p.organization_id::uuid, p.url::text, NULL::text
        FROM public.project_photos p
       WHERE p.project_id = project_to_delete
      UNION ALL
      SELECT p.organization_id::uuid, p.thumbnail_url::text, NULL::text
        FROM public.project_photos p
       WHERE p.project_id = project_to_delete
      UNION ALL
      SELECT a.organization_id::uuid, NULL::text, a.storage_key::text
        FROM public.design_publish_artifacts a
       WHERE a.project_id = project_to_delete
      UNION ALL
      SELECT a.organization_id::uuid, NULL::text, a.storage_key::text
        FROM public.design_revision_artifacts a
       WHERE a.project_id = project_to_delete;

    PERFORM set_config('app.allow_project_cascade_delete', 'on', true);

    -- These are the only grandchildren with NO ACTION edges into the cascade.
    DELETE FROM public.design_publish_sessions WHERE project_id = project_to_delete;
    DELETE FROM public.production_release_manufacturing_snapshots WHERE project_id = project_to_delete;
    DELETE FROM public.production_release_engineering WHERE project_id = project_to_delete;
    DELETE FROM public.production_releases WHERE project_id = project_to_delete;
    DELETE FROM public.projects WHERE id = project_to_delete;
END;
$$;

REVOKE ALL ON FUNCTION delete_project_tree(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_project_tree(uuid) TO granete_app;
