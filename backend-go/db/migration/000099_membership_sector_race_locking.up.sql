-- #451 / TEAM-2: serialize every mutation that can change membership-sector
-- compatibility. The locks use one deterministic order (organization keys,
-- then membership keys) so direct SQL cannot create write-skew or deadlocks.

CREATE OR REPLACE FUNCTION lock_membership_sector_keys(
    key_kind TEXT,
    first_id UUID,
    second_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    lower_id UUID;
    upper_id UUID;
BEGIN
    IF key_kind NOT IN ('organization', 'membership') THEN
        RAISE EXCEPTION 'invalid membership-sector lock kind';
    END IF;

    IF second_id IS NULL OR first_id = second_id THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(
            'granete:membership-sector:' || key_kind || ':' || first_id::TEXT,
            0
        ));
        RETURN;
    END IF;

    IF first_id::TEXT < second_id::TEXT THEN
        lower_id := first_id;
        upper_id := second_id;
    ELSE
        lower_id := second_id;
        upper_id := first_id;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        'granete:membership-sector:' || key_kind || ':' || lower_id::TEXT,
        0
    ));
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'granete:membership-sector:' || key_kind || ':' || upper_id::TEXT,
        0
    ));
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
    IF TG_OP = 'UPDATE' THEN
        PERFORM lock_membership_sector_keys('organization', OLD.organization_id, NEW.organization_id);
        PERFORM lock_membership_sector_keys('membership', OLD.membership_id, NEW.membership_id);
    ELSE
        PERFORM lock_membership_sector_keys('organization', NEW.organization_id);
        PERFORM lock_membership_sector_keys('membership', NEW.membership_id);
    END IF;

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
    PERFORM lock_membership_sector_keys('organization', OLD.organization_id, NEW.organization_id);
    PERFORM lock_membership_sector_keys('membership', OLD.id, NEW.id);

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
    PERFORM lock_membership_sector_keys('organization', OLD.id, NEW.id);

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

REVOKE ALL ON FUNCTION lock_membership_sector_keys(TEXT, UUID, UUID) FROM PUBLIC;
