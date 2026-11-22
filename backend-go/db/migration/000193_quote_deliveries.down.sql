-- Restores the 000192 outbox (no quote kind) and drops quote deliveries.
DELETE FROM rls_policy_inventory WHERE table_name = 'quote_deliveries';
DELETE FROM email_outbox WHERE kind = 'quote';
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_check CHECK (kind IN ('password_reset', 'invitation'));

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

CREATE OR REPLACE FUNCTION mark_email_outbox_sent(p_id UUID, p_lease_token UUID)
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

CREATE OR REPLACE FUNCTION mark_email_outbox_failed(p_id UUID, p_lease_token UUID, p_error TEXT, p_retry_at TIMESTAMPTZ, p_final BOOLEAN)
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

DROP FUNCTION IF EXISTS confirm_quote_delivery(UUID);
DROP FUNCTION IF EXISTS record_quote_delivery_outcome(UUID, TEXT, TEXT);
DROP TABLE IF EXISTS quote_deliveries;
