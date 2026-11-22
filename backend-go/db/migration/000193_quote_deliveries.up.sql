-- #1650: send the EXACT QuoteRevision to the customer by email (exact PDF
-- attached) or WhatsApp (prefilled message the user completes in their own
-- WhatsApp), with a durable record of each send.
--
-- quote_deliveries is tenant-private commercial data of the organization that
-- sends the quote. requested_at is when the user asked; sent_at is the REAL
-- send moment: the SMTP acceptance recorded by the email worker, or the
-- user's explicit confirmation for WhatsApp (never inferred: an unconfirmed
-- WhatsApp delivery is not "sent"). pdf_sha256 pins the exact attachment.
--
-- A sent delivery records the commercial fact once, server-side, in the same
-- transaction: a quote_sent project event (and commercial_status 'sent') only
-- while the project is still a draft or already sent — a quote re-sent after
-- the deal was won/lost must never roll the commercial status back — plus the
-- security audit row. The email path runs from the outbox worker (no tenant
-- context), so the transition lives in one SECURITY DEFINER function shared
-- by both channels.

CREATE TABLE quote_deliveries (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    quote_revision_id UUID NOT NULL REFERENCES quote_revisions(id) ON DELETE CASCADE,
    revision_number INT NOT NULL CHECK (revision_number > 0),
    channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
    recipient TEXT NOT NULL CHECK (char_length(recipient) BETWEEN 3 AND 320),
    variant TEXT NULL CHECK (variant IN ('detailed', 'summary')),
    pdf_sha256 TEXT NULL CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
    pdf_bytes INT NULL CHECK (pdf_bytes > 0),
    pdf_file_name TEXT NULL CHECK (pdf_file_name IS NULL OR char_length(pdf_file_name) <= 200),
    status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'prepared', 'confirmed')),
    requested_by UUID NOT NULL REFERENCES users(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ NULL,
    failure_reason TEXT NULL CHECK (failure_reason IS NULL OR char_length(failure_reason) <= 500),
    project_event_id TEXT NULL,
    CONSTRAINT quote_deliveries_channel_status CHECK (
        (channel = 'email' AND status IN ('queued', 'sent', 'failed') AND pdf_sha256 IS NOT NULL AND variant IS NOT NULL)
        OR (channel = 'whatsapp' AND status IN ('prepared', 'confirmed'))
    ),
    CONSTRAINT quote_deliveries_sent_at CHECK ((status IN ('sent', 'confirmed')) = (sent_at IS NOT NULL))
);

CREATE INDEX idx_quote_deliveries_project ON quote_deliveries (project_id, requested_at DESC);
CREATE INDEX idx_quote_deliveries_revision ON quote_deliveries (quote_revision_id);
CREATE INDEX idx_quote_deliveries_organization ON quote_deliveries (organization_id);

ALTER TABLE quote_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY quote_delivery_read ON quote_deliveries FOR SELECT
    USING (organization_id = app_current_organization_id());
CREATE POLICY quote_delivery_insert ON quote_deliveries FOR INSERT
    WITH CHECK (organization_id = app_current_organization_id());
GRANT SELECT, INSERT ON quote_deliveries TO granete_app;
REVOKE UPDATE, DELETE ON quote_deliveries FROM granete_app;

