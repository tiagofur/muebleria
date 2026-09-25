package storage_test

/**
 * roadmap-screens 2a.4 — engineering_log JSONB column round-trip: the
 * engineering lifecycle must survive create → update → read (before this
 * column the log lived only in React state and died on reload).
 */

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// sameJSON — JSONB normalizes key order/spacing, so compare semantically.
func sameJSON(t *testing.T, a, b []byte) bool {
	t.Helper()
	var ma, mb map[string]interface{}
	if err := json.Unmarshal(a, &ma); err != nil {
		return false
	}
	if err := json.Unmarshal(b, &mb); err != nil {
		return false
	}
	return fmt.Sprint(ma) == fmt.Sprint(mb)
}

// uuidv4 — projects/customers ids are UUID columns.
func uuidv4(t *testing.T) string {
	t.Helper()
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func TestProject_EngineeringLogRoundTrip(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	id, customerID := uuidv4(t), uuidv4(t)
	customer := &domain.Customer{ID: customerID, Name: "Ingeniería Log S.A.", Email: "eng@example.com", Active: true}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateCustomer(txCtx, customer) })
	created := &domain.Project{ID: id, Name: "Cocina Ingeniería", CustomerID: customer.ID, Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateProject(txCtx, created) })
	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Project, error) { return store.GetProjectByID(txCtx, id) })
	if got.EngineeringLog != nil {
		t.Fatalf("expected no engineering log on create, got %s", got.EngineeringLog)
	}
	log := []byte(`{"started_by":"u1","started_at":"2026-08-17T10:00:00Z","generated_by":"u2","generated_at":"2026-08-17T11:00:00Z","sent_to_production_by":"u2","sent_to_production_at":"2026-08-17T12:00:00Z","revision":2}`)
	got.EngineeringLog = log
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.UpdateProject(txCtx, id, got) })
	after := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Project, error) { return store.GetProjectByID(txCtx, id) })
	if !sameJSON(t, after.EngineeringLog, log) {
		t.Fatalf("engineering log round-trip mismatch:\n got %s\nwant %s", after.EngineeringLog, log)
	}
	after.EngineeringLog = nil
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.UpdateProject(txCtx, id, after) })
	cleared := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Project, error) { return store.GetProjectByID(txCtx, id) })
	if cleared.EngineeringLog != nil {
		t.Fatalf("expected log cleared, got %s", cleared.EngineeringLog)
	}
}
