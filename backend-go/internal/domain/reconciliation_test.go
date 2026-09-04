package domain_test

import (
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestReconcile_Synced(t *testing.T) {
	projID := "10000000-0000-0000-0000-000000000001"
	quoteRevID := "20000000-0000-0000-0000-000000000001"
	designRevID := "30000000-0000-0000-0000-000000000001"

	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       projID,
		QuoteRevisionID: quoteRevID,
		Items: []domain.CommercialItemSnapshot{
			{
				FurnitureInstanceID:   "FI-001",
				FurnitureDefinitionID: "MOD-BASE-600",
				Parameters: map[string]any{
					"widthMm":  600,
					"heightMm": 720,
					"depthMm":  560,
				},
				MaterialChoices: map[string]string{
					"front": "MAT-WHITE",
					"body":  "MAT-WHITE",
				},
			},
		},
	}

	design := domain.DesignRevisionSnapshot{
		ProjectID:        projID,
		DesignRevisionID: designRevID,
		Items: []domain.DesignRevisionItem{
			{
				FurnitureInstanceID:   "FI-001",
				FurnitureDefinitionID: "MOD-BASE-600",
				Parameters: map[string]any{
					"widthMm":  600.0, // test numerical normalization
					"heightMm": 720,
					"depthMm":  560,
				},
				MaterialChoices: map[string]string{
					"front": "MAT-WHITE",
					"body":  "MAT-WHITE",
				},
				Transform: &domain.Transform3D{
					TranslationMm: [3]float64{100, 200, 0},
				},
				TechnicalClientLocator: &domain.TechnicalClientLocator{
					Kind:  "sketchup",
					Value: "12345",
				},
			},
		},
	}

	result, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile failed: %v", err)
	}

	if result.Summary.Total != 1 || result.Summary.Synced != 1 {
		t.Fatalf("unexpected summary: %+v", result.Summary)
	}
	if len(result.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(result.Items))
	}
	item := result.Items[0]
	if item.FurnitureInstanceID != "FI-001" || item.Status != domain.ReconciliationStatusSynced {
		t.Fatalf("expected FI-001 synced, got %+v", item)
	}
	if len(item.Differences) != 0 {
		t.Fatalf("expected 0 differences, got %+v", item.Differences)
	}
}

func TestReconcile_QuotedNotModeled(t *testing.T) {
	projID := "10000000-0000-0000-0000-000000000001"
	quoteRevID := "20000000-0000-0000-0000-000000000001"
	designRevID := "30000000-0000-0000-0000-000000000001"

	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       projID,
		QuoteRevisionID: quoteRevID,
		Items: []domain.CommercialItemSnapshot{
			{
				FurnitureInstanceID:   "FI-002",
				FurnitureDefinitionID: "MOD-BASE-600",
			},
		},
	}

	design := domain.DesignRevisionSnapshot{
		ProjectID:        projID,
		DesignRevisionID: designRevID,
		Items:            []domain.DesignRevisionItem{},
	}

	result, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile failed: %v", err)
	}

	if result.Summary.Total != 1 || result.Summary.QuotedNotModeled != 1 {
		t.Fatalf("unexpected summary: %+v", result.Summary)
	}
	if result.Items[0].Status != domain.ReconciliationStatusQuotedNotModeled {
		t.Fatalf("expected quoted_not_modeled, got %s", result.Items[0].Status)
	}
}

func TestReconcile_ModeledNotQuoted(t *testing.T) {
	projID := "10000000-0000-0000-0000-000000000001"
	quoteRevID := "20000000-0000-0000-0000-000000000001"
	designRevID := "30000000-0000-0000-0000-000000000001"

	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       projID,
		QuoteRevisionID: quoteRevID,
		Items:           []domain.CommercialItemSnapshot{},
	}

	design := domain.DesignRevisionSnapshot{
		ProjectID:        projID,
		DesignRevisionID: designRevID,
		Items: []domain.DesignRevisionItem{
			{
				FurnitureInstanceID:   "FI-003",
				FurnitureDefinitionID: "MOD-CAJONERA",
			},
		},
	}

	result, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile failed: %v", err)
	}

	if result.Summary.Total != 1 || result.Summary.ModeledNotQuoted != 1 {
		t.Fatalf("unexpected summary: %+v", result.Summary)
	}
	if result.Items[0].Status != domain.ReconciliationStatusModeledNotQuoted {
		t.Fatalf("expected modeled_not_quoted, got %s", result.Items[0].Status)
	}
}

