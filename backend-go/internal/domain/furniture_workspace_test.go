package domain_test

import (
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestBuildFurnitureWorkspace_PlacedAndPendingProjection(t *testing.T) {
	now := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
	instA := domain.FurnitureInstance{
		ID:        "fi-00000000-0000-4000-8000-000000000001",
		ProjectID: "p-0001",
		Origin:    domain.FurnitureInstanceOriginQuote,
		LifecycleStatus: domain.FurnitureInstanceLifecycleActive,
		CreatedAt: now,
	}
	instB := domain.FurnitureInstance{
		ID:        "fi-00000000-0000-4000-8000-000000000002",
		ProjectID: "p-0001",
		Origin:    domain.FurnitureInstanceOriginQuote,
		LifecycleStatus: domain.FurnitureInstanceLifecycleActive,
		CreatedAt: now.Add(time.Second),
	}
	instC := domain.FurnitureInstance{
		ID:        "fi-00000000-0000-4000-8000-000000000003",
		ProjectID: "p-0001",
		Origin:    domain.FurnitureInstanceOriginQuote,
		LifecycleStatus: domain.FurnitureInstanceLifecycleActive,
		CreatedAt: now.Add(2 * time.Second),
	}

	inputs := domain.FurnitureWorkspaceInputs{
		ProjectID:             "p-0001",
		Instances:             []domain.FurnitureInstance{instA, instB, instC},
		DesignContextKind:     domain.FurnitureWorkspaceContextWorking,
		DesignID:              "d-0001",
		DesignItemInstanceIDs: []string{instA.ID, instB.ID},
	}

	ws := domain.BuildFurnitureWorkspace(inputs)
	if len(ws.Units) != 3 {
		t.Fatalf("expected 3 units, got %d", len(ws.Units))
	}

	unitsByID := make(map[string]domain.FurnitureWorkspaceUnit)
	for _, u := range ws.Units {
		unitsByID[u.Instance.ID] = u
	}

	// FI-A and FI-B are placed in working copy.
	if u := unitsByID[instA.ID]; u.Design.Presence != domain.FurnitureWorkspaceDesignPresencePlaced {
		t.Errorf("instA: expected presence placed, got %s", u.Design.Presence)
	}
	if u := unitsByID[instB.ID]; u.Design.Presence != domain.FurnitureWorkspaceDesignPresencePlaced {
		t.Errorf("instB: expected presence placed, got %s", u.Design.Presence)
	}

	// FI-C is pending placement.
	uC := unitsByID[instC.ID]
	if uC.Design.Presence != domain.FurnitureWorkspaceDesignPresencePending {
		t.Errorf("instC: expected presence pending, got %s", uC.Design.Presence)
	}
	if uC.ActionRequired == nil {
		t.Fatalf("instC: expected actionRequired for pending, got nil")
	}
	if uC.ActionRequired.Code != domain.FurnitureWorkspaceActionPendingPlacement {
		t.Errorf("instC: expected action code %s, got %s", domain.FurnitureWorkspaceActionPendingPlacement, uC.ActionRequired.Code)
	}
	if uC.ActionRequired.Message != "Pendiente de colocar en el diseño" {
		t.Errorf("instC: unexpected message %s", uC.ActionRequired.Message)
	}
	if uC.ActionRequired.Remediation != "Colocá la unidad desde el panel de muebles" {
		t.Errorf("instC: unexpected remediation %s", uC.ActionRequired.Remediation)
	}

	// Summary checks.
	if ws.Summary.Placed != 2 {
		t.Errorf("expected 2 placed in summary, got %d", ws.Summary.Placed)
	}
	if ws.Summary.Pending != 1 {
		t.Errorf("expected 1 pending in summary, got %d", ws.Summary.Pending)
	}
	if ws.Summary.ActionRequired != 1 {
		t.Errorf("expected 1 actionRequired in summary, got %d", ws.Summary.ActionRequired)
	}
}

func TestBuildFurnitureWorkspace_CommercialGroupingProvenance(t *testing.T) {
	now := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
	defID := "def-same-definition-0001"

	// Line A: qty=2 with definition D.
	fiA := domain.FurnitureInstance{ID: "fi-A", ProjectID: "p-01", FurnitureDefinitionID: defID, Origin: domain.FurnitureInstanceOriginQuote, CreatedAt: now}
	fiB := domain.FurnitureInstance{ID: "fi-B", ProjectID: "p-01", FurnitureDefinitionID: defID, Origin: domain.FurnitureInstanceOriginQuote, CreatedAt: now.Add(time.Second)}

	// Line B: qty=2 with the exact same definition D.
	fiC := domain.FurnitureInstance{ID: "fi-C", ProjectID: "p-01", FurnitureDefinitionID: defID, Origin: domain.FurnitureInstanceOriginQuote, CreatedAt: now.Add(2 * time.Second)}
	fiD := domain.FurnitureInstance{ID: "fi-D", ProjectID: "p-01", FurnitureDefinitionID: defID, Origin: domain.FurnitureInstanceOriginQuote, CreatedAt: now.Add(3 * time.Second)}

	// Unit E: origin=design, also with definition D.
	fiE := domain.FurnitureInstance{ID: "fi-E", ProjectID: "p-01", FurnitureDefinitionID: defID, Origin: domain.FurnitureInstanceOriginDesign, CreatedAt: now.Add(4 * time.Second)}

	// Provenance map comes from quote_line_furniture_instances table (line A and line B).
	groupingMap := map[string]domain.FurnitureWorkspaceCommercialGrouping{
		"fi-A": {QuoteLineID: "line-A", UnitIndex: 1, UnitTotal: 2},
		"fi-B": {QuoteLineID: "line-A", UnitIndex: 2, UnitTotal: 2},
		"fi-C": {QuoteLineID: "line-B", UnitIndex: 1, UnitTotal: 2},
		"fi-D": {QuoteLineID: "line-B", UnitIndex: 2, UnitTotal: 2},
	}

	ws := domain.BuildFurnitureWorkspace(domain.FurnitureWorkspaceInputs{
		ProjectID:                    "p-01",
		Instances:                    []domain.FurnitureInstance{fiA, fiB, fiC, fiD, fiE},
		CommercialGroupingByInstance: groupingMap,
		DesignContextKind:            domain.FurnitureWorkspaceContextNone,
	})

	unitsByID := make(map[string]domain.FurnitureWorkspaceUnit)
	for _, u := range ws.Units {
		unitsByID[u.Instance.ID] = u
	}

	// Invariant: Line A is Unidad 1/2 and 2/2.
	uA := unitsByID["fi-A"]
	if uA.CommercialGrouping == nil || uA.CommercialGrouping.QuoteLineID != "line-A" || uA.CommercialGrouping.UnitIndex != 1 || uA.CommercialGrouping.UnitTotal != 2 {
		t.Fatalf("fi-A: expected line-A 1 of 2, got %+v", uA.CommercialGrouping)
	}
	uB := unitsByID["fi-B"]
	if uB.CommercialGrouping == nil || uB.CommercialGrouping.QuoteLineID != "line-A" || uB.CommercialGrouping.UnitIndex != 2 || uB.CommercialGrouping.UnitTotal != 2 {
		t.Fatalf("fi-B: expected line-A 2 of 2, got %+v", uB.CommercialGrouping)
	}

	// Invariant: Line B is Unidad 1/2 and 2/2. They NEVER merge into 1..4.
	uC := unitsByID["fi-C"]
	if uC.CommercialGrouping == nil || uC.CommercialGrouping.QuoteLineID != "line-B" || uC.CommercialGrouping.UnitIndex != 1 || uC.CommercialGrouping.UnitTotal != 2 {
		t.Fatalf("fi-C: expected line-B 1 of 2, got %+v", uC.CommercialGrouping)
	}
	uD := unitsByID["fi-D"]
	if uD.CommercialGrouping == nil || uD.CommercialGrouping.QuoteLineID != "line-B" || uD.CommercialGrouping.UnitIndex != 2 || uD.CommercialGrouping.UnitTotal != 2 {
		t.Fatalf("fi-D: expected line-B 2 of 2, got %+v", uD.CommercialGrouping)
	}

	// Invariant: Design-origin unit fi-E NEVER joins a commercial group.
	uE := unitsByID["fi-E"]
	if uE.CommercialGrouping != nil {
		t.Fatalf("fi-E: origin=design must not have commercial grouping, got %+v", uE.CommercialGrouping)
	}
}

func TestBuildFurnitureWorkspace_ExactContextualReleasePinning(t *testing.T) {
	// Scenario:
	// P1: Release 1 -> Q1 / R1
	// P2: Release 2 -> Q2 / R2 (latest in project)
	p2Latest := &domain.ProductionRelease{
		ID:                   "rel-02",
		ProjectID:            "p-01",
		ReleaseNumber:        2,
		DesignRevisionID:     "rev-des-02",
		DesignRevisionNumber: 2,
		QuoteRevisionID:      "rev-quote-02",
	}

	// Case 1: Screen selects Q1 / R1 -> P2 is latest, but contextual release must be nil (since newest pin is P2, and P2 doesn't match Q1/R1).
	wsMismatch := domain.BuildFurnitureWorkspace(domain.FurnitureWorkspaceInputs{
		ProjectID:            "p-01",
		DesignContextKind:    domain.FurnitureWorkspaceContextRevision,
		DesignID:             "des-01",
		DesignRevisionID:     "rev-des-01",
		DesignRevisionNumber: 1,
		Quote: &domain.QuoteRevisionDetail{
			QuoteRevision: domain.QuoteRevision{ID: "rev-quote-01", RevisionNumber: 1},
		},
		Release: p2Latest,
	})
	if wsMismatch.LatestProjectRelease == nil || wsMismatch.LatestProjectRelease.ID != "rel-02" {
		t.Errorf("expected LatestProjectRelease rel-02, got %+v", wsMismatch.LatestProjectRelease)
	}
	if wsMismatch.Release != nil {
		t.Errorf("expected contextual release nil for mismatched Q1/R1, got %+v", wsMismatch.Release)
	}

	// Case 2: Screen selects Q2 / R2 -> P2 matches exact pins -> contextual release is P2.
	wsMatch := domain.BuildFurnitureWorkspace(domain.FurnitureWorkspaceInputs{
		ProjectID:            "p-01",
		DesignContextKind:    domain.FurnitureWorkspaceContextRevision,
		DesignID:             "des-01",
		DesignRevisionID:     "rev-des-02",
		DesignRevisionNumber: 2,
		Quote: &domain.QuoteRevisionDetail{
			QuoteRevision: domain.QuoteRevision{ID: "rev-quote-02", RevisionNumber: 2},
		},
		Release: p2Latest,
	})
	if wsMatch.Release == nil || wsMatch.Release.ID != "rel-02" {
		t.Errorf("expected contextual release rel-02 for matching Q2/R2, got %+v", wsMatch.Release)
	}

	// Case 3: Screen selects working copy -> NEVER claims a contextual release.
	wsWorking := domain.BuildFurnitureWorkspace(domain.FurnitureWorkspaceInputs{
		ProjectID:         "p-01",
		DesignContextKind: domain.FurnitureWorkspaceContextWorking,
		DesignID:          "des-01",
		Release:           p2Latest,
	})
	if wsWorking.Release != nil {
		t.Errorf("working copy must NEVER claim contextual release, got %+v", wsWorking.Release)
	}
	if wsWorking.LatestProjectRelease == nil || wsWorking.LatestProjectRelease.ID != "rel-02" {
		t.Errorf("expected LatestProjectRelease rel-02 on working copy, got %+v", wsWorking.LatestProjectRelease)
	}
}

func TestBuildFurnitureWorkspace_ActionPriority(t *testing.T) {
	inst := domain.FurnitureInstance{
		ID:        "fi-conflict-01",
		ProjectID: "p-01",
		Origin:    domain.FurnitureInstanceOriginQuote,
		LifecycleStatus: domain.FurnitureInstanceLifecycleActive,
	}

	// Both: pending placement in design AND non-synced reconciliation conflict.
	// Invariant: non-synced server reconciliation wins over pending placement.
	ws := domain.BuildFurnitureWorkspace(domain.FurnitureWorkspaceInputs{
		ProjectID:         "p-01",
		Instances:         []domain.FurnitureInstance{inst},
		DesignContextKind: domain.FurnitureWorkspaceContextRevision,
		DesignID:          "des-01",
		DesignRevisionID:  "rev-01",
		Reconciliation: &domain.ReconciliationResult{
			Items: []domain.ReconciliationItem{
				{FurnitureInstanceID: inst.ID, Status: domain.ReconciliationStatusConflict},
			},
		},
	})

	u := ws.Units[0]
	if u.ActionRequired == nil {
		t.Fatalf("expected actionRequired, got nil")
	}
	if u.ActionRequired.Code != domain.FurnitureWorkspaceActionConflict {
		t.Errorf("expected conflict action to win, got %s", u.ActionRequired.Code)
	}
}
