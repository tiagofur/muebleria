package storage

// #1646 durable outbound email. The table is command-only (000192): the
// runtime role reaches it exclusively through SECURITY DEFINER functions,
// and the message is stored only as an AEAD-sealed payload whose key lives
// in the application (EmailCipher). Enqueue joins the ambient transaction,
// so a message exists if and only if the mutation that minted its one-time
// credential committed.

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

// PasswordResetEmailCooldown spaces self-service reset emails per account:
// a request inside the window answers exactly like any other but neither
// mints a token nor sends mail (no mail-bombing a victim's inbox).
const PasswordResetEmailCooldown = 2 * time.Minute

// ErrEmailCipherMissing means the store was built without EmailCipher: the
// outbox refuses to store a message it could not seal.
var ErrEmailCipherMissing = errors.New("email outbox: cipher not configured")

// OutboundEmail is one message to enqueue. Ref is the non-PII owner of the
// credential (user id for a reset, invitation id for an invitation): a newer
// message for the same (Kind, Ref) supersedes the pending one. ExpiresAt is
// the expiry of the credential the message carries: past it, the worker
// drops the message instead of mailing a dead link.
type OutboundEmail struct {
	Kind           string
	OrganizationID string
	Ref            string
	Message        mail.Message
	ExpiresAt      time.Time
}

// ClaimedEmail is a leased outbox row ready to send. LeaseToken must be
// passed back to MarkEmailSent/MarkEmailFailed.
type ClaimedEmail struct {
	ID         string
	Kind       string
	Message    mail.Message
	Attempts   int
	LeaseToken string
	// OpenErr is set when the payload could not be opened (for example the
	// key changed); the worker records it as a final failure.
	OpenErr error
}

// EnqueueEmail validates, seals and stores a message inside the ambient
// transaction (or its own when there is none).
func (s *PostgresStore) EnqueueEmail(ctx context.Context, email OutboundEmail) (string, error) {
	if s.EmailCipher == nil {
		return "", ErrEmailCipherMissing
	}
	if email.Kind != EmailKindPasswordReset && email.Kind != EmailKindInvitation {
		return "", fmt.Errorf("email outbox: unknown kind %q", email.Kind)
	}
	if email.Ref == "" {
		return "", errors.New("email outbox: ref is required")
	}
	if err := email.Message.Validate(); err != nil {
		return "", fmt.Errorf("email outbox: %w", err)
	}
	if !email.ExpiresAt.After(time.Now()) {
		return "", errors.New("email outbox: message already expired")
	}
	sealed, err := s.EmailCipher.Seal(email.Message)
	if err != nil {
		return "", fmt.Errorf("email outbox: seal: %w", err)
	}
	var id string
	if err := s.db(ctx).QueryRow(ctx, `SELECT enqueue_email_outbox($1, NULLIF($2,'')::uuid, $3, $4, $5)`,
		email.Kind, email.OrganizationID, email.Ref, sealed, email.ExpiresAt).Scan(&id); err != nil {
		return "", fmt.Errorf("enqueue email: %w", err)
	}
	return id, nil
}

// CancelEmails cancels pending messages for (kind, ref) — for example when
// an invitation is revoked — inside the ambient transaction.
func (s *PostgresStore) CancelEmails(ctx context.Context, kind, ref string) (int, error) {
	var n int
	err := s.db(ctx).QueryRow(ctx, `SELECT cancel_email_outbox($1, $2)`, kind, ref).Scan(&n)
	return n, err
}

func (s *PostgresStore) recentEmailExists(ctx context.Context, kind, ref string, window time.Duration) (bool, error) {
	var exists bool
	err := s.db(ctx).QueryRow(ctx, `SELECT recent_email_outbox_exists($1, $2, $3)`, kind, ref, int(window.Seconds())).Scan(&exists)
	return exists, err
}

// ClaimEmailBatch expires stale messages and leases up to limit due ones.
// The lease protects against a crash mid-send: the row becomes due again
// once it lapses, and SKIP LOCKED keeps concurrent workers disjoint.
func (s *PostgresStore) ClaimEmailBatch(ctx context.Context, limit int, lease time.Duration) ([]ClaimedEmail, error) {
	if s.EmailCipher == nil {
		return nil, ErrEmailCipherMissing
	}
	rows, err := s.Pool.Query(ctx, `SELECT id, kind, payload, attempts, lease_token FROM claim_email_outbox_batch($1, $2)`,
		limit, int(lease.Seconds()))
	if err != nil {
		return nil, fmt.Errorf("claim email batch: %w", err)
	}
	defer rows.Close()
	out := []ClaimedEmail{}
	for rows.Next() {
		var c ClaimedEmail
		var payload string
		if err := rows.Scan(&c.ID, &c.Kind, &payload, &c.Attempts, &c.LeaseToken); err != nil {
			return nil, err
		}
		c.Message, c.OpenErr = s.EmailCipher.Open(payload)
		out = append(out, c)
	}
	return out, rows.Err()
}

// MarkEmailSent records delivery and clears the payload. It reports false
// when the lease was lost (another worker re-claimed the row).
func (s *PostgresStore) MarkEmailSent(ctx context.Context, id, leaseToken string) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `SELECT mark_email_outbox_sent($1, $2)`, id, leaseToken).Scan(&ok)
	return ok, err
}

// MarkEmailFailed re-schedules a transient failure at retryAt, or (final)
// gives up and clears the payload. sanitizedError must carry no recipient,
// token or body. It reports false when the lease was lost.
func (s *PostgresStore) MarkEmailFailed(ctx context.Context, id, leaseToken, sanitizedError string, retryAt time.Time, final bool) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `SELECT mark_email_outbox_failed($1, $2, $3, $4, $5)`, id, leaseToken, sanitizedError, retryAt, final).Scan(&ok)
	return ok, err
}