func TestReconcile_Modified_ParametersAndMaterials(t *testing.T) {
	projID := "10000000-0000-0000-0000-000000000001"
	quoteRevID := "20000000-0000-0000-0000-000000000001"
	designRevID := "30000000-0000-0000-0000-000000000001"

	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       projID,
		QuoteRevisionID: quoteRevID,
		Items: []domain.CommercialItemSnapshot{
			{
				FurnitureInstanceID:   "FI-001",
				FurnitureDefinitionID: "MOD-BASE-600",
				Parameters: map[string]any{
					"widthMm": 600,
				},
				MaterialChoices: map[string]string{
					"front": "MAT-WHITE",
				},
			},
		},
	}

	design := domain.DesignRevisionSnapshot{
		ProjectID:        projID,
		DesignRevisionID: designRevID,
		Items: []domain.DesignRevisionItem{
			{
				FurnitureInstanceID:   "FI-001",
				FurnitureDefinitionID: "MOD-BASE-600",
				Parameters: map[string]any{
					"widthMm": 650,
				},
				MaterialChoices: map[string]string{
					"front": "MAT-OAK",
				},
			},
		},
	}

	result, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile failed: %v", err)
	}

	if result.Summary.Total != 1 || result.Summary.Modified != 1 {
		t.Fatalf("unexpected summary: %+v", result.Summary)
	}
	item := result.Items[0]
	if item.Status != domain.ReconciliationStatusModified {
		t.Fatalf("expected modified, got %s", item.Status)
	}
	if len(item.Differences) != 2 {
		t.Fatalf("expected 2 differences, got %d: %+v", len(item.Differences), item.Differences)
	}

	// Deterministic ordering: materialChoices.front before parameters.widthMm
	if item.Differences[0].Path != "materialChoices.front" ||
		item.Differences[0].QuoteValue != "MAT-WHITE" ||
		item.Differences[0].DesignValue != "MAT-OAK" {
		t.Errorf("unexpected diff 0: %+v", item.Differences[0])
	}
	if item.Differences[1].Path != "parameters.widthMm" ||
		item.Differences[1].QuoteValue != int64(600) ||
		item.Differences[1].DesignValue != int64(650) {
		t.Errorf("unexpected diff 1: %+v", item.Differences[1])
	}
}

// Negative Proof E (Mandatory): Same-looking different identity MUST NOT be collapsed/matched as one item.
func TestReconcile_NegativeProof_SameLookingDifferentIdentity(t *testing.T) {
	projID := "10000000-0000-0000-0000-000000000001"
	quoteRevID := "20000000-0000-0000-0000-000000000001"
	designRevID := "30000000-0000-0000-0000-000000000001"

	// Quote has FI-001 (Base 600)
	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       projID,
		QuoteRevisionID: quoteRevID,
		Items: []domain.CommercialItemSnapshot{
			{
				FurnitureInstanceID:   "FI-001",
				FurnitureDefinitionID: "MOD-BASE-600",
				Parameters:            map[string]any{"widthMm": 600},
			},
		},
	}

	// Design has FI-002 (Base 600, identical definition and parameters)
	design := domain.DesignRevisionSnapshot{
		ProjectID:        projID,
		DesignRevisionID: designRevID,
		Items: []domain.DesignRevisionItem{
			{
				FurnitureInstanceID:   "FI-002",
				FurnitureDefinitionID: "MOD-BASE-600",
				Parameters:            map[string]any{"widthMm": 600},
			},
		},
	}

	result, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile failed: %v", err)
	}

	// MUST NOT be collapsed to 1 synced item!
	if result.Summary.Synced != 0 {
		t.Fatalf("NEGATIVE PROOF VIOLATION: identical furniture with different IDs was matched as synced!")
	}
	if result.Summary.Total != 2 {
		t.Fatalf("expected total 2 items, got %d", result.Summary.Total)
	}
	if result.Summary.QuotedNotModeled != 1 || result.Summary.ModeledNotQuoted != 1 {
		t.Fatalf("expected 1 quoted_not_modeled and 1 modeled_not_quoted, got %+v", result.Summary)
	}

	if result.Items[0].FurnitureInstanceID != "FI-001" || result.Items[0].Status != domain.ReconciliationStatusQuotedNotModeled {
		t.Errorf("expected FI-001 quoted_not_modeled, got %+v", result.Items[0])
	}
	if result.Items[1].FurnitureInstanceID != "FI-002" || result.Items[1].Status != domain.ReconciliationStatusModeledNotQuoted {
		t.Errorf("expected FI-002 modeled_not_quoted, got %+v", result.Items[1])
	}
}

