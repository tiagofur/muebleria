package storage_test

// #1178 password reset tokens: real PostgreSQL lifecycle under the runtime
// role — rotation, single-use consumption, expiry and the user-level session
// cut the confirmation applies.

import (
	"context"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestPasswordResetLifecycle(t *testing.T) {
	ctx := context.Background()
	pool := multiOrgFreshMigrationDB(t)
	identityApplyThrough(t, pool, 158)
	store := &storage.PostgresStore{Pool: pool}

	var userID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO users(email,normalized_email,password_hash,name,account_status) VALUES($1,$2,'x','Usuario Reset','active') RETURNING id`,
		"reset-user@example.com", domain.NormalizeEmail("reset-user@example.com")).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}

	// Issuance stores only the hash (sha256 hex = 64 chars).
	first, err := store.IssuePasswordResetToken(ctx, userID, "admin", &userID, storage.PasswordResetTokenTTL, "10.0.0.1", "req-1178-1")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	var hashLen int
	if err := pool.QueryRow(ctx, `SELECT length(token_hash) FROM password_reset_tokens WHERE user_id=$1`, userID).Scan(&hashLen); err != nil {
		t.Fatalf("read token hash: %v", err)
	}
	if hashLen != 64 {
		t.Fatalf("token hash must be the sha256 hex, got length %d", hashLen)
	}

	// Rotation: a new issuance revokes the previous open token.
	second, err := store.IssuePasswordResetToken(ctx, userID, "self", nil, storage.PasswordResetTokenTTL, "10.0.0.1", "req-1178-2")
	if err != nil {
		t.Fatalf("re-issue: %v", err)
	}
	var openCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM password_reset_tokens WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL`, userID).Scan(&openCount); err != nil {
		t.Fatalf("count open tokens: %v", err)
	}
	if openCount != 1 {
		t.Fatalf("rotation left %d open tokens, want 1", openCount)
	}
	if _, err := store.ConfirmPasswordReset(ctx, storage.ConfirmPasswordResetCommand{Token: first.Token, PasswordHash: "h", IP: "10.0.0.2"}); err != storage.ErrPasswordResetTokenInvalid {
		t.Fatalf("rotated token error = %v", err)
	}

	// Unknown tokens share the same typed error as expired/used ones.
	if _, err := store.ConfirmPasswordReset(ctx, storage.ConfirmPasswordResetCommand{Token: "missing-token", PasswordHash: "h"}); err != storage.ErrPasswordResetTokenInvalid {
		t.Fatalf("unknown token error = %v", err)
	}

	// The confirmation mutates the password, consumes the token and cuts every
	// live session of the identity in one transaction. (Runs before the expiry
	// case below on purpose: issuing another token rotates this one away.)
	hash, err := auth.HashPassword("nueva-pass-1")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if _, err := store.CreateAuthSession(ctx, storage.CreateAuthSessionCommand{
		UserID: userID, ClientType: domain.SessionClientWeb,
		AbsoluteExpiresAt: time.Now().Add(time.Hour), DeviceHint: "test",
	}); err != nil {
		t.Fatalf("create session: %v", err)
	}
	revoked, err := store.ConfirmPasswordReset(ctx, storage.ConfirmPasswordResetCommand{Token: second.Token, PasswordHash: hash, IP: "10.0.0.2", RequestID: "req-1178-confirm"})
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if revoked != 1 {
		t.Fatalf("revoked sessions = %d, want 1", revoked)
	}
	var liveSessions int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL`, userID).Scan(&liveSessions); err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	if liveSessions != 0 {
		t.Fatalf("confirmation left %d live sessions", liveSessions)
	}
	if _, err := store.ConfirmPasswordReset(ctx, storage.ConfirmPasswordResetCommand{Token: second.Token, PasswordHash: hash}); err != storage.ErrPasswordResetTokenInvalid {
		t.Fatalf("reused token error = %v", err)
	}

	// Expiry is enforced at consumption time.
	expired, err := store.IssuePasswordResetToken(ctx, userID, "self", nil, -time.Minute, "10.0.0.1", "req-1178-3")
	if err != nil {
		t.Fatalf("issue expired: %v", err)
	}
	if _, err := store.ConfirmPasswordReset(ctx, storage.ConfirmPasswordResetCommand{Token: expired.Token, PasswordHash: "h"}); err != storage.ErrPasswordResetTokenInvalid {
		t.Fatalf("expired token error = %v", err)
	}
	var usedTokens, audits int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM password_reset_tokens WHERE user_id=$1 AND used_at IS NOT NULL`, userID).Scan(&usedTokens); err != nil {
		t.Fatalf("count used: %v", err)
	}
	if usedTokens != 1 {
		t.Fatalf("used tokens = %d, want 1", usedTokens)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type='password_reset_completed' AND details->>'revoked_sessions'='1'`).Scan(&audits); err != nil {
		t.Fatalf("count audits: %v", err)
	}
	if audits != 1 {
		t.Fatalf("password_reset_completed audits = %d, want 1", audits)
	}
}

// The direct-SQL isolation invariant: the runtime role cannot touch the table
// outside the definer functions (000158 revokes everything from granete_app).
func TestPasswordResetTableIsCommandOnly(t *testing.T) {
	ctx := context.Background()
	pool := multiOrgFreshMigrationDB(t)
	identityApplyThrough(t, pool, 158)
	store := &storage.PostgresStore{Pool: pool}

	var userID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO users(email,normalized_email,password_hash,name,account_status) VALUES($1,$2,'x','Usuario Reset','active') RETURNING id`,
		"reset-direct@example.com", domain.NormalizeEmail("reset-direct@example.com")).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := store.IssuePasswordResetToken(ctx, userID, "self", nil, time.Hour, "10.0.0.1", "req-1178-x"); err != nil {
		t.Fatalf("issue: %v", err)
	}
	var tables int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.table_privileges
		WHERE grantee='granete_app' AND table_name='password_reset_tokens' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')`).Scan(&tables); err != nil {
		t.Fatalf("read privileges: %v", err)
	}
	if tables != 0 {
		t.Fatalf("granete_app holds %d direct privileges on password_reset_tokens, want 0", tables)
	}
}
