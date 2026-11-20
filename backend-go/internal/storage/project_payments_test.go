package storage_test

import (
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1649 on real PostgreSQL under the runtime role (no BYPASSRLS).

func paymentCmd(projectID string, kind domain.ProjectPaymentKind, amount float64, withEvent bool) storage.RecordProjectPaymentCommand {
	id := uuid.NewString()
	actor := rlsUserA
	cmd := storage.RecordProjectPaymentCommand{
		Payment: domain.ProjectPayment{
			ID: id, ProjectID: projectID, Kind: kind, Amount: amount, Currency: "MXN",
			ReceivedAt: time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC), RecordedBy: actor, Reference: "REF-" + id[:4],
		},
		RequestID: "payments-test",
	}
	if withEvent {
		cmd.DepositEvent = &domain.ProjectEvent{
			ID: "evt_dep_" + id[:8], ProjectID: projectID, Type: "deposit_received",
			At: cmd.Payment.ReceivedAt, ByUserID: &actor, Source: domain.ProjectEventSourceWeb,
			Payload: []byte(`{"amount":` + "1" + `,"currency":"MXN"}`),
		}
	}
	return cmd
}

func recordPayment(t *testing.T, fx *quoteLifecycleFixture, cmd storage.RecordProjectPaymentCommand) *domain.ProjectPayment {
	t.Helper()
	var out *domain.ProjectPayment
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		out, err = fx.store.RecordProjectPayment(ctx, cmd)
		return err
	}); err != nil {
		t.Fatalf("record payment: %v", err)
	}
	return out
}

func summaryFor(t *testing.T, fx *quoteLifecycleFixture, actor storage.TenantActor, projectID string) (*domain.ProjectPaymentSummary, error) {
	t.Helper()
	var out *domain.ProjectPaymentSummary
	err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
		var err error
		out, err = fx.store.GetProjectPaymentSummary(ctx, projectID)
		return err
	})
	return out, err
}

func voidPayment(fx *quoteLifecycleFixture, t *testing.T, paymentID, reason string) error {
	actor := rlsUserA
	return fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := fx.store.VoidProjectPayment(ctx, storage.VoidProjectPaymentCommand{
			ProjectID: fx.projectID, PaymentID: paymentID, Reason: reason, VoidedBy: rlsUserA,
			DepositVoidEvent: &domain.ProjectEvent{
				ID: "evt_void_" + uuid.NewString()[:8], ProjectID: fx.projectID, Type: "deposit_voided",
				At: time.Now().UTC(), ByUserID: &actor, Source: domain.ProjectEventSourceWeb,
			},
		})
		return err
	})
}

