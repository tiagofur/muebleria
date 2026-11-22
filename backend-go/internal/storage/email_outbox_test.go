package storage_test

// #1646 durable email outbox: real PostgreSQL, migration authority for the
// schema and fixture readback, the runtime role (granete_app) for every store
// call — the role only reaches the table through SECURITY DEFINER functions,
// and the message is stored only as an AEAD-sealed payload.

import (
	"context"
	"sort"
	"strings"
	"sync"
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
	cipher, err := mail.NewCipher("email-outbox-test-secret")
	if err != nil {
		t.Fatal(err)
	}
	return migrationPool, &storage.PostgresStore{Pool: runtimePool, EmailCipher: cipher}
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

func outboxCount(t *testing.T, pool *pgxpool.Pool, where string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM email_outbox `+where, args...).Scan(&n); err != nil {
		t.Fatalf("count outbox: %v", err)
	}
	return n
}

func invitationEmail(to, ref string) storage.OutboundEmail {
	return storage.OutboundEmail{
		Kind:      storage.EmailKindInvitation,
		Ref:       ref,
		Message:   mail.Message{To: to, Subject: "Invitación", Text: "https://app.granete.test/accept-invitation?token=tok-" + ref, HTML: "<p>hola</p>"},
		ExpiresAt: time.Now().Add(14 * 24 * time.Hour),
	}
}

func TestEmailOutboxPasswordResetEnqueuesSealedWithTheToken(t *testing.T) {
	ctx := context.Background()
	migrationPool, store := emailOutboxDB(t)
	userID := emailOutboxUser(t, migrationPool, "Ana.Reset@Example.com", "active")
	emailOutboxUser(t, migrationPool, "baja@example.com", "disabled")

	// Unknown and disabled accounts: no token, no message.
	for _, email := range []string{"nadie@example.com", "baja@example.com"} {
		issuance, err := store.RequestPasswordReset(ctx, email, "10.0.0.1", "req-1646-none", resetComposer)
		if err != nil || issuance != nil {
			t.Fatalf("%s: issuance=%v err=%v", email, issuance, err)
		}
	}
	if n := outboxCount(t, migrationPool, ""); n != 0 {
		t.Fatalf("unknown/disabled accounts queued %d messages", n)
	}

	issuance, err := store.RequestPasswordReset(ctx, "ana.reset@example.com", "10.0.0.1", "req-1646-1", resetComposer)
	if err != nil || issuance == nil {
		t.Fatalf("request: issuance=%v err=%v", issuance, err)
	}
	var kind, ref, payload, status string
	var expiresAt time.Time
	if err := migrationPool.QueryRow(ctx, `SELECT kind, ref, payload, status, expires_at FROM email_outbox`).
		Scan(&kind, &ref, &payload, &status, &expiresAt); err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	if kind != storage.EmailKindPasswordReset || ref != userID || status != "pending" {
		t.Fatalf("unexpected row: kind=%s ref=%s status=%s", kind, ref, status)
	}
	// At rest: neither the link, the token nor the address is readable.
	if !strings.HasPrefix(payload, "gcm1:") || strings.Contains(payload, issuance.Token) || strings.Contains(strings.ToLower(payload), "ana.reset") {
		t.Fatal("the stored payload must be sealed: no token or recipient in clear")
	}
	if expiresAt.Sub(issuance.ExpiresAt).Abs() > time.Millisecond {
		t.Fatalf("message expiry %s must match the token expiry %s", expiresAt, issuance.ExpiresAt)
	}

	// The worker opens it back: stored address, fresh one-time link.
	batch, err := store.ClaimEmailBatch(ctx, 10, time.Minute)
	if err != nil || len(batch) != 1 || batch[0].OpenErr != nil {
		t.Fatalf("claim: %+v err=%v", batch, err)
	}
	if batch[0].Message.To != "Ana.Reset@Example.com" || !strings.Contains(batch[0].Message.Text, "token="+issuance.Token) {
		t.Fatalf("opened message: to=%q", batch[0].Message.To)
	}

	// A store holding another key cannot open it (fails closed, not garbage).
	otherCipher, _ := mail.NewCipher("another-secret")
	other := &storage.PostgresStore{Pool: store.Pool, EmailCipher: otherCipher}
	if _, err := migrationPool.Exec(ctx, `UPDATE email_outbox SET next_attempt_at = NOW() - interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	reclaimed, err := other.ClaimEmailBatch(ctx, 10, time.Minute)
	if err != nil || len(reclaimed) != 1 || reclaimed[0].OpenErr == nil {
		t.Fatalf("payload under another key must surface OpenErr: %+v err=%v", reclaimed, err)
	}

	// The runtime role has no direct table access.
	var n int
	if err := store.Pool.QueryRow(ctx, `SELECT count(*) FROM email_outbox`).Scan(&n); err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("runtime role must not read email_outbox directly, err=%v", err)
	}
	// The functions refuse an unsealed payload even when called directly.
	if _, err := store.Pool.Exec(ctx, `SELECT enqueue_email_outbox('invitation', NULL, 'x', 'plain text link', NOW() + interval '1 hour')`); err == nil {
		t.Fatal("enqueue must refuse an unsealed payload")
	}
	// Inventory row present.
	var classification string
	if err := migrationPool.QueryRow(ctx, `SELECT classification FROM rls_policy_inventory WHERE table_name='email_outbox'`).Scan(&classification); err != nil || classification != "platform-global" {
		t.Fatalf("inventory classification=%q err=%v", classification, err)
	}
}

