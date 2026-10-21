-- #1382: factory manufacturing library entitlement and authoring boundary.
-- 'standard' (default): tenant consumes Granete Standard; catalog geometry
-- authoring (modules, structures, components) is locked; local pricing and
-- workshop joinery policies remain fully operational.
-- 'custom': tenant is entitled to author its own catalog library.
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS library_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (library_type IN ('standard', 'custom'));

DROP FUNCTION IF EXISTS command_create_organization(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID,TEXT);
DROP FUNCTION IF EXISTS command_create_organization(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID);

CREATE FUNCTION command_create_organization(
    p_name TEXT,
    p_slug TEXT,
    p_type TEXT,
    p_license_plan TEXT,
    p_license_expires_at TIMESTAMPTZ,
    p_status TEXT,
    p_status_reason TEXT,
    p_status_changed_by UUID,
    p_parent_organization_id UUID,
    p_library_type TEXT
) RETURNS SETOF organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    runtime_caller BOOLEAN := app_session_is_runtime();
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
        status_reason, status_changed_by, parent_organization_id, library_type
    ) VALUES (
        p_name, p_slug, p_type, p_license_plan, p_license_expires_at, p_status,
        nullif(p_status_reason, ''), p_status_changed_by, p_parent_organization_id,
        COALESCE(NULLIF(p_library_type, ''), 'standard')
    )
    RETURNING *;
END
$$;

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
BEGIN
    RETURN QUERY SELECT * FROM command_create_organization(
        p_name, p_slug, p_type, p_license_plan, p_license_expires_at,
        p_status, p_status_reason, p_status_changed_by, p_parent_organization_id, 'standard'
    );
END;
$$;

REVOKE ALL ON FUNCTION command_create_organization(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_create_organization(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID,TEXT) TO granete_app;
REVOKE ALL ON FUNCTION command_create_organization(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_create_organization(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID) TO granete_app;

DROP FUNCTION IF EXISTS command_update_organization_metadata(UUID,TEXT,TEXT,TIMESTAMPTZ,BIGINT,TEXT);
DROP FUNCTION IF EXISTS command_update_organization_metadata(UUID,TEXT,TEXT,TIMESTAMPTZ,BIGINT);

CREATE FUNCTION command_update_organization_metadata(
    p_id UUID,
    p_name TEXT,
    p_license_plan TEXT,
    p_license_expires_at TIMESTAMPTZ,
    p_expected_version BIGINT,
    p_library_type TEXT
) RETURNS SETOF organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    runtime_caller BOOLEAN := app_session_is_runtime();
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
           library_type=COALESCE(NULLIF(p_library_type, ''), library_type),
           updated_at=NOW(),
           version=version+1
     WHERE id=p_id
       AND (p_expected_version IS NULL OR version=p_expected_version)
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
BEGIN
    RETURN QUERY SELECT * FROM command_update_organization_metadata(
        p_id, p_name, p_license_plan, p_license_expires_at, p_expected_version, NULL
    );
END;
$$;

REVOKE ALL ON FUNCTION command_update_organization_metadata(UUID,TEXT,TEXT,TIMESTAMPTZ,BIGINT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_update_organization_metadata(UUID,TEXT,TEXT,TIMESTAMPTZ,BIGINT,TEXT) TO granete_app;
REVOKE ALL ON FUNCTION command_update_organization_metadata(UUID,TEXT,TEXT,TIMESTAMPTZ,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_update_organization_metadata(UUID,TEXT,TEXT,TIMESTAMPTZ,BIGINT) TO granete_app;
