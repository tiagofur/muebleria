package storage_test

// #1650 quote deliveries on real PostgreSQL under the runtime role: the
// email path queues the sealed outbox message in the same transaction and
// the worker's SMTP acceptance is the real send moment (quote_sent + status
// + audit, atomically); WhatsApp is sent only on explicit confirmation; a
// project already won never rolls back to "sent"; tenant isolation holds.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/mail"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func quoteDeliveryFixture(t *testing.T) (*quoteLifecycleFixture, string) {
	t.Helper()
	fx := setupQuoteLifecycleFixture(t)
	cipher, err := mail.NewCipher("quote-delivery-test-secret")
	if err != nil {
		t.Fatal(err)
	}
	fx.store.EmailCipher = cipher
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `
		UPDATE customers SET email = 'cliente@taller.test', phone = '+52 55 1234 5678'
		 WHERE id = (SELECT customer_id FROM projects WHERE id = $1)`, fx.projectID); err != nil {
		t.Fatalf("seed customer contact: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `UPDATE projects SET commercial_status = 'draft' WHERE id = $1`, fx.projectID); err != nil {
		t.Fatal(err)
	}
	initial := createInitialRevision(t, fx)
	revisionID := initial.Revision.ID
	publishRevision(t, fx, revisionID)
	return fx, revisionID
}

func requestQuoteEmail(t *testing.T, fx *quoteLifecycleFixture, revisionID string, pdf []byte) *storage.QuoteDelivery {
	t.Helper()
	var d *storage.QuoteDelivery
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		qc, err := fx.store.GetQuoteDeliveryContext(ctx, fx.projectID, revisionID)
		if err != nil {
			return err
		}
		if !storage.QuoteDeliverySendable(qc.RevisionStatus) || qc.CustomerEmail != "cliente@taller.test" || !qc.HasSnapshot {
			t.Fatalf("context: %+v", qc)
		}
		sum := sha256.Sum256(pdf)
		msg := mail.QuoteMessage(qc.CustomerEmail, qc.CustomerName, qc.OrganizationName, qc.ProjectName, qc.RevisionNumber, "",
			mail.Attachment{FileName: "Cotizacion-Q1-listado.pdf", ContentType: "application/pdf", Data: pdf})
		d, err = fx.store.CreateQuoteDelivery(ctx, storage.CreateQuoteDeliveryCommand{
			Delivery: storage.QuoteDelivery{
				ProjectID: fx.projectID, QuoteRevisionID: revisionID, RevisionNumber: qc.RevisionNumber,
				Channel: "email", Recipient: qc.CustomerEmail, Variant: "detailed",
				PDFSHA256: hex.EncodeToString(sum[:]), PDFBytes: len(pdf), PDFFileName: "Cotizacion-Q1-listado.pdf",
				RequestedBy: rlsUserA,
			},
			Email: &msg, RequestID: "req-1650",
		})
		return err
	})
	if err != nil {
		t.Fatalf("request quote email: %v", err)
	}
	return d
}

