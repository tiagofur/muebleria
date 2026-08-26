-- Rollback removes the memberships and the initial organization created by
-- the backfill. Business data is untouched (its organization_id column is
-- managed by migration 000082/000083, which must be rolled back first).
DELETE FROM security_audit_events
WHERE event_type = 'organization_created'
  AND organization_id = '00000000-0000-0000-0000-000000000001'
  AND details ->> 'source' = 'migration 000081';

DELETE FROM memberships
WHERE organization_id = '00000000-0000-0000-0000-000000000001';

DELETE FROM organizations
WHERE id = '00000000-0000-0000-0000-000000000001';
