-- ADR-0005 / #326: platform support sessions ("entrar a taller").
-- A platform admin opens a time-boxed, reason-tagged session into one
-- organization; the middleware resolves it to an effective admin membership
-- while every write keeps recording the real platform actor. Append-only in
-- practice: rows are inserted (start) and updated (end), never deleted.

CREATE TABLE IF NOT EXISTS support_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform_admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 4),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NULL,
    ended_via TEXT NULL CHECK (ended_via IN ('logout', 'expiry', 'org_suspended'))
);

CREATE INDEX IF NOT EXISTS idx_support_sessions_org ON support_sessions(organization_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_sessions_admin ON support_sessions(platform_admin_user_id, started_at DESC);