// Negative Proof F: Quantity > 1 partial placement.
func TestReconcile_NegativeProof_QuantityGreaterThanOnePartialPlacement(t *testing.T) {
	projID := "10000000-0000-0000-0000-000000000001"
	quoteRevID := "20000000-0000-0000-0000-000000000001"
	designRevID := "30000000-0000-0000-0000-000000000001"

	// Line qty=3 was materialized into FI-001, FI-002, FI-003
	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       projID,
		QuoteRevisionID: quoteRevID,
		Items: []domain.CommercialItemSnapshot{
			{FurnitureInstanceID: "FI-001", FurnitureDefinitionID: "MOD-BASE-600"},
			{FurnitureInstanceID: "FI-002", FurnitureDefinitionID: "MOD-BASE-600"},
			{FurnitureInstanceID: "FI-003", FurnitureDefinitionID: "MOD-BASE-600"},
		},
	}

	// Design only placed FI-001 and FI-002
	design := domain.DesignRevisionSnapshot{
		ProjectID:        projID,
		DesignRevisionID: designRevID,
		Items: []domain.DesignRevisionItem{
			{FurnitureInstanceID: "FI-001", FurnitureDefinitionID: "MOD-BASE-600"},
			{FurnitureInstanceID: "FI-002", FurnitureDefinitionID: "MOD-BASE-600"},
		},
	}

	result, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile failed: %v", err)
	}

	if result.Summary.Total != 3 || result.Summary.Synced != 2 || result.Summary.QuotedNotModeled != 1 {
		t.Fatalf("unexpected summary: %+v", result.Summary)
	}
	if result.Items[2].FurnitureInstanceID != "FI-003" || result.Items[2].Status != domain.ReconciliationStatusQuotedNotModeled {
		t.Errorf("expected FI-003 quoted_not_modeled, got %+v", result.Items[2])
	}
}

// Negative Proof G: Duplicate identity fail-closed as conflict.
func TestReconcile_NegativeProof_DuplicateIdentityConflict(t *testing.T) {
	projID := "10000000-0000-0000-0000-000000000001"
	quoteRevID := "20000000-0000-0000-0000-000000000001"
	designRevID := "30000000-0000-0000-0000-000000000001"

	// Design has duplicate FI-001
	design := domain.DesignRevisionSnapshot{
		ProjectID:        projID,
		DesignRevisionID: designRevID,
		Items: []domain.DesignRevisionItem{
			{FurnitureInstanceID: "FI-001", FurnitureDefinitionID: "MOD-BASE-600"},
			{FurnitureInstanceID: "FI-001", FurnitureDefinitionID: "MOD-BASE-600"},
		},
	}

	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       projID,
		QuoteRevisionID: quoteRevID,
		Items: []domain.CommercialItemSnapshot{
			{FurnitureInstanceID: "FI-001", FurnitureDefinitionID: "MOD-BASE-600"},
		},
	}

	result, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile failed: %v", err)
	}

	if result.Summary.Conflict != 1 {
		t.Fatalf("expected conflict count 1, got %+v", result.Summary)
	}
	if result.Items[0].Status != domain.ReconciliationStatusConflict {
		t.Fatalf("expected status conflict, got %s", result.Items[0].Status)
	}
}

// Negative Proof H: Cross-project rejection.
func TestReconcile_NegativeProof_CrossProjectRejected(t *testing.T) {
	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       "10000000-0000-0000-0000-000000000001",
		QuoteRevisionID: "20000000-0000-0000-0000-000000000001",
		Items: []domain.CommercialItemSnapshot{
			{FurnitureInstanceID: "FI-001"},
		},
	}

	design := domain.DesignRevisionSnapshot{
		ProjectID:        "99999999-9999-9999-9999-999999999999", // Different project!
		DesignRevisionID: "30000000-0000-0000-0000-000000000001",
		Items: []domain.DesignRevisionItem{
			{FurnitureInstanceID: "FI-001"},
		},
	}

	_, err := domain.Reconcile(quote, design)
	if !errors.Is(err, domain.ErrCrossProjectReconciliation) {
		t.Fatalf("expected ErrCrossProjectReconciliation, got %v", err)
	}
}

