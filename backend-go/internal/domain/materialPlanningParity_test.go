package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// assertFixtureSetParity checks that a fixture vocabulary and its Go map
// contain exactly the same values (parity contract, AGENTS.md).
func assertFixtureSetParity(t *testing.T, name string, fixtureValues []string, goMap map[string]struct{}, isValid func(string) bool) {
	t.Helper()
	goValues := make(map[string]struct{}, len(goMap))
	for k := range goMap {
		goValues[k] = struct{}{}
	}
	for _, v := range fixtureValues {
		if _, ok := goValues[v]; !ok {
			t.Errorf("fixture %s %q missing from Go", name, v)
		}
		delete(goValues, v)
		if isValid != nil && !isValid(v) {
			t.Errorf("fixture %s %q must be valid in Go", name, v)
		}
	}
	for extra := range goValues {
		t.Errorf("Go %s has %q not present in the shared fixture", name, extra)
	}
}

// TestMaterialPlanningFixtureParity validates parity with
// contracts/materialPlanning.json (OC-050..OC-054).
func TestMaterialPlanningFixtureParity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "materialPlanning.json"))
	if err != nil {
		t.Fatalf("read contracts/materialPlanning.json: %v", err)
	}
	var fixture struct {
		Comment           string   `json:"comment"`
		ReservationStatuses []string `json:"reservationStatuses"`
		ReleaseCheckCodes []string `json:"releaseCheckCodes"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse contracts/materialPlanning.json: %v", err)
	}

	assertFixtureSetParity(t, "reservationStatuses", fixture.ReservationStatuses, materialReservationStatuses, IsValidMaterialReservationStatus)

	for _, code := range fixture.ReleaseCheckCodes {
		if _, ok := materialsReleaseCheckLabels[MaterialsReleaseCheckCode(code)]; !ok {
			t.Errorf("fixture releaseCheckCode %q missing from Go", code)
		}
	}
	goCodes := map[string]struct{}{}
	for code := range materialsReleaseCheckLabels {
		goCodes[string(code)] = struct{}{}
	}
	for code := range goCodes {
		found := false
		for _, fc := range fixture.ReleaseCheckCodes {
			if fc == code {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Go releaseCheckCode %q not present in the shared fixture", code)
		}
	}
}

func planningTestSnapshot(lines ...MaterialRequirementLine) *MaterialRequirementsSnapshot {
	return &MaterialRequirementsSnapshot{
		ReleaseID:      "rel-1",
		BomFingerprint: "fp-abc123",
		DerivedAt:      time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC),
		Lines:          lines,
	}
}

func planningTestPlanning() *MaterialPlanning {
	at := time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC)
	return &MaterialPlanning{
		ID:        "mplan-1",
		ProjectID: "proj-1",
		Requirements: planningTestSnapshot(
			MaterialRequirementLine{Kind: "herrajes", MaterialID: "hw-1", Quantity: 10},
		),
		Reservations: []MaterialReservation{},
		CreatedAt:   at,
	}
}

// TestEvaluateMaterialsReleaseReadiness mirrors the TS gate tests: no
// planning fails, uncovered lines fail, unbacked reservations fail and a
// fully backed plan passes.
func TestEvaluateMaterialsReleaseReadiness(t *testing.T) {
	checks, ready := EvaluateMaterialsReleaseReadiness(nil, nil, nil)
	if ready {
		t.Fatal("sin planning la liberación no puede estar lista")
	}
	if len(checks) != 3 || checks[0].Code != ReleaseCheckRequirementsDerived {
		t.Fatalf("checks inesperados: %+v", checks)
	}

	stock := []MaterialStock{{Kind: "herrajes", MaterialID: "hw-1", Quantity: 4, MinStock: 0}}
	checks, ready = EvaluateMaterialsReleaseReadiness(planningTestPlanning(), stock, []*MaterialPlanning{planningTestPlanning()})
	if ready {
		t.Fatal("líneas sin reservar no pueden pasar el gate")
	}
	if !containsCheck(checks, ReleaseCheckLinesReserved) {
		t.Fatalf("debe fallar lines_reserved: %+v", checks)
	}

	fullyReserved := planningTestPlanning()
	fullyReserved.Reservations = []MaterialReservation{{
		ID: "r-1", Kind: "herrajes", MaterialID: "hw-1", Quantity: 10,
		Status: MaterialReservationActive, ReservedAt: time.Now(),
	}}
	checks, ready = EvaluateMaterialsReleaseReadiness(fullyReserved, stock, []*MaterialPlanning{fullyReserved})
	if ready {
		t.Fatal("reservas sin stock físico no pueden pasar el gate")
	}
	if !containsCheck(checks, ReleaseCheckReservationsBacked) {
		t.Fatalf("debe fallar reservations_backed: %+v", checks)
	}

	backingStock := []MaterialStock{{Kind: "herrajes", MaterialID: "hw-1", Quantity: 12, MinStock: 0}}
	checks, ready = EvaluateMaterialsReleaseReadiness(fullyReserved, backingStock, []*MaterialPlanning{fullyReserved})
	if !ready {
		t.Fatalf("plan respaldado debe pasar: %+v", checks)
	}
}

func containsCheck(checks []MaterialsReleaseCheck, code MaterialsReleaseCheckCode) bool {
	for _, c := range checks {
		if c.Code == code && !c.Passed {
			return true
		}
	}
	return false
}

// TestComputeWarehouseAvailability mirrors the TS six-quantity math.
func TestComputeWarehouseAvailability(t *testing.T) {
	stock := []MaterialStock{{Kind: "herrajes", MaterialID: "hw-1", Quantity: 12, MinStock: 2}}
	planning := planningTestPlanning()
	other := &MaterialPlanning{
		ID:          "mplan-2",
		ProjectID:   "proj-2",
		Reservations: []MaterialReservation{{
			ID: "r-o", Kind: "herrajes", MaterialID: "hw-1", Quantity: 5,
			Status: MaterialReservationActive, ReservedAt: time.Now(),
		}},
	}
	pos := []PurchaseOrder{{
		ID: "po-1", Number: "OC-0001", SupplierID: "sup-1", Status: POEmitida,
		Items: []PurchaseOrderItem{{Kind: "herrajes", MaterialID: "hw-1", Quantity: 20, ReceivedQuantity: 5}},
	}}

	rows := ComputeWarehouseAvailability(stock, []*MaterialPlanning{planning, other}, pos)
	if len(rows) != 1 {
		t.Fatalf("esperaba 1 fila, got %d", len(rows))
	}
	hw := rows[0]
	if hw.OnHand != 12 || hw.Reserved != 5 || hw.Available != 7 {
		t.Fatalf("cantidades básicas: %+v", hw)
	}
	if hw.Incoming != 15 {
		t.Fatalf("incoming: %+v", hw)
	}
	if hw.Required != 10 || hw.Shortage != 0 {
		t.Fatalf("required/shortage: %+v", hw)
	}
}

// TestComputeProjectCoverageAllocatedIncoming mirrors the TS coverage test:
// shortage only for what neither stock nor allocated incoming covers.
func TestComputeProjectCoverageAllocatedIncoming(t *testing.T) {
	planning := planningTestPlanning()
	planning.Reservations = []MaterialReservation{{
		ID: "r-1", Kind: "herrajes", MaterialID: "hw-1", Quantity: 6,
		Status: MaterialReservationActive, ReservedAt: time.Now(),
	}}
	allocated := "proj-1"
	stock := []MaterialStock{{Kind: "herrajes", MaterialID: "hw-1", Quantity: 8, MinStock: 0}}
	pos := []PurchaseOrder{{
		ID: "po-1", Number: "OC-0001", SupplierID: "sup-1", Status: POEmitida,
		Items: []PurchaseOrderItem{{Kind: "herrajes", MaterialID: "hw-1", Quantity: 10, ReceivedQuantity: 0, AllocatedProjectID: &allocated}},
	}}

	coverage := ComputeProjectCoverage("proj-1", stock, []*MaterialPlanning{planning}, pos)
	if len(coverage) != 1 {
		t.Fatalf("esperaba 1 línea, got %d", len(coverage))
	}
	line := coverage[0]
	if line.Reserved != 6 || line.PendingReserve != 4 || line.Available != 2 {
		t.Fatalf("coverage: %+v", line)
	}
	if line.IncomingAllocated != 10 || line.Shortage != 0 {
		t.Fatalf("allocated incoming debe cubrir el resto: %+v", line)
	}
}

// TestPlanReservationsCappedByAvailability mirrors the TS reserve caps.
func TestPlanReservationsCappedByAvailability(t *testing.T) {
	planning := planningTestPlanning()
	stock := []MaterialStock{{Kind: "herrajes", MaterialID: "hw-1", Quantity: 7, MinStock: 0}}
	next, reserved, short := PlanReservations(planning, stock, []*MaterialPlanning{planning}, nil, "alm-1", time.Now())
	if len(reserved) != 1 || reserved[0].Quantity != 7 {
		t.Fatalf("debe reservar hasta disponible: %+v", reserved)
	}
	if len(short) != 1 || short[0].Quantity != 3 {
		t.Fatalf("el resto es shortage: %+v", short)
	}
	if len(next.Reservations) != 1 || next.Reservations[0].Status != MaterialReservationActive {
		t.Fatalf("reserva persistida: %+v", next.Reservations)
	}
}

// TestValidateMaterialPlanningTransition guards the append-only invariants.
func TestValidateMaterialPlanningTransition(t *testing.T) {
	prev := planningTestPlanning()
	prev.Reservations = []MaterialReservation{{
		ID: "r-1", Kind: "herrajes", MaterialID: "hw-1", Quantity: 10,
		Status: MaterialReservationActive, ReservedAt: time.Now(),
	}}

	// Removing a reservation is illegal.
	removed := planningTestPlanning()
	if err := ValidateMaterialPlanningTransition(prev, removed); err == nil {
		t.Fatal("remover reservas debe ser ilegal")
	}
	// Growing a reservation is illegal.
	grown := planningTestPlanning()
	grown.Reservations = []MaterialReservation{{
		ID: "r-1", Kind: "herrajes", MaterialID: "hw-1", Quantity: 20,
		Status: MaterialReservationActive, ReservedAt: time.Now(),
	}}
	if err := ValidateMaterialPlanningTransition(prev, grown); err == nil {
		t.Fatal("agrandar reservas debe ser ilegal")
	}
	// Consumption is the other legal terminal path (picking despacho).
	consumed := planningTestPlanning()
	consumedAt := time.Now()
	consumed.Reservations = []MaterialReservation{{
		ID: "r-1", Kind: "herrajes", MaterialID: "hw-1", Quantity: 10,
		Status: MaterialReservationConsumed, ReservedAt: consumedAt, ConsumedAt: &consumedAt,
	}}
	if err := ValidateMaterialPlanningTransition(prev, consumed); err != nil {
		t.Fatalf("active → consumed debe ser legal: %v", err)
	}
	// Released is a legal transition.
	released := planningTestPlanning()
	now := time.Now()
	released.Reservations = []MaterialReservation{{
		ID: "r-1", Kind: "herrajes", MaterialID: "hw-1", Quantity: 10,
		Status: MaterialReservationReleased, ReservedAt: now, ReleasedAt: &now,
	}}
	if err := ValidateMaterialPlanningTransition(prev, released); err != nil {
		t.Fatalf("active → released debe ser legal: %v", err)
	}
	// Release is not revocable.
	released.Release = &MaterialsReleaseEvidence{ReleasedAt: now}
	revoked := planningTestPlanning()
	revoked.Release = nil
	revoked.Reservations = released.Reservations
	if err := ValidateMaterialPlanningTransition(released, revoked); err == nil {
		t.Fatal("la liberación no es revocable")
	}
}
