package storage_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1648 on real PostgreSQL under the runtime role (no BYPASSRLS): the
// committed delivery date is written only by the command, with event + audit
// in the same transaction; changes need a reason; another organization cannot
// reach the project; the aggregate PUT never overwrites the commitment.
func TestCommitProjectDelivery_AtomicAuditedTenantScoped(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO projects (id, name, customer_id, status, commercial_status, organization_id, sales_organization_id, manufacturing_organization_id)
		VALUES ('`+fiProjectAOnly+`', 'Org A pedido', '30000000-0000-0000-0000-00000000000a', 'accepted', 'won',
			'`+rlsOrgA+`', '`+rlsOrgA+`', '`+rlsOrgA+`')`); err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	commit := func(actor storage.TenantActor, eventID, date, reason string) (*storage.CommitProjectDeliveryResult, error) {
		var out *storage.CommitProjectDeliveryResult
		err := fiTx(t, fx.store, actor, func(txCtx context.Context) error {
			var err error
			out, err = fx.store.CommitProjectDelivery(txCtx, storage.CommitProjectDeliveryCommand{
				ProjectID: fiProjectAOnly, Date: date, Reason: reason, EventID: eventID,
				ActorUserID: actor.UserID, Source: domain.ProjectEventSourceWeb, At: at, RequestID: "req-1648",
			})
			return err
		})
		return out, err
	}
	column := func() string {
		var d *time.Time
		if err := fx.admin.QueryRow(ctx, `SELECT committed_delivery_date FROM projects WHERE id = $1`, fiProjectAOnly).Scan(&d); err != nil {
			t.Fatal(err)
		}
		if d == nil {
			return ""
		}
		return d.Format("2006-01-02")
	}
	countEvents := func(id string) int {
		var n int
		if err := fx.admin.QueryRow(ctx, `SELECT COUNT(*) FROM project_events WHERE id = $1`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// 1. First commitment: column + delivery_date_committed + audit.
	res, err := commit(fiActorA(), "evt_1648_first", "2026-12-15", "")
	if err != nil {
		t.Fatalf("first commitment: %v", err)
	}
	if res.CommittedDeliveryDate != "2026-12-15" || res.PreviousDate != nil || res.Event.Type != "delivery_date_committed" {
		t.Fatalf("result: %+v", res)
	}
	if column() != "2026-12-15" {
		t.Fatalf("column = %q", column())
	}
	assertCommercialAudit(t, fx, "project_delivery_date_committed", "evt_1648_first", 1)

	// 2. Change without reason: typed field error, nothing written.
	var fe *domain.DepositFieldError
	if _, err := commit(fiActorA(), "evt_1648_noreason", "2026-12-20", " "); !errors.As(err, &fe) || fe.Field != "reason" {
		t.Fatalf("change without reason: %v", err)
	}
	if column() != "2026-12-15" || countEvents("evt_1648_noreason") != 0 {
		t.Fatal("rejected change leaked a write")
	}

	// 3. Change with reason: delivery_date_changed carries previous + reason.
	res, err = commit(fiActorA(), "evt_1648_change", "2026-12-22", "falta de placa")
	if err != nil {
		t.Fatalf("change: %v", err)
	}
	if res.Event.Type != "delivery_date_changed" || res.PreviousDate == nil || *res.PreviousDate != "2026-12-15" || column() != "2026-12-22" {
		t.Fatalf("change result: %+v column=%q", res, column())
	}
	var payloadReason, payloadPrev string
	if err := fx.admin.QueryRow(ctx, `SELECT payload->>'reason', payload->>'previousDate' FROM project_events WHERE id = 'evt_1648_change'`).Scan(&payloadReason, &payloadPrev); err != nil ||
		payloadReason != "falta de placa" || payloadPrev != "2026-12-15" {
		t.Fatalf("change payload: %q %q %v", payloadReason, payloadPrev, err)
	}
	assertCommercialAudit(t, fx, "project_delivery_date_committed", "evt_1648_change", 1)

	// 4. Org B: uniform not-found, nothing written.
	if _, err := commit(fiActorB(), "evt_1648_foreign", "2027-01-10", "x"); !errors.Is(err, storage.ErrProjectCommercialTargetNotFound) {
		t.Fatalf("foreign org: %v", err)
	}
	if column() != "2026-12-22" || countEvents("evt_1648_foreign") != 0 {
		t.Fatal("foreign command leaked a write")
	}

	// 5. Read model: detail and list expose the date; the aggregate PUT with a
	// stale/absent value never overwrites it.
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		p, err := fx.store.GetProjectByID(txCtx, fiProjectAOnly)
		if err != nil {
			return err
		}
		if p.CommittedDeliveryDate == nil || *p.CommittedDeliveryDate != "2026-12-22" {
			t.Fatalf("detail committed date = %v", p.CommittedDeliveryDate)
		}
		list, err := fx.store.ListProjects(txCtx)
		if err != nil {
			return err
		}
		found := false
		for _, lp := range list {
			if lp.ID == fiProjectAOnly {
				found = lp.CommittedDeliveryDate != nil && *lp.CommittedDeliveryDate == "2026-12-22"
			}
		}
		if !found {
			t.Fatal("list must carry the committed date")
		}
		stale := "2020-01-01"
		p.CommittedDeliveryDate = &stale
		return fx.store.UpdateProject(txCtx, fiProjectAOnly, p)
	}); err != nil {
		t.Fatalf("read/update: %v", err)
	}
	if column() != "2026-12-22" {
		t.Fatalf("aggregate PUT overwrote the commitment: %q", column())
	}

	// 6. A lost order cannot get a commitment.
	if _, err := fx.admin.Exec(ctx, `UPDATE projects SET commercial_status = 'lost' WHERE id = $1`, fiProjectAOnly); err != nil {
		t.Fatal(err)
	}
	if _, err := commit(fiActorA(), "evt_1648_lost", "2027-02-01", "x"); !errors.Is(err, domain.ErrDeliveryCommitmentClosedProject) {
		t.Fatalf("lost project: %v", err)
	}
}