// Negative Proof J: Determinism.
func TestReconcile_DeterministicOutput(t *testing.T) {
	projID := "10000000-0000-0000-0000-000000000001"
	quoteRevID := "20000000-0000-0000-0000-000000000001"
	designRevID := "30000000-0000-0000-0000-000000000001"

	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       projID,
		QuoteRevisionID: quoteRevID,
		Items: []domain.CommercialItemSnapshot{
			{FurnitureInstanceID: "FI-003", FurnitureDefinitionID: "MOD-3"},
			{FurnitureInstanceID: "FI-001", FurnitureDefinitionID: "MOD-1", Parameters: map[string]any{"widthMm": 600, "heightMm": 700}},
			{FurnitureInstanceID: "FI-002", FurnitureDefinitionID: "MOD-2"},
		},
	}

	design := domain.DesignRevisionSnapshot{
		ProjectID:        projID,
		DesignRevisionID: designRevID,
		Items: []domain.DesignRevisionItem{
			{FurnitureInstanceID: "FI-002", FurnitureDefinitionID: "MOD-2"},
			{FurnitureInstanceID: "FI-004", FurnitureDefinitionID: "MOD-4"},
			{FurnitureInstanceID: "FI-001", FurnitureDefinitionID: "MOD-1", Parameters: map[string]any{"heightMm": 750, "widthMm": 650}},
		},
	}

	res1, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile 1 failed: %v", err)
	}

	res2, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile 2 failed: %v", err)
	}

	if len(res1.Items) != len(res2.Items) {
		t.Fatalf("length mismatch: %d vs %d", len(res1.Items), len(res2.Items))
	}
	for i := range res1.Items {
		i1 := res1.Items[i]
		i2 := res2.Items[i]
		if i1.FurnitureInstanceID != i2.FurnitureInstanceID || i1.Status != i2.Status {
			t.Fatalf("item mismatch at index %d: %+v vs %+v", i, i1, i2)
		}
		if len(i1.Differences) != len(i2.Differences) {
			t.Fatalf("diff length mismatch at index %d", i)
		}
		for d := range i1.Differences {
			if i1.Differences[d] != i2.Differences[d] {
				t.Fatalf("diff mismatch at %d.%d: %+v vs %+v", i, d, i1.Differences[d], i2.Differences[d])
			}
		}
	}
}

func TestReconcile_RemovedStatus(t *testing.T) {
	projID := "10000000-0000-0000-0000-000000000001"
	quoteRevID := "20000000-0000-0000-0000-000000000001"
	designRevID := "30000000-0000-0000-0000-000000000001"

	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       projID,
		QuoteRevisionID: quoteRevID,
		Items: []domain.CommercialItemSnapshot{
			{
				FurnitureInstanceID:   "FI-REMOVED-001",
				FurnitureDefinitionID: "MOD-BASE-600",
				LifecycleStatus:       "removed",
			},
			{
				FurnitureInstanceID:   "FI-CANCELLED-002",
				FurnitureDefinitionID: "MOD-BASE-600",
				LifecycleStatus:       "cancelled",
			},
		},
	}

	design := domain.DesignRevisionSnapshot{
		ProjectID:        projID,
		DesignRevisionID: designRevID,
		Items:            []domain.DesignRevisionItem{},
	}

	result, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile failed: %v", err)
	}

	if result.Summary.Removed != 2 || result.Summary.Total != 2 {
		t.Fatalf("expected 2 removed items, got %+v", result.Summary)
	}
	if result.Items[0].Status != domain.ReconciliationStatusRemoved {
		t.Errorf("expected FI-CANCELLED-002 removed, got %s", result.Items[0].Status)
	}
	if result.Items[1].Status != domain.ReconciliationStatusRemoved {
		t.Errorf("expected FI-REMOVED-001 removed, got %s", result.Items[1].Status)
	}
}

func TestReconcile_DefinitionVersion(t *testing.T) {
	projID := "10000000-0000-0000-0000-000000000001"
	quoteRevID := "20000000-0000-0000-0000-000000000001"
	designRevID := "30000000-0000-0000-0000-000000000001"

	vQuote := 4
	vDesign := 5

	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       projID,
		QuoteRevisionID: quoteRevID,
		Items: []domain.CommercialItemSnapshot{
			{
				FurnitureInstanceID:   "FI-001",
				FurnitureDefinitionID: "MOD-BASE-600",
				DefinitionVersion:     &vQuote,
			},
		},
	}

	design := domain.DesignRevisionSnapshot{
		ProjectID:        projID,
		DesignRevisionID: designRevID,
		Items: []domain.DesignRevisionItem{
			{
				FurnitureInstanceID:   "FI-001",
				FurnitureDefinitionID: "MOD-BASE-600",
				DefinitionVersion:     &vDesign,
			},
		},
	}

	result, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile failed: %v", err)
	}

	if result.Summary.Modified != 1 {
		t.Fatalf("expected 1 modified item, got %d", result.Summary.Modified)
	}
	if len(result.Items[0].Differences) != 1 {
		t.Fatalf("expected 1 difference, got %d", len(result.Items[0].Differences))
	}
	diff := result.Items[0].Differences[0]
	if diff.Path != "definitionVersion" || diff.QuoteValue != 4 || diff.DesignValue != 5 {
		t.Fatalf("expected definitionVersion 4 -> 5, got %+v", diff)
	}
}
