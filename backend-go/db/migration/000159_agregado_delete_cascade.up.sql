-- #1168: Cascade deletion of catalog agregados.
--
-- Agregado recipes in agregado_revisions are immutable history protected by
-- protect_agregado_assembly_immutability() and REVOKE DELETE FROM granete_app.
-- When a catalog agregado is deleted (and not referenced by any module,
-- structure, or published assembly snapshot), this SECURITY DEFINER function
-- removes the row along with its historical revisions in the correct order,
-- preventing foreign-key violations and composite FK nullification failures.

CREATE OR REPLACE FUNCTION delete_catalog_agregado(agregado_to_delete text, expected_version bigint DEFAULT 0)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    actor_organization uuid;
    in_use_count int;
BEGIN
    actor_organization := public.app_current_organization_id();
    IF actor_organization IS NULL OR NOT public.app_can_write_organization(actor_organization) THEN
        RAISE EXCEPTION 'agregado delete requires a writable organization scope';
    END IF;

    -- In-use check: modules
    SELECT count(*) INTO in_use_count
      FROM public.modules
     WHERE organization_id = actor_organization
       AND agregados @> jsonb_build_array(jsonb_build_object('agregado_id', agregado_to_delete));
    IF in_use_count > 0 THEN
        RAISE EXCEPTION 'agregado in use by % módulo(s)', in_use_count;
    END IF;

    -- In-use check: structures
    SELECT count(*) INTO in_use_count
      FROM public.structures
     WHERE organization_id = actor_organization
       AND agregados @> jsonb_build_array(jsonb_build_object('agregado_id', agregado_to_delete));
    IF in_use_count > 0 THEN
        RAISE EXCEPTION 'agregado in use by % estructura(s)', in_use_count;
    END IF;

    -- In-use check: published_assembly_snapshots (historical designs)
    SELECT count(*) INTO in_use_count
      FROM public.published_assembly_snapshots
     WHERE organization_id = actor_organization
       AND agregado_id = agregado_to_delete;
    IF in_use_count > 0 THEN
        RAISE EXCEPTION 'agregado in use by % published assembly snapshot(s)', in_use_count;
    END IF;

    -- Verify existence and expected version
    IF expected_version > 0 THEN
        PERFORM 1
          FROM public.agregados
         WHERE id = agregado_to_delete
           AND organization_id = actor_organization
           AND version = expected_version;
        IF NOT FOUND THEN
            PERFORM 1
              FROM public.agregados
             WHERE id = agregado_to_delete
               AND organization_id = actor_organization;
            IF FOUND THEN
                RAISE EXCEPTION 'agregado version conflict';
            ELSE
                RAISE EXCEPTION 'agregado not found';
            END IF;
        END IF;
    ELSE
        PERFORM 1
          FROM public.agregados
         WHERE id = agregado_to_delete
           AND organization_id = actor_organization;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'agregado not found';
        END IF;
    END IF;

    -- Enable cascade delete for immutable tables in this transaction
    PERFORM set_config('app.allow_project_cascade_delete', 'on', true);

    -- 1) Clear current_revision_id so Postgres does not try to set (id, organization_id) to NULL on FK delete
    UPDATE public.agregados
       SET current_revision_id = NULL
     WHERE id = agregado_to_delete
       AND organization_id = actor_organization;

    -- 2) Delete historical revisions
    DELETE FROM public.agregado_revisions
     WHERE agregado_id = agregado_to_delete
       AND organization_id = actor_organization;

    -- 3) Delete the agregado itself
    DELETE FROM public.agregados
     WHERE id = agregado_to_delete
       AND organization_id = actor_organization;
END;
$$;

REVOKE ALL ON FUNCTION delete_catalog_agregado(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_catalog_agregado(text, bigint) TO granete_app;
