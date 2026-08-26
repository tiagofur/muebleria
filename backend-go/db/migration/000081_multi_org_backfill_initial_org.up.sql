-- ADR-0004 / #325: backfill the initial organization.
--
-- The existing deployment IS a single workshop by design ("single-workshop,
-- so authentication + license are the perimeter"). This migration converts
-- that implicit workshop into an explicit organization without inventing
-- facts: every existing business row and every existing user membership is
-- assigned to it. The fixed UUID keeps later scoping migrations deterministic.
--
-- License rolls up to the organization (ADR-0004 §3): the strongest plan any
-- user had becomes the initial org plan; users.license_plan is deprecated.

-- Initial organization (deterministic id).
INSERT INTO organizations (id, name, slug, type, license_plan, license_expires_at)
SELECT
    '00000000-0000-0000-0000-000000000001',
    'Taller inicial',
    'inicial',
    'factory',
    CASE
        WHEN EXISTS (SELECT 1 FROM users WHERE license_plan = 'pro') THEN 'pro'
        WHEN EXISTS (SELECT 1 FROM users WHERE license_plan = 'trial') THEN 'trial'
        ELSE 'none'
    END,
    (SELECT MAX(license_expires_at) FROM users WHERE license_expires_at IS NOT NULL)
WHERE NOT EXISTS (SELECT 1 FROM organizations);

-- One membership per existing user preserving the current role and status.
-- users.role is deprecated from here on; memberships are the source of truth.
INSERT INTO memberships (organization_id, user_id, roles, active)
SELECT
    '00000000-0000-0000-0000-000000000001',
    u.id,
    ARRAY[u.role],
    u.active
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM memberships m WHERE m.user_id = u.id
)
ON CONFLICT (user_id, organization_id) DO NOTHING;

-- Auditable record of the conversion itself.
INSERT INTO security_audit_events (event_type, organization_id, details)
VALUES (
    'organization_created',
    '00000000-0000-0000-0000-000000000001',
    jsonb_build_object(
        'reason', 'multi-org backfill: convert single-workshop deployment into initial organization',
        'source', 'migration 000081'
    )
);