func countRows(t *testing.T, fx *quoteLifecycleFixture, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := fx.admin.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func TestQuoteEmailDeliveryIsSentOnlyAtSMTPAcceptance(t *testing.T) {
	ctx := context.Background()
	fx, revisionID := quoteDeliveryFixture(t)
	pdf := []byte("%PDF-1.7\n" + strings.Repeat("cotizacion ", 300))
	d := requestQuoteEmail(t, fx, revisionID, pdf)
	if d.Status != "queued" || d.SentAt != nil {
		t.Fatalf("queued is not sent: %+v", d)
	}
	// Queued: no commercial fact yet (no invented send time).
	if n := countRows(t, fx, `SELECT count(*) FROM project_events WHERE project_id=$1 AND type='quote_sent'`, fx.projectID); n != 0 {
		t.Fatalf("quote_sent recorded before the email left: %d", n)
	}
	if n := countRows(t, fx, `SELECT count(*) FROM email_outbox WHERE kind='quote' AND ref=$1 AND status='pending'`, d.ID); n != 1 {
		t.Fatalf("outbox message missing: %d", n)
	}

	// The worker claims it: the exact PDF bytes come back from the sealed payload.
	batch, err := fx.store.ClaimEmailBatch(ctx, 5, time.Minute)
	if err != nil || len(batch) != 1 || batch[0].OpenErr != nil {
		t.Fatalf("claim: %+v err=%v", batch, err)
	}
	if got := batch[0].Message.Attachments; len(got) != 1 || string(got[0].Data) != string(pdf) {
		t.Fatal("the claimed message must carry the exact PDF")
	}
	if held, err := fx.store.MarkEmailSent(ctx, batch[0].ID, batch[0].LeaseToken); err != nil || !held {
		t.Fatalf("mark sent: held=%t err=%v", held, err)
	}

	var status, eventID string
	var sentAt *time.Time
	if err := fx.admin.QueryRow(ctx, `SELECT status, sent_at, COALESCE(project_event_id,'') FROM quote_deliveries WHERE id=$1`, d.ID).Scan(&status, &sentAt, &eventID); err != nil {
		t.Fatal(err)
	}
	if status != "sent" || sentAt == nil || eventID == "" {
		t.Fatalf("delivery after SMTP acceptance: status=%s sentAt=%v event=%q", status, sentAt, eventID)
	}
	var payloadSHA, commercial string
	if err := fx.admin.QueryRow(ctx, `SELECT e.payload->>'pdfSha256', p.commercial_status FROM project_events e JOIN projects p ON p.id = e.project_id WHERE e.id=$1`, eventID).Scan(&payloadSHA, &commercial); err != nil {
		t.Fatal(err)
	}
	if payloadSHA != d.PDFSHA256 || commercial != "sent" {
		t.Fatalf("quote_sent must pin the exact PDF and move draft→sent: sha=%s status=%s", payloadSHA, commercial)
	}
	if n := countRows(t, fx, `SELECT count(*) FROM security_audit_events WHERE event_type IN ('quote_delivery_requested','quote_delivery_sent') AND details->>'delivery_id'=$1`, d.ID); n != 2 {
		t.Fatalf("audit rows = %d, want requested + sent", n)
	}
	// Listed back to the tenant with the real send time.
	var listed []storage.QuoteDelivery
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var e error
		listed, e = fx.store.ListQuoteDeliveries(ctx, fx.projectID)
		return e
	}); err != nil || len(listed) != 1 || listed[0].Status != "sent" || listed[0].SentAt == nil {
		t.Fatalf("list: %+v err=%v", listed, err)
	}
}

func TestQuoteEmailDeliveryFinalFailureIsRecorded(t *testing.T) {
	ctx := context.Background()
	fx, revisionID := quoteDeliveryFixture(t)
	d := requestQuoteEmail(t, fx, revisionID, []byte("%PDF-1.7\nx"))
	batch, err := fx.store.ClaimEmailBatch(ctx, 5, time.Minute)
	if err != nil || len(batch) != 1 {
		t.Fatalf("claim: %v", err)
	}
	if held, err := fx.store.MarkEmailFailed(ctx, batch[0].ID, batch[0].LeaseToken, "smtp rcpt: respuesta 550", time.Now(), true); err != nil || !held {
		t.Fatalf("mark failed: %v", err)
	}
	var status, reason string
	if err := fx.admin.QueryRow(ctx, `SELECT status, failure_reason FROM quote_deliveries WHERE id=$1`, d.ID).Scan(&status, &reason); err != nil {
		t.Fatal(err)
	}
	if status != "failed" || reason != "smtp rcpt: respuesta 550" {
		t.Fatalf("final failure: status=%s reason=%s", status, reason)
	}
	if n := countRows(t, fx, `SELECT count(*) FROM project_events WHERE project_id=$1 AND type='quote_sent'`, fx.projectID); n != 0 {
		t.Fatal("a failed email must not record quote_sent")
	}
	// Expiry closes a pending quote email as failed as well.
	d2 := requestQuoteEmail(t, fx, revisionID, []byte("%PDF-1.7\ny"))
	if _, err := fx.admin.Exec(ctx, `UPDATE email_outbox SET expires_at = NOW() - interval '1 second' WHERE ref=$1`, d2.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.store.ClaimEmailBatch(ctx, 5, time.Minute); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, fx, `SELECT count(*) FROM quote_deliveries WHERE id=$1 AND status='failed'`, d2.ID); n != 1 {
		t.Fatal("an expired quote email must close its delivery as failed")
	}
}

