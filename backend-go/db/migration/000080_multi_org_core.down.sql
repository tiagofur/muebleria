ALTER TABLE users DROP COLUMN IF EXISTS platform_admin;

DROP TABLE IF EXISTS security_audit_events;
DROP TABLE IF EXISTS invitations;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS organizations;
