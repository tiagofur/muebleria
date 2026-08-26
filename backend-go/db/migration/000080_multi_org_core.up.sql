-- ADR-0004 / #325: multi-organization core identity tables.
-- Organizations own business data (row-level tenancy); users belong to N
-- organizations through memberships whose roles[] reference the canonical
-- roles (contracts/roles.json). Invitations and the append-only security
-- audit trail support administration (#326).

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?$'),
    type TEXT NOT NULL DEFAULT 'factory' CHECK (type IN ('factory', 'store', 'dealer')),
    license_plan TEXT NOT NULL DEFAULT 'none' CHECK (license_plan IN ('none', 'trial', 'pro')),
    license_expires_at TIMESTAMPTZ NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    roles TEXT[] NOT NULL CHECK (
        roles <> '{}'
        AND roles <@ ARRAY[
            'admin', 'user', 'vendedor', 'gerente_ventas', 'gerente_produccion',
            'ingeniero', 'produccion', 'almacen'
        ]::text[]
    ),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_organization ON memberships(organization_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);

CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    roles TEXT[] NOT NULL CHECK (
        roles <> '{}'
        AND roles <@ ARRAY[
            'admin', 'user', 'vendedor', 'gerente_ventas', 'gerente_produccion',
            'ingeniero', 'produccion', 'almacen'
        ]::text[]
    ),
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ NULL,
    accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitations_organization ON invitations(organization_id);
-- One open invitation per (org, email): creating a new one revokes nothing,
-- but duplicates are rejected while the previous one is still open.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_open_org_email
    ON invitations(organization_id, email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Append-only security audit trail (ADR-0004 §7): logins, invitations,
-- membership/role changes, org lifecycle, support sessions. Never updated
-- or deleted from application code.
CREATE TABLE IF NOT EXISTS security_audit_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    ip TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_events_org_created
    ON security_audit_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_events_actor
    ON security_audit_events(actor_user_id, created_at DESC);

-- Platform staff flag: console access + audited support sessions. This is a
-- platform attribute, not an organization membership (ADR-0004 §5).
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