func TestQuoteWhatsAppDeliveryNeedsConfirmationAndNeverRollsBackAWin(t *testing.T) {
	ctx := context.Background()
	fx, revisionID := quoteDeliveryFixture(t)
	prepare := func() *storage.QuoteDelivery {
		var d *storage.QuoteDelivery
		if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
			var e error
			d, e = fx.store.CreateQuoteDelivery(ctx, storage.CreateQuoteDeliveryCommand{Delivery: storage.QuoteDelivery{
				ProjectID: fx.projectID, QuoteRevisionID: revisionID, RevisionNumber: 1,
				Channel: "whatsapp", Recipient: "+525512345678", RequestedBy: rlsUserA,
			}})
			return e
		}); err != nil {
			t.Fatalf("prepare: %v", err)
		}
		return d
	}
	d := prepare()
	if d.Status != "prepared" || d.SentAt != nil {
		t.Fatalf("prepared is not sent: %+v", d)
	}
	// Another organization cannot confirm it.
	if err := fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, e := fx.store.ConfirmQuoteDelivery(ctx, fx.projectID, d.ID)
		return e
	}); err != storage.ErrQuoteDeliveryNotConfirmable {
		t.Fatalf("cross-tenant confirm must be refused, got %v", err)
	}
	// The runtime role cannot flip the status directly either.
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, e := fx.app.Exec(ctx, `UPDATE quote_deliveries SET status='confirmed' WHERE id=$1`, d.ID)
		return e
	}); err == nil {
		t.Fatal("direct UPDATE must be denied to the runtime role")
	}
	var confirmed *storage.QuoteDelivery
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var e error
		confirmed, e = fx.store.ConfirmQuoteDelivery(ctx, fx.projectID, d.ID)
		return e
	}); err != nil || confirmed.Status != "confirmed" || confirmed.SentAt == nil {
		t.Fatalf("confirm: %+v err=%v", confirmed, err)
	}
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, e := fx.store.ConfirmQuoteDelivery(ctx, fx.projectID, d.ID)
		return e
	}); err != storage.ErrQuoteDeliveryNotConfirmable {
		t.Fatalf("second confirm must be refused, got %v", err)
	}
	if n := countRows(t, fx, `SELECT count(*) FROM project_events WHERE project_id=$1 AND type='quote_sent'`, fx.projectID); n != 1 {
		t.Fatalf("quote_sent events = %d", n)
	}

	// After the deal is won, a re-send is recorded but never rolls the
	// commercial status back to "sent".
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO project_events (id, project_id, type, at, source, organization_id)
		VALUES ('won-1650', $1, 'quote_won', NOW(), 'web', '`+rlsOrgA+`')`, fx.projectID); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, `UPDATE projects SET commercial_status='won' WHERE id=$1`, fx.projectID); err != nil {
		t.Fatal(err)
	}
	again := prepare()
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, e := fx.store.ConfirmQuoteDelivery(ctx, fx.projectID, again.ID)
		return e
	}); err != nil {
		t.Fatal(err)
	}
	var commercial string
	if err := fx.admin.QueryRow(ctx, `SELECT commercial_status FROM projects WHERE id=$1`, fx.projectID).Scan(&commercial); err != nil {
		t.Fatal(err)
	}
	if commercial != "won" || countRows(t, fx, `SELECT count(*) FROM project_events WHERE project_id=$1 AND type='quote_sent'`, fx.projectID) != 1 {
		t.Fatalf("a won project must stay won: status=%s", commercial)
	}
	if n := countRows(t, fx, `SELECT count(*) FROM quote_deliveries WHERE id=$1 AND status='confirmed'`, again.ID); n != 1 {
		t.Fatal("the re-send itself must still be recorded as confirmed")
	}
}

func TestQuoteDeliveryTenantIsolationAndSendability(t *testing.T) {
	fx, revisionID := quoteDeliveryFixture(t)
	// Org B cannot even load the context of org A's quote.
	if err := fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, e := fx.store.GetQuoteDeliveryContext(ctx, fx.projectID, revisionID)
		return e
	}); err != storage.ErrQuoteDeliveryTargetNotFound {
		t.Fatalf("cross-tenant context must be not found, got %v", err)
	}
	d := requestQuoteEmail(t, fx, revisionID, []byte("%PDF-1.7\nz"))
	var listed []storage.QuoteDelivery
	if err := fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		var e error
		listed, e = fx.store.ListQuoteDeliveries(ctx, fx.projectID)
		return e
	}); err != nil || len(listed) != 0 {
		t.Fatalf("org B must not list org A deliveries: %+v err=%v", listed, err)
	}
	if n := countRows(t, fx, `SELECT count(*) FROM rls_policy_inventory WHERE table_name='quote_deliveries'`); n != 1 {
		t.Fatal("inventory row missing")
	}
	if !storage.QuoteDeliverySendable("published") || !storage.QuoteDeliverySendable("accepted") ||
		storage.QuoteDeliverySendable("draft") || storage.QuoteDeliverySendable("superseded") {
		t.Fatal("sendability rule")
	}
	_ = d
}

func TestQuoteDeliveriesMigrationDownAndUp(t *testing.T) {
	ctx := context.Background()
	migrationPool, runtimePool := multiOrgFreshMigrationAndRuntimeDB(t)
	identityApplyThrough(t, migrationPool, 193)
	cipher, _ := mail.NewCipher("down-up-secret")
	store := &storage.PostgresStore{Pool: runtimePool, EmailCipher: cipher}
	if _, err := store.EnqueueEmail(ctx, storage.OutboundEmail{Kind: storage.EmailKindQuote, Ref: "16500000-0000-4000-8000-0000000000aa",
		Message: mail.Message{To: "a@b.test", Subject: "s", Text: "t"}, ExpiresAt: time.Now().Add(time.Hour)}); err != nil {
		t.Fatalf("quote kind enqueue: %v", err)
	}
	applyMigrationFile(t, migrationPool, "000193_quote_deliveries.down.sql")
	var tables, fns, quoteRows int
	_ = migrationPool.QueryRow(ctx, `SELECT count(*) FROM pg_tables WHERE tablename='quote_deliveries'`).Scan(&tables)
	_ = migrationPool.QueryRow(ctx, `SELECT count(*) FROM pg_proc WHERE proname IN ('record_quote_delivery_outcome','confirm_quote_delivery')`).Scan(&fns)
	_ = migrationPool.QueryRow(ctx, `SELECT count(*) FROM email_outbox WHERE kind='quote'`).Scan(&quoteRows)
	if tables != 0 || fns != 0 || quoteRows != 0 {
		t.Fatalf("down left tables=%d functions=%d quote rows=%d", tables, fns, quoteRows)
	}
	// The restored 000192 outbox still works end to end.
	if _, err := store.EnqueueEmail(ctx, storage.OutboundEmail{Kind: storage.EmailKindInvitation, Ref: "inv-x",
		Message: mail.Message{To: "a@b.test", Subject: "s", Text: "t"}, ExpiresAt: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	batch, err := store.ClaimEmailBatch(ctx, 5, time.Minute)
	if err != nil || len(batch) != 1 {
		t.Fatalf("claim after down: %d err=%v", len(batch), err)
	}
	if held, err := store.MarkEmailSent(ctx, batch[0].ID, batch[0].LeaseToken); err != nil || !held {
		t.Fatalf("mark after down: %v", err)
	}
	applyMigrationFile(t, migrationPool, "000193_quote_deliveries.up.sql")
	if _, err := store.EnqueueEmail(ctx, storage.OutboundEmail{Kind: storage.EmailKindQuote, Ref: "16500000-0000-4000-8000-0000000000bb",
		Message: mail.Message{To: "a@b.test", Subject: "s", Text: "t"}, ExpiresAt: time.Now().Add(time.Hour)}); err != nil {
		t.Fatalf("re-applied up: %v", err)
	}
}
