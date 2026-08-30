-- Restore the 000098 semantic gates without the 000099 serialization layer.

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

DROP FUNCTION IF EXISTS lock_membership_sector_keys(TEXT, UUID, UUID);