func TestEmailOutboxPasswordResetCooldownAndSupersede(t *testing.T) {
	ctx := context.Background()
	migrationPool, store := emailOutboxDB(t)
	userID := emailOutboxUser(t, migrationPool, "cooldown@example.com", "active")

	first, err := store.RequestPasswordReset(ctx, "cooldown@example.com", "10.0.0.1", "req-cd-1", resetComposer)
	if err != nil || first == nil {
		t.Fatalf("first: %v %v", first, err)
	}
	// Inside the cooldown: no token, no mail (no inbox flooding).
	again, err := store.RequestPasswordReset(ctx, "cooldown@example.com", "10.0.0.2", "req-cd-2", resetComposer)
	if err != nil || again != nil {
		t.Fatalf("repeat inside the cooldown must mint nothing: %v %v", again, err)
	}
	var tokens int
	if err := migrationPool.QueryRow(ctx, `SELECT count(*) FROM password_reset_tokens WHERE user_id=$1`, userID).Scan(&tokens); err != nil {
		t.Fatal(err)
	}
	if tokens != 1 || outboxCount(t, migrationPool, "") != 1 {
		t.Fatalf("cooldown: tokens=%d outbox=%d", tokens, outboxCount(t, migrationPool, ""))
	}
	// After the window, a new request rotates the token and supersedes the
	// pending message (its link is dead now).
	if _, err := migrationPool.Exec(ctx, `UPDATE email_outbox SET created_at = NOW() - interval '10 minutes'`); err != nil {
		t.Fatal(err)
	}
	second, err := store.RequestPasswordReset(ctx, "cooldown@example.com", "10.0.0.1", "req-cd-3", resetComposer)
	if err != nil || second == nil {
		t.Fatalf("after cooldown: %v %v", second, err)
	}
	if outboxCount(t, migrationPool, "WHERE status='pending'") != 1 || outboxCount(t, migrationPool, "WHERE status='cancelled' AND payload IS NULL") != 1 {
		t.Fatal("the older pending reset message must be cancelled with its payload cleared")
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
	if audits != 1 || outboxCount(t, migrationPool, "") != 0 {
		t.Fatalf("audits=%d outbox=%d, want 1 audit and no message without a composer", audits, outboxCount(t, migrationPool, ""))
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
	if tokens != 0 || audits != 0 || outboxCount(t, migrationPool, "") != 0 {
		t.Fatalf("token, audit and message must commit together: tokens=%d audits=%d outbox=%d", tokens, audits, outboxCount(t, migrationPool, ""))
	}
}

func TestEmailOutboxClaimLeaseRetryCancelAndPayloadClearing(t *testing.T) {
	ctx := context.Background()
	migrationPool, store := emailOutboxDB(t)
	enqueue := func(to, ref string) string {
		id, err := store.EnqueueEmail(ctx, invitationEmail(to, ref))
		if err != nil {
			t.Fatalf("enqueue: %v", err)
		}
		return id
	}
	sentID := enqueue("uno@example.com", "inv-1")
	retryID := enqueue("dos@example.com", "inv-2")
	finalID := enqueue("tres@example.com", "inv-3")
	expiredID := enqueue("cuatro@example.com", "inv-4")
	cancelledID := enqueue("cinco@example.com", "inv-5")
	if _, err := migrationPool.Exec(ctx, `UPDATE email_outbox SET expires_at = NOW() - interval '1 second' WHERE id=$1`, expiredID); err != nil {
		t.Fatal(err)
	}
	// Revoking invitation inv-5 cancels its pending message.
	if n, err := store.CancelEmails(ctx, storage.EmailKindInvitation, "inv-5"); err != nil || n != 1 {
		t.Fatalf("cancel: n=%d err=%v", n, err)
	}

	batch, err := store.ClaimEmailBatch(ctx, 10, time.Minute)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if len(batch) != 3 {
		t.Fatalf("claimed %d, want 3 (expired and cancelled messages must not be sent)", len(batch))
	}
	leases := map[string]string{}
	for _, c := range batch {
		if c.Attempts != 1 || c.Message.Text == "" || c.LeaseToken == "" || c.OpenErr != nil {
			t.Fatalf("claimed row %+v", c)
		}
		leases[c.ID] = c.LeaseToken
	}
	if again, err := store.ClaimEmailBatch(ctx, 10, time.Minute); err != nil || len(again) != 0 {
		t.Fatalf("leased rows were claimed twice: %d err=%v", len(again), err)
	}

	// A stale lease holder cannot record anything.
	if held, err := store.MarkEmailSent(ctx, sentID, "00000000-0000-4000-8000-000000000000"); err != nil || held {
		t.Fatalf("a foreign lease token must not mark sent: held=%t err=%v", held, err)
	}
	mustHold := func(held bool, err error) {
		t.Helper()
		if err != nil || !held {
			t.Fatalf("mark with the current lease: held=%t err=%v", held, err)
		}
	}
	mustHold(store.MarkEmailSent(ctx, sentID, leases[sentID]))
	mustHold(store.MarkEmailFailed(ctx, retryID, leases[retryID], "smtp connect: error de conexión o TLS", time.Now().Add(-time.Second), false))
	mustHold(store.MarkEmailFailed(ctx, finalID, leases[finalID], "smtp rcpt: respuesta 550", time.Now(), true))

	retried, err := store.ClaimEmailBatch(ctx, 10, time.Minute)
	if err != nil || len(retried) != 1 || retried[0].ID != retryID || retried[0].Attempts != 2 {
		t.Fatalf("transient failure must come back with attempts=2, got %+v err=%v", retried, err)
	}
	// The previous holder's token is dead after the re-claim.
	if held, err := store.MarkEmailFailed(ctx, retryID, leases[retryID], "late", time.Now(), true); err != nil || held {
		t.Fatalf("superseded lease must not overwrite the new holder: held=%t err=%v", held, err)
	}

	type row struct {
		status    string
		payload   *string
		lastError *string
	}
	read := func(id string) row {
		var r row
		if err := migrationPool.QueryRow(ctx, `SELECT status, payload, last_error FROM email_outbox WHERE id=$1`, id).
			Scan(&r.status, &r.payload, &r.lastError); err != nil {
			t.Fatal(err)
		}
		return r
	}
	for id, want := range map[string]string{sentID: "sent", finalID: "failed", expiredID: "expired", cancelledID: "cancelled"} {
		if r := read(id); r.status != want || r.payload != nil {
			t.Fatalf("%s: status=%s payload cleared=%t, want %s with nothing at rest", id, r.status, r.payload == nil, want)
		}
	}
	if r := read(finalID); r.lastError == nil || *r.lastError != "smtp rcpt: respuesta 550" {
		t.Fatalf("final failure must keep the sanitized reason, got %v", r.lastError)
	}
	if r := read(retryID); r.status != "pending" || r.payload == nil {
		t.Fatalf("a retrying message keeps its payload: %+v", r)
	}
}

func TestEmailOutboxConcurrentClaimersAreDisjoint(t *testing.T) {
	ctx := context.Background()
	_, store := emailOutboxDB(t)
	const total = 40
	for i := 0; i < total; i++ {
		ref := "race-" + string(rune('a'+i%26)) + string(rune('a'+i/26))
		if _, err := store.EnqueueEmail(ctx, invitationEmail("race@example.com", ref)); err != nil {
			t.Fatal(err)
		}
	}
	const workers = 4
	var (
		mu      sync.Mutex
		claimed []string
		wg      sync.WaitGroup
		start   = make(chan struct{})
	)
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for {
				batch, err := store.ClaimEmailBatch(ctx, 3, time.Minute)
				if err != nil {
					t.Errorf("claim: %v", err)
					return
				}
				if len(batch) == 0 {
					return
				}
				mu.Lock()
				for _, c := range batch {
					claimed = append(claimed, c.ID)
				}
				mu.Unlock()
			}
		}()
	}
	close(start)
	wg.Wait()
	sort.Strings(claimed)
	for i := 1; i < len(claimed); i++ {
		if claimed[i] == claimed[i-1] {
			t.Fatalf("message %s was claimed by two workers", claimed[i])
		}
	}
	if len(claimed) != total {
		t.Fatalf("claimed %d of %d messages", len(claimed), total)
	}
}

