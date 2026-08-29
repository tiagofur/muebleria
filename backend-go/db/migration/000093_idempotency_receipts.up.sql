CREATE TABLE api_idempotency_receipts (
    scope_key TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    status INTEGER,
    headers JSONB,
    body BYTEA,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + INTERVAL '24 hours'),
    completed_at TIMESTAMPTZ,
    CONSTRAINT api_idempotency_receipts_completed CHECK (
        (completed_at IS NULL AND status IS NULL AND headers IS NULL AND body IS NULL)
        OR
        (completed_at IS NOT NULL AND status BETWEEN 100 AND 599 AND headers IS NOT NULL AND body IS NOT NULL)
    )
);

CREATE INDEX idx_api_idempotency_receipts_expiry
    ON api_idempotency_receipts (expires_at);

COMMENT ON TABLE api_idempotency_receipts IS
    'Durable 24-hour HTTP command receipts; 2xx commits atomically with mutations, 4xx retains only the response after savepoint rollback.';
