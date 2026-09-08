-- Remove only the index owned by 000126. The original 000124 index, when
-- present on fresh installations, remains untouched.

DROP INDEX IF EXISTS idx_design_pairing_grants_organization_created;