func TestEmailOutboxMigrationDownAndUp(t *testing.T) {
	ctx := context.Background()
	migrationPool, store := emailOutboxDB(t)
	if _, err := store.EnqueueEmail(ctx, invitationEmail("down@example.com", "inv-down")); err != nil {
		t.Fatal(err)
	}
	applyMigrationFile(t, migrationPool, "000192_email_outbox.down.sql")
	var tables, functions, inventory int
	if err := migrationPool.QueryRow(ctx, `SELECT count(*) FROM pg_tables WHERE tablename='email_outbox'`).Scan(&tables); err != nil {
		t.Fatal(err)
	}
	if err := migrationPool.QueryRow(ctx, `SELECT count(*) FROM pg_proc WHERE proname LIKE '%email_outbox%'`).Scan(&functions); err != nil {
		t.Fatal(err)
	}
	if err := migrationPool.QueryRow(ctx, `SELECT count(*) FROM rls_policy_inventory WHERE table_name='email_outbox'`).Scan(&inventory); err != nil {
		t.Fatal(err)
	}
	if tables != 0 || functions != 0 || inventory != 0 {
		t.Fatalf("down left tables=%d functions=%d inventory=%d", tables, functions, inventory)
	}
	applyMigrationFile(t, migrationPool, "000192_email_outbox.up.sql")
	if _, err := store.EnqueueEmail(ctx, invitationEmail("up@example.com", "inv-up")); err != nil {
		t.Fatalf("re-applied up must work under the runtime role: %v", err)
	}
}