func TestProjectPayments_LedgerBalanceVoidsAndTenancy(t *testing.T) {
	fx := setupQuoteLifecycleFixture(t)
	ctx := context.Background()

	// 1. Deposit before any accepted quote: paid but no balance yet; the
	// deposit_received lifecycle event is written in the same transaction.
	deposit := recordPayment(t, fx, paymentCmd(fx.projectID, domain.ProjectPaymentKindDeposit, 1000, true))
	var eventCount int
	if err := fx.admin.QueryRow(ctx, `SELECT COUNT(*) FROM project_events WHERE id = $1 AND type = 'deposit_received'`, deposit.ProjectEventID).Scan(&eventCount); err != nil || eventCount != 1 {
		t.Fatalf("deposit event: %d %v", eventCount, err)
	}
	s, err := summaryFor(t, fx, fiActorA(), fx.projectID)
	if err != nil || s.Balance != nil || s.PaidTotal != 1000 || len(s.Payments) != 1 {
		t.Fatalf("summary before acceptance: %+v %v", s, err)
	}

	// 2. Accept the exact Q1 priced by the real engine: balance = frozen sale
	// total − payments.
	q1 := createInitialRevision(t, fx).Revision
	publishRevision(t, fx, q1.ID)
	acceptRevision(t, fx, q1.ID)
	s, err = summaryFor(t, fx, fiActorA(), fx.projectID)
	if err != nil || s.AcceptedQuote == nil || s.AcceptedQuote.QuoteRevisionID != q1.ID || s.AcceptedQuote.SaleTotal <= 0 {
		t.Fatalf("accepted quote missing: %+v %v", s, err)
	}
	sale := s.AcceptedQuote.SaleTotal
	if s.Balance == nil || *s.Balance != round2(sale-1000) {
		t.Fatalf("balance %v want %v", derefFloat(s.Balance), round2(sale-1000))
	}

	// 3. A later payment, then its void (twice): the second void conflicts.
	later := recordPayment(t, fx, paymentCmd(fx.projectID, domain.ProjectPaymentKindPayment, 250.5, false))
	if err := voidPayment(fx, t, later.ID, "cargado dos veces"); err != nil {
		t.Fatalf("void: %v", err)
	}
	if err := voidPayment(fx, t, later.ID, "otra vez"); !errors.Is(err, storage.ErrProjectPaymentAlreadyVoided) {
		t.Fatalf("second void: %v", err)
	}
	s, _ = summaryFor(t, fx, fiActorA(), fx.projectID)
	if *s.Balance != round2(sale-1000) || s.PaidTotal != 1000 {
		t.Fatalf("voided payment must not count: %+v", s)
	}

	// 4. Concurrent voids of the same payment: exactly one wins.
	racer := recordPayment(t, fx, paymentCmd(fx.projectID, domain.ProjectPaymentKindPayment, 10, false))
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = voidPayment(fx, t, racer.ID, "carrera")
		}(i)
	}
	wg.Wait()
	ok, conflicts := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, storage.ErrProjectPaymentAlreadyVoided):
			conflicts++
		default:
			t.Fatalf("race error: %v", err)
		}
	}
	if ok != 1 || conflicts != 1 {
		t.Fatalf("race: ok=%d conflicts=%d", ok, conflicts)
	}

	// 5. Voiding the deposit writes a deposit_voided lifecycle event linked to it.
	if err := voidPayment(fx, t, deposit.ID, "anticipo devuelto"); err != nil {
		t.Fatalf("void deposit: %v", err)
	}
	var linked string
	if err := fx.admin.QueryRow(ctx, `SELECT payload->>'depositEventId' FROM project_events WHERE project_id = $1 AND type = 'deposit_voided'`, fx.projectID).Scan(&linked); err != nil || linked != deposit.ProjectEventID {
		t.Fatalf("deposit_voided link = %q %v", linked, err)
	}

	// 6. Receivables of org A list the project with the same balance.
	var receivables []storage.ProjectReceivable
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		receivables, err = fx.store.ListProjectReceivables(ctx)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range receivables {
		if r.Summary.ProjectID == fx.projectID {
			found = true
			if r.Balance != round2(sale) || r.PaidTotal != 0 {
				t.Fatalf("receivable after voiding everything: %+v", r)
			}
		}
	}
	if !found {
		t.Fatal("accepted project missing from receivables")
	}

	// 7. Tenancy: org B cannot read A's payments; the manufacturing partner of
	// the shared project cannot sell it; the runtime role cannot rewrite money.
	if _, err := summaryFor(t, fx, fiActorB(), fx.projectID); !errors.Is(err, storage.ErrProjectPaymentTargetNotFound) {
		t.Fatalf("org B summary: %v", err)
	}
	if _, err := summaryFor(t, fx, fiActorB(), fiSharedProject); !errors.Is(err, storage.ErrProjectPaymentTargetNotFound) {
		t.Fatalf("manufacturing partner summary: %v", err)
	}
	withRLSActor(t, fx.app, rlsOrgB, rlsUserB, func(tx pgx.Tx) {
		var n int
		if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM project_payments`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Fatalf("org B direct SQL sees %d payments", n)
		}
	})
	for _, stmt := range []string{
		`UPDATE project_payments SET amount = 1`,
		`DELETE FROM project_payments`,
		`DELETE FROM project_payment_voids`,
	} {
		withRLSActor(t, fx.app, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
			_, err := tx.Exec(ctx, stmt)
			if err == nil || !strings.Contains(err.Error(), "permission denied") {
				t.Fatalf("%s under runtime role: %v", stmt, err)
			}
		})
	}

	// 8. A project with payments cannot be deleted.
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		return fx.store.DeleteProject(ctx, fx.projectID)
	})
	if !storage.IsProjectPaymentsDeleteBlock(err) {
		t.Fatalf("delete with payments: %v", err)
	}
}

// Upgrade path: the migration backfill turns valid legacy deposit_received
// events into deposit rows, idempotently, and never invents money from an
// invalid payload.
func TestProjectPayments_BackfillFromLegacyDepositEvents(t *testing.T) {
	fx := setupQuoteLifecycleFixture(t)
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO project_events (id, project_id, type, at, by_user_id, source, payload, organization_id) VALUES
		 ('evt_legacy_ok', $1, 'deposit_received', '2026-10-01T10:00:00Z', NULL, 'web', '{"amount": 1200.456, "currency": "MXN", "reference": " R-1 ", "paymentMethod": "bitcoin"}', $2),
		 ('evt_legacy_bad_amount', $1, 'deposit_received', '2026-10-02T10:00:00Z', NULL, 'web', '{"amount": "mil", "currency": "MXN"}', $2),
		 ('evt_legacy_bad_currency', $1, 'deposit_received', '2026-10-03T10:00:00Z', NULL, 'web', '{"amount": 5, "currency": "mx"}', $2)`,
		fx.projectID, rlsOrgA); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "migration", "000187_project_payments.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	backfill := sql[strings.Index(sql, "INSERT INTO project_payments"):]
	for i := 0; i < 2; i++ { // idempotent
		if _, err := fx.admin.Exec(ctx, backfill); err != nil {
			t.Fatalf("backfill run %d: %v", i, err)
		}
	}
	var count int
	var amount float64
	var reference, origin string
	var method, recordedBy *string
	if err := fx.admin.QueryRow(ctx, `
		SELECT COUNT(*) OVER (), amount::float8, reference, origin, payment_method, recorded_by::text
		FROM project_payments WHERE project_id = $1`, fx.projectID).Scan(&count, &amount, &reference, &origin, &method, &recordedBy); err != nil {
		t.Fatal(err)
	}
	if count != 1 || amount != 1200.46 || reference != "R-1" || origin != "migrated_event" || method != nil || recordedBy != nil {
		t.Fatalf("backfill row: count=%d amount=%v ref=%q origin=%s method=%v by=%v", count, amount, reference, origin, method, recordedBy)
	}
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func derefFloat(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}
