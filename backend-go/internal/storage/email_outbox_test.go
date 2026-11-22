package storage_test

// #1646 durable email outbox: real PostgreSQL, migration authority for the
// schema and fixture rows, the runtime role (granete_app) for every store
// call — the role only reaches the table through SECURITY DEFINER functions.

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/mail"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func emailOutboxDB(t *testing.T) (*pgxpool.Pool, *storage.PostgresStore) {
	t.Helper()
	migrationPool, runtimePool := multiOrgFreshMigrationAndRuntimeDB(t)
	identityApplyThrough(t, migrationPool, 192)
	return migrationPool, &storage.PostgresStore{Pool: runtimePool}
}

func emailOutboxUser(t *testing.T, pool *pgxpool.Pool, email, status string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO users(email,normalized_email,password_hash,name,account_status) VALUES($1,$2,'x','Usuario Outbox',$3) RETURNING id`,
		email, domain.NormalizeEmail(email), status).Scan(&id); err != nil {
		t.Fatalf("create user: %v", err)
	}
	return id
}

func resetComposer(recipient string, issuance storage.PasswordResetIssuance) mail.Message {
	return mail.PasswordResetMessage(recipient, "https://app.granete.test/reset-password?token="+issuance.Token, issuance.ExpiresAt, time.UTC)
}

func outboxCount(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM email_outbox`).Scan(&n); err != nil {
		t.Fatalf("count outbox: %v", err)
	}
	return n
}

func TestEmailOutboxPasswordResetEnqueuesWithTheToken(t *testing.T) {
	ctx := context.Background()
	migrationPool, store := emailOutboxDB(t)
	emailOutboxUser(t, migrationPool, "Ana.Reset@Example.com", "active")
	emailOutboxUser(t, migrationPool, "baja@example.com", "disabled")

	// Unknown and disabled accounts: no token, no message.
	for _, email := range []string{"nadie@example.com", "baja@example.com"} {
		issuance, err := store.RequestPasswordReset(ctx, email, "10.0.0.1", "req-1646-none", resetComposer)
		if err != nil || issuance != nil {
			t.Fatalf("%s: issuance=%v err=%v", email, issuance, err)
		}
	}
	if n := outboxCount(t, migrationPool); n != 0 {
		t.Fatalf("unknown/disabled accounts queued %d messages", n)
	}

	issuance, err := store.RequestPasswordReset(ctx, "ana.reset@example.com", "10.0.0.1", "req-1646-1", resetComposer)
	if err != nil || issuance == nil {
		t.Fatalf("request: issuance=%v err=%v", issuance, err)
	}
	var kind, recipient, body, status string
	var expiresAt time.Time
	if err := migrationPool.QueryRow(ctx, `SELECT kind, recipient, body_text, status, expires_at FROM email_outbox`).
		Scan(&kind, &recipient, &body, &status, &expiresAt); err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	if kind != storage.EmailKindPasswordReset || recipient != "Ana.Reset@Example.com" || status != "pending" {
		t.Fatalf("unexpected row: kind=%s recipient=%s status=%s", kind, recipient, status)
	}
	if !strings.Contains(body, "token="+issuance.Token) {
		t.Fatal("the queued body must carry the freshly minted one-time link")
	}
	if !expiresAt.Equal(issuance.ExpiresAt.Truncate(time.Microsecond)) && expiresAt.Sub(issuance.ExpiresAt).Abs() > time.Millisecond {
		t.Fatalf("message expiry %s must match the token expiry %s", expiresAt, issuance.ExpiresAt)
	}

	// The runtime role has no direct table access.
	var n int
	if err := store.Pool.QueryRow(ctx, `SELECT count(*) FROM email_outbox`).Scan(&n); err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("runtime role must not read email_outbox directly, err=%v", err)
	}
}

func TestPasswordResetSelfRequestWorksUnderRuntimeRoleWithoutEmail(t *testing.T) {
	// Regression (#1646): the anonymous self-service request used to fail
	// under granete_app with an RLS violation on the audit insert, so a
	// known email answered 500 in a real deployment.
	ctx := context.Background()
	migrationPool, store := emailOutboxDB(t)
	userID := emailOutboxUser(t, migrationPool, "sin-email@example.com", "active")
	issuance, err := store.RequestPasswordReset(ctx, "sin-email@example.com", "10.0.0.1", "req-1646-legacy", nil)
	if err != nil || issuance == nil {
		t.Fatalf("issuance=%v err=%v", issuance, err)
	}
	var audits int
	if err := migrationPool.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type='password_reset_issued' AND target_user_id=$1`, userID).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 1 || outboxCount(t, migrationPool) != 0 {
		t.Fatalf("audits=%d outbox=%d, want 1 audit and no message without a composer", audits, outboxCount(t, migrationPool))
	}
}

func TestEmailOutboxEnqueueFailureRollsBackTheToken(t *testing.T) {
	ctx := context.Background()
	migrationPool, store := emailOutboxDB(t)
	userID := emailOutboxUser(t, migrationPool, "rollback@example.com", "active")
	broken := func(recipient string, issuance storage.PasswordResetIssuance) mail.Message {
		msg := resetComposer(recipient, issuance)
		msg.Subject = "inyección\r\nBcc: otro@example.com"
		return msg
	}
	if _, err := store.RequestPasswordReset(ctx, "rollback@example.com", "10.0.0.1", "req-1646-rb", broken); err == nil {
		t.Fatal("an invalid message must fail the request")
	}
	var tokens, audits int
	if err := migrationPool.QueryRow(ctx, `SELECT count(*) FROM password_reset_tokens WHERE user_id=$1`, userID).Scan(&tokens); err != nil {
		t.Fatal(err)
	}
	if err := migrationPool.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type='password_reset_issued' AND target_user_id=$1`, userID).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if tokens != 0 || audits != 0 || outboxCount(t, migrationPool) != 0 {
		t.Fatalf("token, audit and message must commit together: tokens=%d audits=%d outbox=%d", tokens, audits, outboxCount(t, migrationPool))
	}
}

