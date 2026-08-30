-- #451 / TEAM-2: make role/type/sector compatibility a database invariant.
-- The application command remains the friendly validation boundary; these
-- triggers protect direct runtime-role SQL and every future write path.

CREATE OR REPLACE FUNCTION membership_sector_is_compatible(
    organization_type TEXT,
    membership_roles TEXT[],
    assigned_sector TEXT
) RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT organization_type = 'factory'
       AND cardinality(membership_roles) > 0
       AND membership_roles <@ ARRAY['produccion', 'almacen']::TEXT[]
       AND assigned_sector = ANY (ARRAY[
            'warehouse', 'cutting', 'cnc', 'edge_banding', 'assembly',
            'packaging', 'shipping', 'installation', 'herrajes',
            'tableros', 'cintillas'
       ]::TEXT[])
       AND (
            NOT ('almacen' = ANY (membership_roles))
            OR assigned_sector = ANY (ARRAY['herrajes', 'tableros', 'cintillas']::TEXT[])
       )
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM membership_sectors ms
        LEFT JOIN memberships m
          ON m.id = ms.membership_id AND m.organization_id = ms.organization_id
        LEFT JOIN organizations o ON o.id = ms.organization_id
        WHERE m.id IS NULL
           OR o.id IS NULL
           OR NOT membership_sector_is_compatible(o.type, m.roles, ms.sector)
    ) THEN
        RAISE EXCEPTION 'membership sector compatibility migration blocked: reconcile organization type, membership roles and sector assignments'
            USING ERRCODE = '23514', CONSTRAINT = 'membership_sector_compatibility';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_membership_sector_compatibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    current_organization_type TEXT;
    current_membership_roles TEXT[];
BEGIN
    SELECT o.type, m.roles
      INTO current_organization_type, current_membership_roles
      FROM memberships m
      JOIN organizations o ON o.id = m.organization_id
     WHERE m.id = NEW.membership_id
       AND m.organization_id = NEW.organization_id;

    IF NOT FOUND OR NOT membership_sector_is_compatible(
        current_organization_type,
        current_membership_roles,
        NEW.sector
    ) THEN
        RAISE EXCEPTION 'membership sector is incompatible with organization type or membership roles'
            USING ERRCODE = '23514', CONSTRAINT = 'membership_sector_compatibility';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER enforce_membership_sector_compatibility
BEFORE INSERT OR UPDATE OF membership_id, organization_id, sector ON membership_sectors
FOR EACH ROW EXECUTE FUNCTION enforce_membership_sector_compatibility();

CREATE OR REPLACE FUNCTION enforce_membership_sector_set_on_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    next_organization_type TEXT;
BEGIN
    SELECT type INTO next_organization_type
      FROM organizations
     WHERE id = NEW.organization_id;

    IF EXISTS (
        SELECT 1
          FROM membership_sectors ms
         WHERE ms.membership_id = OLD.id
           AND NOT membership_sector_is_compatible(
                next_organization_type,
                NEW.roles,
                ms.sector
           )
    ) THEN
        RAISE EXCEPTION 'membership role change would leave incompatible sector assignments'
            USING ERRCODE = '23514', CONSTRAINT = 'membership_sector_set_compatibility';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER enforce_membership_sector_set_on_membership
BEFORE UPDATE OF id, organization_id, roles ON memberships
FOR EACH ROW EXECUTE FUNCTION enforce_membership_sector_set_on_membership();

CREATE OR REPLACE FUNCTION enforce_membership_sector_set_on_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM membership_sectors ms
          JOIN memberships m
            ON m.id = ms.membership_id AND m.organization_id = ms.organization_id
         WHERE ms.organization_id = OLD.id
           AND NOT membership_sector_is_compatible(NEW.type, m.roles, ms.sector)
    ) THEN
        RAISE EXCEPTION 'organization type change would leave incompatible sector assignments'
            USING ERRCODE = '23514', CONSTRAINT = 'membership_sector_set_compatibility';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER enforce_membership_sector_set_on_organization
BEFORE UPDATE OF id, type ON organizations
FOR EACH ROW EXECUTE FUNCTION enforce_membership_sector_set_on_organization();

REVOKE ALL ON FUNCTION membership_sector_is_compatible(TEXT, TEXT[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_membership_sector_compatibility() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_membership_sector_set_on_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_membership_sector_set_on_organization() FROM PUBLIC;
