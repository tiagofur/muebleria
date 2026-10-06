package storage

// #1178 one-time password reset tokens. The table is command-only (000158):
// the runtime role has no direct access, so every statement here goes through
// SECURITY DEFINER functions. The confirm flow mirrors AcceptInvitation: one
// transaction that locks the exact-hash token, mutates the password, consumes
// the token, revokes every live session of the identity and commits the audit
// evidence — any failure rolls all of it back.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// PasswordResetTokenTTL bounds every reset link: short by design — a reset
// link is a credential, not an invitation (14 days there, one hour here).
const PasswordResetTokenTTL = 60 * time.Minute

var (
	// ErrPasswordResetTokenInvalid covers unknown, expired, used and revoked
	// tokens alike: the requester holds a high-entropy credential, so there
	// is no oracle value in distinguishing the failure modes.
	ErrPasswordResetTokenInvalid = errors.New("password reset token invalid")
)

// PasswordResetIssuance is the raw one-time token plus its expiry. The raw
// token crosses this boundary exactly once; only the hash is ever stored.
type PasswordResetIssuance struct {
	Token     string
	ExpiresAt time.Time
}

func randomResetToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate reset token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

func hashResetToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// IssuePasswordResetToken mints a reset token for the target identity and
// revokes previous open tokens (rotation). issuedVia must be "admin" (with
// the issuing actor) or "self" (anonymous); the definer function re-checks
// that shape so a request can never forge the other class. It joins the
// ambient transaction when the caller runs inside one.
func (s *PostgresStore) IssuePasswordResetToken(ctx context.Context, userID, issuedVia string, issuedBy *string, ttl time.Duration, ip, requestID string) (*PasswordResetIssuance, error) {
	raw, err := randomResetToken()
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().Add(ttl)

	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return nil, err
	}
	if owned {
		defer tx.Rollback(ctx)
	}
	txCtx := context.WithValue(ctx, transactionContextKey{}, tx)

	if _, err = tx.Exec(txCtx, `SELECT issue_password_reset_token($1,$2,$3,$4,$5,$6,$7)`,
		userID, hashResetToken(raw), issuedVia, issuedBy, expiresAt, ip, requestID); err != nil {
		return nil, fmt.Errorf("issue password reset token: %w", err)
	}
	actor := userID
	if issuedBy != nil {
		actor = *issuedBy
	}
	if err = s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
		EventType: "password_reset_issued", SchemaVersion: 1, RequestID: requestID,
		ActorUserID: actor, TargetUserID: userID, IP: ip,
		Details: map[string]interface{}{"issued_via": issuedVia, "expires_at": expiresAt.UTC().Format(time.RFC3339)},
	}); err != nil {
		return nil, fmt.Errorf("audit password reset issuance: %w", err)
	}
	if owned {
		if err = tx.Commit(ctx); err != nil {
			return nil, err
		}
	}
	return &PasswordResetIssuance{Token: raw, ExpiresAt: expiresAt}, nil
}

// RequestPasswordReset is the pre-auth self-service path: the outcome is
// uniform for the requester (the handler answers 204 regardless), and the
// raw token is returned only for server-side delivery (currently the server
// log outside production until an email adapter lands). Disabled accounts
// are treated as unknown: no token, no oracle.
func (s *PostgresStore) RequestPasswordReset(ctx context.Context, email, ip, requestID string) (*PasswordResetIssuance, error) {
	u, err := s.GetUserByEmail(ctx, email)
	if errors.Is(err, ErrUserNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("password reset user lookup: %w", err)
	}
	if u.AccountStatus != domain.AccountStatusActive {
		return nil, nil
	}
	return s.IssuePasswordResetToken(ctx, u.ID, "self", nil, PasswordResetTokenTTL, ip, requestID)
}

// ConfirmPasswordResetCommand carries the raw token and the ALREADY validated
// and hashed new password: policy checking stays in the auth layer, this
// method only hashes the token for lookup, persists and cuts access.
type ConfirmPasswordResetCommand struct {
	Token        string
	PasswordHash string
	IP           string
	RequestID    string
}

// ConfirmPasswordReset runs the whole consumption in one transaction. The
// user-scoped tenant actor is established mid-transaction once the token
// resolves (same structure as AcceptInvitation) so the audit event commits
// with the mutation.
func (s *PostgresStore) ConfirmPasswordReset(ctx context.Context, cmd ConfirmPasswordResetCommand) (int, error) {
	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return 0, err
	}
	if owned {
		defer tx.Rollback(ctx)
	}
	txCtx := context.WithValue(ctx, transactionContextKey{}, tx)

	var (
		tokenID   string
		userID    string
		expiresAt time.Time
		usedAt    *time.Time
		revokedAt *time.Time
	)
	err = tx.QueryRow(txCtx, `SELECT id,user_id,expires_at,used_at,revoked_at FROM lock_password_reset_token_by_hash($1)`, hashResetToken(cmd.Token)).
		Scan(&tokenID, &userID, &expiresAt, &usedAt, &revokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrPasswordResetTokenInvalid
	}
	if err != nil {
		return 0, fmt.Errorf("lock password reset token: %w", err)
	}
	if usedAt != nil || revokedAt != nil || !expiresAt.After(time.Now()) {
		return 0, ErrPasswordResetTokenInvalid
	}

	if err = setTenantContext(txCtx, tx, TenantActor{UserID: userID}); err != nil {
		return 0, err
	}
	if _, err = tx.Exec(txCtx, `UPDATE users SET password_hash=$2, updated_at=NOW() WHERE id=$1`, userID, cmd.PasswordHash); err != nil {
		return 0, fmt.Errorf("update password: %w", err)
	}
	if _, err = tx.Exec(txCtx, `SELECT consume_password_reset_token($1,$2)`, tokenID, cmd.IP); err != nil {
		return 0, fmt.Errorf("consume password reset token: %w", err)
	}
	var revoked int
	if err = tx.QueryRow(txCtx, `SELECT app_revoke_user_auth_sessions($1,'password_reset')`, userID).Scan(&revoked); err != nil {
		return 0, fmt.Errorf("revoke user sessions: %w", err)
	}
	if err = s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
		EventType: "password_reset_completed", SchemaVersion: 1, RequestID: cmd.RequestID,
		ActorUserID: userID, TargetUserID: userID, IP: cmd.IP,
		Details: map[string]interface{}{"revoked_sessions": revoked},
	}); err != nil {
		return 0, fmt.Errorf("audit password reset completion: %w", err)
	}
	if owned {
		if err = tx.Commit(ctx); err != nil {
			return 0, err
		}
	}
	return revoked, nil
}
