DELETE FROM rls_policy_inventory WHERE table_name = 'email_outbox';
DROP FUNCTION IF EXISTS mark_email_outbox_failed(UUID, UUID, TEXT, TIMESTAMPTZ, BOOLEAN);
DROP FUNCTION IF EXISTS mark_email_outbox_sent(UUID, UUID);
DROP FUNCTION IF EXISTS claim_email_outbox_batch(INT, INT);
DROP FUNCTION IF EXISTS recent_email_outbox_exists(TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS cancel_email_outbox(TEXT, TEXT);
DROP FUNCTION IF EXISTS enqueue_email_outbox(TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ);
DROP TABLE IF EXISTS email_outbox;
