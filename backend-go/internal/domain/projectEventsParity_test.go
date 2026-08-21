package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestProjectEventTypesFixtureParity pins the Go event vocabulary to the
// shared contract fixture also consumed by the TS suite
// (packages/domain/src/projectLifecycle.test.ts). AGENTS.md parity rule: a
// rule living in TS and Go needs a contract fixture — this is it for the
// OC-010 event vocabulary.
func TestProjectEventTypesFixtureParity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "projectEventTypes.json"))
	if err != nil {
		t.Fatalf("read contracts/projectEventTypes.json: %v", err)
	}
	var fixture struct {
		Comment       string   `json:"comment"`
		EventTypes    []string `json:"eventTypes"`
		RejectedTypes []string `json:"rejectedTypes"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse contracts/projectEventTypes.json: %v", err)
	}
	if len(fixture.EventTypes) == 0 || len(fixture.RejectedTypes) == 0 {
		t.Fatal("contracts/projectEventTypes.json debe definir eventTypes y rejectedTypes")
	}

	goTypes := make(map[string]struct{}, len(projectEventTypes))
	for k := range projectEventTypes {
		goTypes[k] = struct{}{}
	}

	for _, typ := range fixture.EventTypes {
		if _, ok := goTypes[typ]; !ok {
			t.Errorf("fixture type %q missing from Go projectEventTypes", typ)
		}
		delete(goTypes, typ)
	}
	for extra := range goTypes {
		t.Errorf("Go projectEventTypes has %q not present in the shared fixture", extra)
	}

	for _, rejected := range fixture.RejectedTypes {
		if IsValidProjectEventType(rejected) {
			t.Errorf("fixture rejected type %q must not be a valid event type", rejected)
		}
	}
}

func TestIsValidProjectEventType(t *testing.T) {
	if !IsValidProjectEventType("quote_won") {
		t.Error("quote_won should be a valid event type")
	}
	if !IsValidProjectEventType("warranty_opened") {
		t.Error("warranty_opened should be a valid event type")
	}
	if IsValidProjectEventType("definitely_not_a_type") {
		t.Error("invented event type should be invalid")
	}
	if IsValidProjectEventType("") {
		t.Error("empty event type should be invalid")
	}
}

// TestRoleCanAppendProjectEvent covers the lifecycle RBAC matrix mirrored
// with TS rbac.ts roleCanAppendProjectEvent (OC-010..OC-024).
func TestRoleCanAppendProjectEvent(t *testing.T) {
	cases := []struct {
		role  UserRole
		event string
		want  bool
	}{
		{RoleAdmin, "project_closed", true},
		{RoleAdmin, "invented_event", false},
		{RoleUser, "quote_won", false},
		{RoleVendedor, "quote_won", true},
		{RoleVendedor, "deposit_received", true},
		{RoleVendedor, "customer_approved", true},
		{RoleVendedor, "production_released", false},
		{RoleVendedor, "change_order_approved", false},
		{RoleGerenteVentas, "change_order_approved", true},
		{RoleGerenteProduccion, "change_order_approved", true},
		{RoleGerenteProduccion, "engineering_approved", true},
		{RoleIngeniero, "production_released", true},
		{RoleIngeniero, "production_release_revoked", true},
		{RoleProduccion, "production_started", true},
		{RoleProduccion, "production_completed", true},
		{RoleProduccion, "production_released", false},
		{RoleAlmacen, "materials_ready", true},
		{RoleAlmacen, "project_closed", false},
	}

	for _, tc := range cases {
		if got := RoleCanAppendProjectEvent(tc.role, tc.event); got != tc.want {
			t.Errorf("RoleCanAppendProjectEvent(%s, %s) = %v, want %v", tc.role, tc.event, got, tc.want)
		}
	}
}
