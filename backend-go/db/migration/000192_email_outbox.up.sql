-- #1646: durable outbound email outbox.
--
-- Messages (password reset links, team invitations) are enqueued in the SAME
-- transaction as the mutation that mints their one-time credential, and a
-- worker delivers them with retries. The rendered body carries a one-time
-- link, so the table follows the password_reset_tokens precedent (000158):
-- the runtime role has NO direct table access; every path goes through the
-- SECURITY DEFINER functions below. Bodies are cleared as soon as a message
-- is sent, fails for good or expires (its credential's own expiry), so a
-- usable link never outlives its purpose at rest.

CREATE TABLE email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN ('password_reset', 'invitation')),
    organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_text TEXT NULL,
    body_html TEXT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'expired')),
    attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ NULL,
    CONSTRAINT email_outbox_body_while_pending CHECK (status <> 'pending' OR body_text IS NOT NULL)
);

CREATE INDEX idx_email_outbox_due ON email_outbox(next_attempt_at) WHERE status = 'pending';
CREATE INDEX idx_email_outbox_created ON email_outbox(created_at DESC);

REVOKE ALL ON email_outbox FROM granete_app;

CREATE FUNCTION enqueue_email_outbox(
    p_kind TEXT,
    p_organization_id UUID,
    p_recipient TEXT,
    p_subject TEXT,
    p_body_text TEXT,
    p_body_html TEXT,
    p_expires_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_expires_at <= NOW() THEN
        RAISE EXCEPTION 'email outbox message already expired';
    END IF;
    INSERT INTO email_outbox(kind, organization_id, recipient, subject, body_text, body_html, expires_at)
    VALUES (p_kind, p_organization_id, p_recipient, p_subject, p_body_text, NULLIF(p_body_html, ''), p_expires_at)
    RETURNING id INTO v_id;
    RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION enqueue_email_outbox(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_email_outbox(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO granete_app;

-- Expires stale messages (clearing their bodies) and leases a batch of due
-- ones with SKIP LOCKED, so several API instances never send the same row.
-- The lease moves next_attempt_at forward: a crash mid-send simply retries
-- after the lease instead of losing the message.
CREATE FUNCTION claim_email_outbox_batch(p_limit INT, p_lease_seconds INT)
RETURNS TABLE (
    id UUID,
    kind TEXT,
    recipient TEXT,
    subject TEXT,
    body_text TEXT,
    body_html TEXT,
    attempts INT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    UPDATE email_outbox o
       SET status = 'expired', body_text = NULL, body_html = NULL
     WHERE o.status = 'pending' AND o.expires_at <= NOW();

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
           next_attempt_at = NOW() + make_interval(secs => GREATEST(p_lease_seconds, 1))
      FROM due
     WHERE o.id = due.id
    RETURNING o.id, o.kind, o.recipient, o.subject, o.body_text, o.body_html, o.attempts;
END
$$;
REVOKE ALL ON FUNCTION claim_email_outbox_batch(INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_email_outbox_batch(INT, INT) TO granete_app;

CREATE FUNCTION mark_email_outbox_sent(p_id UUID)
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    UPDATE email_outbox
       SET status = 'sent', sent_at = NOW(), body_text = NULL, body_html = NULL, last_error = NULL
     WHERE id = p_id AND status = 'pending';
$$;
REVOKE ALL ON FUNCTION mark_email_outbox_sent(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_email_outbox_sent(UUID) TO granete_app;

-- A transient failure re-schedules; a final one (attempts exhausted or a
-- permanent provider rejection) clears the body. p_error must already be
-- sanitized by the caller (no recipient, no body).
CREATE FUNCTION mark_email_outbox_failed(p_id UUID, p_error TEXT, p_retry_at TIMESTAMPTZ, p_final BOOLEAN)
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    UPDATE email_outbox
       SET status = CASE WHEN p_final THEN 'failed' ELSE 'pending' END,
           next_attempt_at = CASE WHEN p_final THEN next_attempt_at ELSE p_retry_at END,
           body_text = CASE WHEN p_final THEN NULL ELSE body_text END,
           body_html = CASE WHEN p_final THEN NULL ELSE body_html END,
           last_error = left(p_error, 500)
     WHERE id = p_id AND status = 'pending';
$$;
REVOKE ALL ON FUNCTION mark_email_outbox_failed(UUID, TEXT, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_email_outbox_failed(UUID, TEXT, TIMESTAMPTZ, BOOLEAN) TO granete_app;

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('email_outbox', 'platform-global', 'identity-credential', 'identity-command',
        'Outbound email carrying one-time links: direct table access revoked from the runtime role; enqueue/claim/mark go through SECURITY DEFINER functions; bodies cleared once sent, failed or expired')
ON CONFLICT (table_name) DO NOTHING;