-- The only state transitions: queued → sent|failed (email, worker) and
-- prepared → confirmed (WhatsApp, the user). Both go through here.
CREATE FUNCTION record_quote_delivery_outcome(p_delivery_id UUID, p_outcome TEXT, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
    d quote_deliveries%ROWTYPE;
    v_event_id TEXT;
    v_status TEXT;
BEGIN
    IF p_outcome NOT IN ('sent', 'failed', 'confirmed') THEN
        RAISE EXCEPTION 'unknown quote delivery outcome %', p_outcome;
    END IF;
    SELECT * INTO d FROM quote_deliveries WHERE id = p_delivery_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    IF NOT ((d.status = 'queued' AND p_outcome IN ('sent', 'failed'))
            OR (d.status = 'prepared' AND p_outcome = 'confirmed')) THEN
        RETURN FALSE;
    END IF;

    IF p_outcome = 'failed' THEN
        UPDATE quote_deliveries SET status = 'failed', failure_reason = left(p_reason, 500) WHERE id = d.id;
        INSERT INTO security_audit_events (event_type, schema_version, actor_user_id, organization_id, details)
        VALUES ('quote_delivery_failed', 1, d.requested_by, d.organization_id,
                jsonb_build_object('delivery_id', d.id, 'project_id', d.project_id,
                                   'quote_revision_id', d.quote_revision_id, 'channel', d.channel,
                                   'reason', left(p_reason, 500)));
        RETURN TRUE;
    END IF;

    SELECT commercial_status INTO v_status FROM projects WHERE id = d.project_id FOR UPDATE;
    IF (v_status IS NULL OR v_status IN ('draft', 'sent'))
       AND NOT EXISTS (
           SELECT 1 FROM project_events
            WHERE project_id = d.project_id
              AND type IN ('quote_won', 'deposit_received', 'quote_lost', 'quote_expired', 'quote_cancelled')
       ) THEN
        v_event_id := gen_random_uuid()::text;
        INSERT INTO project_events (id, project_id, type, at, by_user_id, source, note, payload, organization_id)
        VALUES (v_event_id, d.project_id, 'quote_sent', NOW(), d.requested_by, 'api', NULL,
                jsonb_build_object('quoteRevisionId', d.quote_revision_id, 'revisionNumber', d.revision_number,
                                   'channel', d.channel, 'deliveryId', d.id, 'pdfSha256', d.pdf_sha256),
                d.organization_id);
        UPDATE projects SET commercial_status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = d.project_id;
    END IF;

    UPDATE quote_deliveries
       SET status = p_outcome, sent_at = NOW(), project_event_id = v_event_id
     WHERE id = d.id;
    INSERT INTO security_audit_events (event_type, schema_version, actor_user_id, organization_id, details)
    VALUES ('quote_delivery_sent', 1, d.requested_by, d.organization_id,
            jsonb_build_object('delivery_id', d.id, 'project_id', d.project_id,
                               'quote_revision_id', d.quote_revision_id, 'revision_number', d.revision_number,
                               'channel', d.channel, 'pdf_sha256', d.pdf_sha256,
                               'project_event_id', v_event_id));
    RETURN TRUE;
END
$$;
REVOKE ALL ON FUNCTION record_quote_delivery_outcome(UUID, TEXT, TEXT) FROM PUBLIC;

-- The WhatsApp confirmation is a user command: the runtime role may only
-- confirm a delivery of its own organization (tenant check here, since the
-- definer bypasses RLS).
CREATE FUNCTION confirm_quote_delivery(p_delivery_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM quote_deliveries
         WHERE id = p_delivery_id AND organization_id = app_current_organization_id() AND channel = 'whatsapp'
    ) THEN
        RETURN FALSE;
    END IF;
    RETURN record_quote_delivery_outcome(p_delivery_id, 'confirmed', NULL);
END
$$;
REVOKE ALL ON FUNCTION confirm_quote_delivery(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_quote_delivery(UUID) TO granete_app;

-- Email outbox: a third kind whose ref is the quote delivery id; the mark
-- functions report the outcome to the delivery in the same transaction.
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_check CHECK (kind IN ('password_reset', 'invitation', 'quote'));

CREATE OR REPLACE FUNCTION mark_email_outbox_sent(p_id UUID, p_lease_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_kind TEXT;
    v_ref TEXT;
BEGIN
    UPDATE email_outbox
       SET status = 'sent', sent_at = NOW(), payload = NULL, lease_token = NULL, last_error = NULL
     WHERE id = p_id AND status = 'pending' AND lease_token = p_lease_token
    RETURNING kind, ref INTO v_kind, v_ref;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    IF v_kind = 'quote' THEN
        PERFORM record_quote_delivery_outcome(v_ref::uuid, 'sent', NULL);
    END IF;
    RETURN TRUE;
END
$$;

CREATE OR REPLACE FUNCTION mark_email_outbox_failed(p_id UUID, p_lease_token UUID, p_error TEXT, p_retry_at TIMESTAMPTZ, p_final BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_kind TEXT;
    v_ref TEXT;
BEGIN
    UPDATE email_outbox
       SET status = CASE WHEN p_final THEN 'failed' ELSE 'pending' END,
           next_attempt_at = CASE WHEN p_final THEN next_attempt_at ELSE p_retry_at END,
           payload = CASE WHEN p_final THEN NULL ELSE payload END,
           lease_token = NULL,
           last_error = left(p_error, 500)
     WHERE id = p_id AND status = 'pending' AND lease_token = p_lease_token
    RETURNING kind, ref INTO v_kind, v_ref;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    IF p_final AND v_kind = 'quote' THEN
        PERFORM record_quote_delivery_outcome(v_ref::uuid, 'failed', p_error);
    END IF;
    RETURN TRUE;
END
$$;

-- Expiry also closes a quote delivery as failed (its email never left).
CREATE OR REPLACE FUNCTION claim_email_outbox_batch(p_limit INT, p_lease_seconds INT)
RETURNS TABLE (
    id UUID,
    kind TEXT,
    payload TEXT,
    attempts INT,
    lease_token UUID
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    expired RECORD;
BEGIN
    FOR expired IN
        UPDATE email_outbox o
           SET status = 'expired', payload = NULL, lease_token = NULL
         WHERE o.status = 'pending' AND o.expires_at <= NOW()
        RETURNING o.kind, o.ref
    LOOP
        IF expired.kind = 'quote' THEN
            PERFORM record_quote_delivery_outcome(expired.ref::uuid, 'failed', 'el email venció sin poder enviarse');
        END IF;
    END LOOP;

    RETURN QUERY
    WITH due AS (
        SELECT o.id
          FROM email_outbox o
         WHERE o.status = 'pending' AND o.next_attempt_at <= NOW()
         ORDER BY o.next_attempt_at
         LIMIT GREATEST(p_limit, 1)
         FOR UPDATE SKIP LOCKED
    )
    UPDATE email_outbox o
       SET attempts = o.attempts + 1,
           next_attempt_at = NOW() + make_interval(secs => GREATEST(p_lease_seconds, 1)),
           lease_token = gen_random_uuid()
      FROM due
     WHERE o.id = due.id
    RETURNING o.id, o.kind, o.payload, o.attempts, o.lease_token;
END
$$;

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('quote_deliveries', 'append-only', 'organization', 'insert-only-organization',
        'Quote sends (#1650): tenant-private commercial record of the sending organization; status transitions only through record_quote_delivery_outcome (worker) and confirm_quote_delivery (tenant-checked)')
ON CONFLICT (table_name) DO NOTHING;
