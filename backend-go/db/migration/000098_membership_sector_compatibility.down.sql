DROP TRIGGER IF EXISTS enforce_membership_sector_set_on_organization ON organizations;
DROP TRIGGER IF EXISTS enforce_membership_sector_set_on_membership ON memberships;
DROP TRIGGER IF EXISTS enforce_membership_sector_compatibility ON membership_sectors;

DROP FUNCTION IF EXISTS enforce_membership_sector_set_on_organization();
DROP FUNCTION IF EXISTS enforce_membership_sector_set_on_membership();
DROP FUNCTION IF EXISTS enforce_membership_sector_compatibility();
DROP FUNCTION IF EXISTS membership_sector_is_compatible(TEXT, TEXT[], TEXT);
