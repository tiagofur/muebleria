-- #1649 reversal: drop the payment ledger. Lifecycle deposit_received events
-- are untouched (the backfill only copied them), so no history is lost.
-- Restore the 000137 delete_project_tree without the payments guard.
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

DROP TRIGGER IF EXISTS trg_project_payment_void_same_org ON project_payment_voids;
DROP FUNCTION IF EXISTS project_payment_void_same_org();
DROP TABLE IF EXISTS project_payment_voids;
DROP TABLE IF EXISTS project_payments;
DELETE FROM rls_policy_inventory WHERE table_name IN ('project_payments', 'project_payment_voids');