func TestEmailOutboxClaimLeaseRetryAndBodyClearing(t *testing.T) {
	ctx := context.Background()
	migrationPool, store := emailOutboxDB(t)
	enqueue := func(to string) string {
		id, err := store.EnqueueEmail(ctx, storage.OutboundEmail{
			Kind:      storage.EmailKindInvitation,
			Message:   mail.Message{To: to, Subject: "Invitación", Text: "https://app.granete.test/accept-invitation?token=abc", HTML: "<p>hola</p>"},
			ExpiresAt: time.Now().Add(14 * 24 * time.Hour),
		})
		if err != nil {
			t.Fatalf("enqueue: %v", err)
		}
		return id
	}
	sentID := enqueue("uno@example.com")
	retryID := enqueue("dos@example.com")
	finalID := enqueue("tres@example.com")
	expiredID := enqueue("cuatro@example.com")
	if _, err := migrationPool.Exec(ctx, `UPDATE email_outbox SET expires_at = NOW() - interval '1 second' WHERE id=$1`, expiredID); err != nil {
		t.Fatal(err)
	}

	batch, err := store.ClaimEmailBatch(ctx, 10, time.Minute)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if len(batch) != 3 {
		t.Fatalf("claimed %d, want 3 (expired message must not be sent)", len(batch))
	}
	for _, c := range batch {
		if c.Attempts != 1 || c.Message.Text == "" {
			t.Fatalf("claimed row %+v", c)
		}
	}
	// Leased: a second worker sees nothing.
	if again, err := store.ClaimEmailBatch(ctx, 10, time.Minute); err != nil || len(again) != 0 {
		t.Fatalf("leased rows were claimed twice: %d err=%v", len(again), err)
	}

	if err := store.MarkEmailSent(ctx, sentID); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkEmailFailed(ctx, retryID, "smtp connect: error de conexión o TLS", time.Now().Add(-time.Second), false); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkEmailFailed(ctx, finalID, "smtp rcpt: respuesta 550", time.Now(), true); err != nil {
		t.Fatal(err)
	}

	retried, err := store.ClaimEmailBatch(ctx, 10, time.Minute)
	if err != nil || len(retried) != 1 || retried[0].ID != retryID || retried[0].Attempts != 2 {
		t.Fatalf("transient failure must come back with attempts=2, got %+v err=%v", retried, err)
	}

	type row struct {
		status    string
		bodyText  *string
		bodyHTML  *string
		lastError *string
	}
	read := func(id string) row {
		var r row
		if err := migrationPool.QueryRow(ctx, `SELECT status, body_text, body_html, last_error FROM email_outbox WHERE id=$1`, id).
			Scan(&r.status, &r.bodyText, &r.bodyHTML, &r.lastError); err != nil {
			t.Fatal(err)
		}
		return r
	}
	for id, want := range map[string]string{sentID: "sent", finalID: "failed", expiredID: "expired"} {
		r := read(id)
		if r.status != want || r.bodyText != nil || r.bodyHTML != nil {
			t.Fatalf("%s: status=%s body cleared=%t/%t, want %s with no body at rest", id, r.status, r.bodyText == nil, r.bodyHTML == nil, want)
		}
	}
	if r := read(finalID); r.lastError == nil || *r.lastError != "smtp rcpt: respuesta 550" {
		t.Fatalf("final failure must keep the sanitized reason, got %v", r.lastError)
	}
	if r := read(retryID); r.status != "pending" || r.bodyText == nil {
		t.Fatalf("a retrying message keeps its body: %+v", r)
	}
	// A sent message cannot be re-opened by a late failure report.
	if err := store.MarkEmailFailed(ctx, sentID, "late", time.Now(), false); err != nil {
		t.Fatal(err)
	}
	if r := read(sentID); r.status != "sent" {
		t.Fatalf("late failure re-opened a sent message: %s", r.status)
	}
}
