-- #1646: durable outbound email outbox.
--
-- Messages (password reset links, team invitations) are enqueued in the SAME
-- transaction as the mutation that mints their one-time credential, and a
-- worker delivers them with retries.
--
-- The message (recipient, subject, bodies) carries a one-time link, so it is
-- stored ONLY as an AEAD-sealed payload: the key lives in the application,
-- never in the database, so neither the runtime role, a backup nor a replica
-- holds a usable link or the recipient address (same rule as the sealed
-- idempotency receipts, review #1195). The runtime role still has no direct
-- table access (password_reset_tokens precedent, 000158): every path goes
-- through the SECURITY DEFINER functions below. The payload is cleared as soon
-- as a message is sent, fails for good, is superseded/cancelled or expires.
--
-- ref is a non-PII reference to the credential owner (the user id for a
-- reset, the invitation id for an invitation): a newer message for the same
-- (kind, ref) supersedes the pending one (its link is dead after rotation),
-- revoking an invitation cancels it, and the self-service reset uses it as a
-- per-account cooldown.

CREATE TABLE email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN ('password_reset', 'invitation')),
    organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
    ref TEXT NOT NULL CHECK (length(ref) BETWEEN 1 AND 200),
    payload TEXT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'expired', 'cancelled')),
    attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_token UUID NULL,
    last_error TEXT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ NULL,
    CONSTRAINT email_outbox_payload_while_pending CHECK (status <> 'pending' OR payload IS NOT NULL),
    CONSTRAINT email_outbox_no_payload_at_rest CHECK (status = 'pending' OR payload IS NULL)
);

CREATE INDEX idx_email_outbox_due ON email_outbox(next_attempt_at) WHERE status = 'pending';
CREATE INDEX idx_email_outbox_ref ON email_outbox(kind, ref, created_at DESC);

REVOKE ALL ON email_outbox FROM granete_app;

CREATE FUNCTION enqueue_email_outbox(
    p_kind TEXT,
    p_organization_id UUID,
    p_ref TEXT,
    p_payload TEXT,
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
    IF p_payload IS NULL OR left(p_payload, 5) <> 'gcm1:' THEN
        RAISE EXCEPTION 'email outbox payload must be sealed';
    END IF;
    -- The newer credential rotated the older one away: its message would
    -- only carry a dead link.
    UPDATE email_outbox
       SET status = 'cancelled', payload = NULL, lease_token = NULL
     WHERE kind = p_kind AND ref = p_ref AND status = 'pending';
    INSERT INTO email_outbox(kind, organization_id, ref, payload, expires_at)
    VALUES (p_kind, p_organization_id, p_ref, p_payload, p_expires_at)
    RETURNING id INTO v_id;
    RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION enqueue_email_outbox(TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_email_outbox(TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) TO granete_app;

CREATE FUNCTION cancel_email_outbox(p_kind TEXT, p_ref TEXT)
RETURNS INT
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    WITH cancelled AS (
        UPDATE email_outbox
           SET status = 'cancelled', payload = NULL, lease_token = NULL
         WHERE kind = p_kind AND ref = p_ref AND status = 'pending'
        RETURNING 1
    )
    SELECT count(*)::INT FROM cancelled;
$$;
REVOKE ALL ON FUNCTION cancel_email_outbox(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_email_outbox(TEXT, TEXT) TO granete_app;

-- Per-credential-owner cooldown: was a message for (kind, ref) queued or sent
-- within the last p_seconds?
CREATE FUNCTION recent_email_outbox_exists(p_kind TEXT, p_ref TEXT, p_seconds INT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM email_outbox
         WHERE kind = p_kind AND ref = p_ref
           AND status IN ('pending', 'sent')
           AND created_at > NOW() - make_interval(secs => GREATEST(p_seconds, 0))
    );
$$;
REVOKE ALL ON FUNCTION recent_email_outbox_exists(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recent_email_outbox_exists(TEXT, TEXT, INT) TO granete_app;

-- Expires stale messages (clearing their payloads) and leases a batch of due
-- ones with SKIP LOCKED, so several API instances never claim the same row.
-- Each claim gets a fresh lease token; the mark functions only act for the
-- current holder, so a worker whose lease lapsed cannot overwrite the state
-- recorded by the worker that re-claimed the row.
CREATE FUNCTION claim_email_outbox_batch(p_limit INT, p_lease_seconds INT)
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
BEGIN
    UPDATE email_outbox o
       SET status = 'expired', payload = NULL, lease_token = NULL
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
           next_attempt_at = NOW() + make_interval(secs => GREATEST(p_lease_seconds, 1)),
           lease_token = gen_random_uuid()
      FROM due
     WHERE o.id = due.id
    RETURNING o.id, o.kind, o.payload, o.attempts, o.lease_token;
END
$$;
REVOKE ALL ON FUNCTION claim_email_outbox_batch(INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_email_outbox_batch(INT, INT) TO granete_app;

CREATE FUNCTION mark_email_outbox_sent(p_id UUID, p_lease_token UUID)
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    WITH marked AS (
        UPDATE email_outbox
           SET status = 'sent', sent_at = NOW(), payload = NULL, lease_token = NULL, last_error = NULL
         WHERE id = p_id AND status = 'pending' AND lease_token = p_lease_token
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM marked);
$$;
REVOKE ALL ON FUNCTION mark_email_outbox_sent(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_email_outbox_sent(UUID, UUID) TO granete_app;

-- A transient failure re-schedules; a final one (attempts exhausted or a
-- permanent provider rejection) clears the payload. p_error must already be
-- sanitized by the caller (no recipient, no body).
CREATE FUNCTION mark_email_outbox_failed(p_id UUID, p_lease_token UUID, p_error TEXT, p_retry_at TIMESTAMPTZ, p_final BOOLEAN)
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    WITH marked AS (
        UPDATE email_outbox
           SET status = CASE WHEN p_final THEN 'failed' ELSE 'pending' END,
               next_attempt_at = CASE WHEN p_final THEN next_attempt_at ELSE p_retry_at END,
               payload = CASE WHEN p_final THEN NULL ELSE payload END,
               lease_token = NULL,
               last_error = left(p_error, 500)
         WHERE id = p_id AND status = 'pending' AND lease_token = p_lease_token
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM marked);
$$;
REVOKE ALL ON FUNCTION mark_email_outbox_failed(UUID, UUID, TEXT, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_email_outbox_failed(UUID, UUID, TEXT, TIMESTAMPTZ, BOOLEAN) TO granete_app;

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('email_outbox', 'platform-global', 'identity-credential', 'identity-command',
        'Outbound email carrying one-time links: AEAD-sealed payload (key held by the app), direct table access revoked from the runtime role; enqueue/claim/mark/cancel go through SECURITY DEFINER functions; payload cleared once sent, failed, cancelled or expired')
ON CONFLICT (table_name) DO NOTHING;
