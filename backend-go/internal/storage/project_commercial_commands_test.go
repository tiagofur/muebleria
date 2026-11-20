package storage_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1647 on real PostgreSQL under the runtime role (no BYPASSRLS):
//   - the command writes event + commercial_status + audit in one transaction;
//   - another organization cannot reach the project (uniform not-found, no row);
//   - a failing statement rolls back the whole command (no status without event).

func commercialEvent(id, eventType string, actor string, payload string) domain.ProjectEvent {
	a := actor
	return domain.ProjectEvent{
		ID:        id,
		ProjectID: fiProjectAOnly,
		Type:      eventType,
		At:        time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC),
		ByUserID:  &a,
		Source:    domain.ProjectEventSourceWeb,
		Payload:   []byte(payload),
	}
}

func TestRecordProjectCommercialEvent_AtomicTenantScopedAndAudited(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO projects (id, name, customer_id, status, commercial_status, organization_id, sales_organization_id, manufacturing_organization_id)
		VALUES ('`+fiProjectAOnly+`', 'Org A private project', '30000000-0000-0000-0000-00000000000a', 'draft', 'sent',
			'`+rlsOrgA+`', '`+rlsOrgA+`', '`+rlsOrgA+`')`); err != nil {
		t.Fatal(err)
	}

	// 1. Deposit by org A: event + audit, commercial status untouched.
	deposit := commercialEvent("evt_1647_deposit", "deposit_received", rlsUserA, `{"amount":2500,"currency":"MXN"}`)
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		_, err := fx.store.RecordProjectCommercialEvent(txCtx, storage.ProjectCommercialEventCommand{
			Event: deposit, AuditEventType: "project_deposit_recorded", RequestID: "req-1647-a",
		})
		return err
	}); err != nil {
		t.Fatalf("deposit: %v", err)
	}
	var byUser, status string
	if err := fx.admin.QueryRow(ctx, `SELECT by_user_id::text FROM project_events WHERE id = 'evt_1647_deposit'`).Scan(&byUser); err != nil || byUser != rlsUserA {
		t.Fatalf("deposit event row: by=%q err=%v", byUser, err)
	}
	if err := fx.admin.QueryRow(ctx, `SELECT commercial_status FROM projects WHERE id = $1`, fiProjectAOnly).Scan(&status); err != nil || status != "sent" {
		t.Fatalf("deposit must not change commercial_status: %q %v", status, err)
	}
	assertCommercialAudit(t, fx, "project_deposit_recorded", "evt_1647_deposit", 1)

	// 2. Commercial status by org A: column + event + audit together.
	won := domain.CommercialStatusWon
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		_, err := fx.store.RecordProjectCommercialEvent(txCtx, storage.ProjectCommercialEventCommand{
			Event:            commercialEvent("evt_1647_won", "quote_won", rlsUserA, `{"commercialStatus":"won"}`),
			CommercialStatus: &won, AuditEventType: "project_commercial_status_changed",
		})
		return err
	}); err != nil {
		t.Fatalf("status: %v", err)
	}
	if err := fx.admin.QueryRow(ctx, `SELECT commercial_status FROM projects WHERE id = $1`, fiProjectAOnly).Scan(&status); err != nil || status != "won" {
		t.Fatalf("commercial_status = %q %v", status, err)
	}
	assertCommercialAudit(t, fx, "project_commercial_status_changed", "evt_1647_won", 1)

	// 3. Org B cannot reach org A's project: uniform not-found, nothing written.
	lost := domain.CommercialStatusLost
	err := fiTx(t, fx.store, fiActorB(), func(txCtx context.Context) error {
		_, err := fx.store.RecordProjectCommercialEvent(txCtx, storage.ProjectCommercialEventCommand{
			Event:            commercialEvent("evt_1647_foreign", "quote_lost", rlsUserB, `{"commercialStatus":"lost"}`),
			CommercialStatus: &lost, AuditEventType: "project_commercial_status_changed",
		})
		return err
	})
	if !errors.Is(err, storage.ErrProjectCommercialTargetNotFound) {
		t.Fatalf("foreign org: want not found, got %v", err)
	}
	var count int
	if err := fx.admin.QueryRow(ctx, `SELECT COUNT(*) FROM project_events WHERE id = 'evt_1647_foreign'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("foreign event written: %d %v", count, err)
	}

	// 4. Atomicity: a duplicate event id fails the insert, and the status
	// change requested in the same command must roll back with it.
	err = fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		_, err := fx.store.RecordProjectCommercialEvent(txCtx, storage.ProjectCommercialEventCommand{
			Event:            commercialEvent("evt_1647_won", "quote_lost", rlsUserA, `{"commercialStatus":"lost"}`),
			CommercialStatus: &lost, AuditEventType: "project_commercial_status_changed",
		})
		return err
	})
	if err == nil {
		t.Fatal("duplicate event id must fail")
	}
	if err := fx.admin.QueryRow(ctx, `SELECT commercial_status FROM projects WHERE id = $1`, fiProjectAOnly).Scan(&status); err != nil || status != "won" {
		t.Fatalf("failed command leaked commercial_status: %q %v", status, err)
	}
	assertCommercialAudit(t, fx, "project_commercial_status_changed", "evt_1647_won", 1)

	// 5. The project LIST carries the same lifecycle log as the detail, so a
	// reloaded web client sees the recorded deposit (#1647 browser finding).
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		list, err := fx.store.ListProjects(txCtx)
		if err != nil {
			return err
		}
		for _, p := range list {
			if p.ID != fiProjectAOnly {
				continue
			}
			types := map[string]bool{}
			for _, ev := range p.Events {
				types[ev.ID] = ev.ProjectID == fiProjectAOnly
			}
			if !types["evt_1647_deposit"] || !types["evt_1647_won"] || len(p.Events) != 2 {
				t.Fatalf("list events = %+v", p.Events)
			}
			return nil
		}
		t.Fatal("org A project missing from its own list")
		return nil
	}); err != nil {
		t.Fatalf("list: %v", err)
	}
	if err := fiTx(t, fx.store, fiActorB(), func(txCtx context.Context) error {
		list, err := fx.store.ListProjects(txCtx)
		if err != nil {
			return err
		}
		for _, p := range list {
			for _, ev := range p.Events {
				if ev.ProjectID == fiProjectAOnly {
					t.Fatalf("org B list leaked org A event %s", ev.ID)
				}
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("list B: %v", err)
	}
}

func assertCommercialAudit(t *testing.T, fx *rlsFixture, eventType, eventID string, want int) {
	t.Helper()
	var count int
	if err := fx.admin.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM security_audit_events
		WHERE event_type = $1 AND details->>'project_event_id' = $2 AND organization_id = $3`,
		eventType, eventID, rlsOrgA).Scan(&count); err != nil {
		t.Fatalf("count audit: %v", err)
	}
	if count != want {
		t.Fatalf("audit %s for %s = %d, want %d", eventType, eventID, count, want)
	}
}
