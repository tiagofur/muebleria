-- #1649: cobros y cuenta corriente.
--
-- project_payments is the money ledger of a project: one row per amount the
-- customer actually paid (deposit or later payment). It is APPEND-ONLY: a row
-- is never edited or deleted; a mistaken payment is cancelled by inserting a
-- project_payment_voids row with a mandatory reason. The project balance is
-- computed by the backend from the exact accepted QuoteRevision snapshot
-- (breakdown.sale_price) minus the non-voided payments in the same currency —
-- never in React.
--
-- Ownership: payments are commercial (retail) data of the organization that
-- sells the project, so rows carry that organization and are tenant-private
-- (a manufacturing partner that can read the project cannot read its
-- payments). received_at is the real payment date declared by the user;
-- recorded_at is when the server recorded it. recorded_by is NULL only for
-- payments migrated from legacy events whose author is unknown (no invented
-- actor).

CREATE TABLE IF NOT EXISTS project_payments (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('deposit', 'payment')),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0 AND amount <= 1000000000000),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    payment_method TEXT NULL CHECK (payment_method IN ('cash', 'transfer', 'card', 'check', 'other')),
    reference TEXT NULL CHECK (reference IS NULL OR char_length(reference) <= 120),
    note TEXT NULL CHECK (note IS NULL OR char_length(note) <= 500),
    received_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_by UUID NULL,
    project_event_id TEXT NULL,
    origin TEXT NOT NULL DEFAULT 'command' CHECK (origin IN ('command', 'migrated_event')),
    CHECK (origin = 'migrated_event' OR recorded_by IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_project_payments_project
    ON project_payments (project_id, received_at);
CREATE INDEX IF NOT EXISTS idx_project_payments_organization
    ON project_payments (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_payments_event
    ON project_payments (project_event_id) WHERE project_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_payment_voids (
    payment_id UUID PRIMARY KEY REFERENCES project_payments(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
    voided_by UUID NOT NULL,
    voided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_payment_voids_organization
    ON project_payment_voids (organization_id);

-- A void must belong to the same organization as its payment.
CREATE OR REPLACE FUNCTION project_payment_void_same_org()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM project_payments
         WHERE id = NEW.payment_id AND organization_id = NEW.organization_id
    ) THEN
        RAISE EXCEPTION 'payment void organization must match the payment organization';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_project_payment_void_same_org ON project_payment_voids;
CREATE TRIGGER trg_project_payment_void_same_org
    BEFORE INSERT ON project_payment_voids
    FOR EACH ROW EXECUTE FUNCTION project_payment_void_same_org();

ALTER TABLE project_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_payment_read ON project_payments;
DROP POLICY IF EXISTS project_payment_insert ON project_payments;
CREATE POLICY project_payment_read ON project_payments FOR SELECT
    USING (organization_id = app_current_organization_id());
CREATE POLICY project_payment_insert ON project_payments FOR INSERT
    WITH CHECK (organization_id = app_current_organization_id());

ALTER TABLE project_payment_voids ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_payment_voids FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_payment_void_read ON project_payment_voids;
DROP POLICY IF EXISTS project_payment_void_insert ON project_payment_voids;
CREATE POLICY project_payment_void_read ON project_payment_voids FOR SELECT
    USING (organization_id = app_current_organization_id());
CREATE POLICY project_payment_void_insert ON project_payment_voids FOR INSERT
    WITH CHECK (organization_id = app_current_organization_id());

GRANT SELECT, INSERT ON project_payments TO granete_app;
GRANT SELECT, INSERT ON project_payment_voids TO granete_app;
REVOKE UPDATE, DELETE ON project_payments FROM granete_app;
REVOKE UPDATE, DELETE ON project_payment_voids FROM granete_app;

INSERT INTO rls_policy_inventory
    (table_name, classification, read_scope, write_scope, rationale)
VALUES
    ('project_payments', 'append-only', 'organization', 'insert-only-organization',
     'Payment ledger of the selling organization (#1649): append-only, tenant-private retail data; manufacturing partners of the project do not see it'),
    ('project_payment_voids', 'append-only', 'organization', 'insert-only-organization',
     'Payment cancellations (#1649): append-only with mandatory reason, same organization as the voided payment')
ON CONFLICT (table_name) DO UPDATE SET
    classification = EXCLUDED.classification,
    read_scope = EXCLUDED.read_scope,
    write_scope = EXCLUDED.write_scope,
    rationale = EXCLUDED.rationale,
    policy_version = rls_policy_inventory.policy_version + 1,
    updated_at = NOW();

-- Project deletion stays canonical (delete_project_tree, FKs CASCADE per the
-- 000137 lifecycle contract) and refuses explicitly when payments exist.
CREATE OR REPLACE FUNCTION delete_project_tree(project_to_delete uuid)
RETURNS TABLE(owner_organization_id uuid, project_media_url text, project_storage_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
    actor_organization uuid;
BEGIN
    actor_organization := public.app_current_organization_id();
    IF actor_organization IS NULL OR NOT public.app_can_write_organization(actor_organization) THEN
        RAISE EXCEPTION 'project delete requires a writable organization scope';
    END IF;

    -- The GUC tuple is only a transport mechanism. Bind it back to a live,
    -- active membership before using SECURITY DEFINER privileges so a forged
    -- user_id/membership_id/organization_id combination cannot authorize a tree.
    PERFORM 1
      FROM public.memberships membership
     WHERE membership.id = public.app_current_membership_id()
       AND membership.user_id = public.app_current_user_id()
       AND membership.organization_id = actor_organization
       AND membership.status = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'project delete requires an active actor membership';
    END IF;

    PERFORM 1
      FROM public.projects
     WHERE id = project_to_delete
       AND (organization_id = actor_organization OR sales_organization_id = actor_organization);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'project not found';
    END IF;

    -- #1649: the payment ledger is append-only money history. A project that
    -- received payments is never deleted (its rows would cascade away).
    IF EXISTS (SELECT 1 FROM public.project_payments WHERE project_id = project_to_delete) THEN
        RAISE EXCEPTION 'project has recorded payments' USING ERRCODE = 'restrict_violation';
    END IF;

    -- Materialize project-owned physical references before metadata disappears.
    RETURN QUERY
      SELECT p.organization_id::uuid, p.url::text, NULL::text
        FROM public.project_photos p
       WHERE p.project_id = project_to_delete
      UNION ALL
      SELECT p.organization_id::uuid, p.thumbnail_url::text, NULL::text
        FROM public.project_photos p
       WHERE p.project_id = project_to_delete
      UNION ALL
      SELECT a.organization_id::uuid, NULL::text, a.storage_key::text
        FROM public.design_publish_artifacts a
       WHERE a.project_id = project_to_delete
      UNION ALL
      SELECT a.organization_id::uuid, NULL::text, a.storage_key::text
        FROM public.design_revision_artifacts a
       WHERE a.project_id = project_to_delete;

    PERFORM set_config('app.allow_project_cascade_delete', 'on', true);

    -- These are the only grandchildren with NO ACTION edges into the cascade.
    DELETE FROM public.design_publish_sessions WHERE project_id = project_to_delete;
    DELETE FROM public.production_release_manufacturing_snapshots WHERE project_id = project_to_delete;
    DELETE FROM public.production_release_engineering WHERE project_id = project_to_delete;
    DELETE FROM public.production_releases WHERE project_id = project_to_delete;
    DELETE FROM public.projects WHERE id = project_to_delete;
END;
$$;

REVOKE ALL ON FUNCTION delete_project_tree(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_project_tree(uuid) TO granete_app;

-- Upgrade: every existing deposit_received event with a valid payload becomes
-- a deposit row. The id is derived from the event id so the backfill is
-- idempotent; the event date is the declared payment date (at), the actor is
-- the event author when known. Events with an invalid payload are NOT
-- invented into money: they stay as lifecycle history only.
INSERT INTO project_payments
    (id, organization_id, project_id, kind, amount, currency, payment_method,
     reference, received_at, recorded_at, recorded_by, project_event_id, origin)
SELECT
    md5('project-payment:' || e.id)::uuid,
    e.organization_id,
    e.project_id,
    'deposit',
    round(CASE WHEN jsonb_typeof(e.payload -> 'amount') = 'number'
               THEN (e.payload ->> 'amount')::numeric END, 2),
    e.payload ->> 'currency',
    CASE WHEN e.payload ->> 'paymentMethod' IN ('cash', 'transfer', 'card', 'check', 'other')
         THEN e.payload ->> 'paymentMethod' END,
    CASE WHEN jsonb_typeof(e.payload -> 'reference') = 'string'
         THEN NULLIF(left(btrim(e.payload ->> 'reference'), 120), '') END,
    e.at,
    e.created_at,
    e.by_user_id,
    e.id,
    'migrated_event'
FROM project_events e
WHERE e.type = 'deposit_received'
  AND e.organization_id IS NOT NULL
  AND (CASE WHEN jsonb_typeof(e.payload -> 'amount') = 'number'
            THEN (e.payload ->> 'amount')::numeric END) > 0
  AND (CASE WHEN jsonb_typeof(e.payload -> 'amount') = 'number'
            THEN (e.payload ->> 'amount')::numeric END) <= 1000000000000
  AND jsonb_typeof(e.payload -> 'currency') = 'string'
  AND (e.payload ->> 'currency') ~ '^[A-Z]{3}$'
ON CONFLICT DO NOTHING;
