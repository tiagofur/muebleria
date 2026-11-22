package storage

// #1646 durable outbound email. The table is command-only (000192): the
// runtime role reaches it exclusively through SECURITY DEFINER functions.
// Enqueue joins the ambient transaction, so a message exists if and only if
// the mutation that minted its one-time credential committed.

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/tiagofur/muebles-backend/internal/mail"
)

// Email outbox kinds (CHECK constraint in 000192).
const (
	EmailKindPasswordReset = "password_reset"
	EmailKindInvitation    = "invitation"
)

// OutboundEmail is one message to enqueue. ExpiresAt is the expiry of the
// credential the message carries: past it, the worker drops the message
// instead of mailing a dead link.
type OutboundEmail struct {
	Kind           string
	OrganizationID string
	Message        mail.Message
	ExpiresAt      time.Time
}

// ClaimedEmail is a leased outbox row ready to send.
type ClaimedEmail struct {
	ID       string
	Kind     string
	Message  mail.Message
	Attempts int
}

// EnqueueEmail validates and stores a message inside the ambient
// transaction (or its own when there is none).
func (s *PostgresStore) EnqueueEmail(ctx context.Context, email OutboundEmail) (string, error) {
	if email.Kind != EmailKindPasswordReset && email.Kind != EmailKindInvitation {
		return "", fmt.Errorf("email outbox: unknown kind %q", email.Kind)
	}
	if err := email.Message.Validate(); err != nil {
		return "", fmt.Errorf("email outbox: %w", err)
	}
	if !email.ExpiresAt.After(time.Now()) {
		return "", errors.New("email outbox: message already expired")
	}
	var id string
	err := s.db(ctx).QueryRow(ctx, `SELECT enqueue_email_outbox($1, NULLIF($2,'')::uuid, $3, $4, $5, $6, $7)`,
		email.Kind, email.OrganizationID, email.Message.To, email.Message.Subject,
		email.Message.Text, email.Message.HTML, email.ExpiresAt).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("enqueue email: %w", err)
	}
	return id, nil
}

// ClaimEmailBatch expires stale messages and leases up to limit due ones.
// The lease protects against a crash mid-send: the row becomes due again
// once it lapses, and SKIP LOCKED keeps concurrent workers disjoint.
func (s *PostgresStore) ClaimEmailBatch(ctx context.Context, limit int, lease time.Duration) ([]ClaimedEmail, error) {
	rows, err := s.Pool.Query(ctx, `SELECT id, kind, recipient, subject, body_text, COALESCE(body_html,''), attempts FROM claim_email_outbox_batch($1, $2)`,
		limit, int(lease.Seconds()))
	if err != nil {
		return nil, fmt.Errorf("claim email batch: %w", err)
	}
	defer rows.Close()
	out := []ClaimedEmail{}
	for rows.Next() {
		var c ClaimedEmail
		if err := rows.Scan(&c.ID, &c.Kind, &c.Message.To, &c.Message.Subject, &c.Message.Text, &c.Message.HTML, &c.Attempts); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// MarkEmailSent records delivery and clears the stored body.
func (s *PostgresStore) MarkEmailSent(ctx context.Context, id string) error {
	_, err := s.Pool.Exec(ctx, `SELECT mark_email_outbox_sent($1)`, id)
	return err
}

// MarkEmailFailed re-schedules a transient failure at retryAt, or (final)
// gives up and clears the body. sanitizedError must carry no recipient,
// token or body.
func (s *PostgresStore) MarkEmailFailed(ctx context.Context, id, sanitizedError string, retryAt time.Time, final bool) error {
	_, err := s.Pool.Exec(ctx, `SELECT mark_email_outbox_failed($1, $2, $3, $4)`, id, sanitizedError, retryAt, final)
	return err
}
