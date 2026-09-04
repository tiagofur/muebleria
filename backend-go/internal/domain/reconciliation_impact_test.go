package domain_test

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #394 / DT-10: impact classification over the exact #393 reconciliation.

func impactOf(t *testing.T, recon *domain.ReconciliationResult, furnitureInstanceID string) domain.ChangeImpact {
	t.Helper()
	classification, err := domain.ClassifyReconciliation(recon)
	if err != nil {
		t.Fatalf("ClassifyReconciliation: %v", err)
	}
	for _, item := range classification.Items {
		if item.FurnitureInstanceID == furnitureInstanceID {
			return item.Impact
		}
	}
	t.Fatalf("item %s not found in classification", furnitureInstanceID)
	return domain.ChangeImpact{}
}

func classifySummary(t *testing.T, recon *domain.ReconciliationResult) domain.ImpactClassificationSummary {
	t.Helper()
	classification, err := domain.ClassifyReconciliation(recon)
	if err != nil {
		t.Fatalf("ClassifyReconciliation: %v", err)
	}
	return classification.Summary
}

func TestClassify_Synced_HasNoImpact(t *testing.T) {
	recon := mustReconcile(t,
		domain.CommercialItemSnapshot{FurnitureInstanceID: "FI-001", Parameters: map[string]any{"widthMm": 600}},
		domain.DesignRevisionItem{FurnitureInstanceID: "FI-001", Parameters: map[string]any{"widthMm": 600}},
	)
	if got := impactOf(t, recon, "FI-001"); !got.IsZero() {
		t.Errorf("synced item must have zero impact, got %+v", got)
	}
	if summary := classifySummary(t, recon); summary.RequiresRequote || !summary.CanRequote || summary.RequiresResolution {
		t.Errorf("synced reconciliation must not require requote, got %+v", summary)
	}
}

func TestClassify_ModifiedParameter_CommercialAndManufacturing(t *testing.T) {
	recon := mustReconcile(t,
		domain.CommercialItemSnapshot{FurnitureInstanceID: "FI-002", Parameters: map[string]any{"widthMm": 600}},
		domain.DesignRevisionItem{FurnitureInstanceID: "FI-002", Parameters: map[string]any{"widthMm": 650}},
	)
	got := impactOf(t, recon, "FI-002")
	if !got.Commercial || !got.Manufacturing || got.Spatial {
		t.Errorf("width 600→650 must be commercial+manufacturing and not spatial, got %+v", got)
	}
	if summary := classifySummary(t, recon); !summary.RequiresRequote {
		t.Errorf("commercial change must derive requiresRequote=true")
	}
}

func TestClassify_MaterialChoice_CommercialAndManufacturing(t *testing.T) {
	recon := mustReconcile(t,
		domain.CommercialItemSnapshot{FurnitureInstanceID: "FI-001", MaterialChoices: map[string]string{"frente": "roble"}},
		domain.DesignRevisionItem{FurnitureInstanceID: "FI-001", MaterialChoices: map[string]string{"frente": "blanco"}},
	)
	got := impactOf(t, recon, "FI-001")
	if !got.Commercial || !got.Manufacturing || got.Spatial {
		t.Errorf("material change must be commercial+manufacturing, got %+v", got)
	}
}

func TestClassify_DefinitionAndVersion_CommercialAndManufacturing(t *testing.T) {
	quoteVersion, designVersion := 2, 3
	recon := mustReconcile(t,
		domain.CommercialItemSnapshot{
			FurnitureInstanceID:   "FI-001",
			FurnitureDefinitionID: "def-1",
			DefinitionVersion:     &quoteVersion,
		},
		domain.DesignRevisionItem{
			FurnitureInstanceID:   "FI-001",
			FurnitureDefinitionID: "def-1",
			DefinitionVersion:     &designVersion,
		},
	)
	got := impactOf(t, recon, "FI-001")
	if !got.Commercial || !got.Manufacturing {
		t.Errorf("definition version change must be commercial+manufacturing, got %+v", got)
	}
}

func TestClassify_PureMove_WithSpatialEvidence_SpatialOnly(t *testing.T) {
	// Both snapshots carry explicit transform evidence: a pure 1200mm move
	// classifies spatial-only and never requires a requote.
	recon := mustReconcile(t,
		domain.CommercialItemSnapshot{
			FurnitureInstanceID: "FI-003",
			Parameters:          map[string]any{"widthMm": 900},
			Transform:           &domain.Transform3D{TranslationMm: [3]float64{1000, 0, 0}},
		},
		domain.DesignRevisionItem{
			FurnitureInstanceID: "FI-003",
			Parameters:          map[string]any{"widthMm": 900},
			Transform:           &domain.Transform3D{TranslationMm: [3]float64{2200, 0, 0}},
		},
	)
	if recon.Items[0].Status != domain.ReconciliationStatusModified {
		t.Fatalf("expected modified, got %s", recon.Items[0].Status)
	}
	if len(recon.Items[0].Differences) != 1 || recon.Items[0].Differences[0].Path != "transform.translationMm" {
		t.Fatalf("expected a single transform.translationMm difference, got %+v", recon.Items[0].Differences)
	}
	got := impactOf(t, recon, "FI-003")
	if got.Commercial || got.Manufacturing || !got.Spatial {
		t.Errorf("pure move must be spatial-only, got %+v", got)
	}
	if summary := classifySummary(t, recon); summary.RequiresRequote {
		t.Errorf("spatial-only change must never require a requote")
	}
}

func TestClassify_RoomChange_WithSpatialEvidence_SpatialOnly(t *testing.T) {
	recon := mustReconcile(t,
		domain.CommercialItemSnapshot{FurnitureInstanceID: "FI-001", RoomID: "room-1"},
		domain.DesignRevisionItem{FurnitureInstanceID: "FI-001", RoomID: "room-2"},
	)
	got := impactOf(t, recon, "FI-001")
	if got.Commercial || got.Manufacturing || !got.Spatial {
		t.Errorf("room reassignment must be spatial-only, got %+v", got)
	}
}

func TestClassify_NegativeProof_QuoteWithoutTransform_IsSynced(t *testing.T) {
	// The quote snapshot carries NO spatial evidence: design-side placement
	// data is never invented into a difference — commercial (#393 §42) or
	// spatial. The item stays synced with zero impact.
	recon := mustReconcile(t,
		domain.CommercialItemSnapshot{FurnitureInstanceID: "FI-001", Parameters: map[string]any{"widthMm": 600}},
		domain.DesignRevisionItem{
			FurnitureInstanceID: "FI-001",
			Parameters:          map[string]any{"widthMm": 600},
			Transform:           &domain.Transform3D{TranslationMm: [3]float64{5000, 0, 0}},
			RoomID:              "room-9",
		},
	)
	if recon.Items[0].Status != domain.ReconciliationStatusSynced {
		t.Fatalf("expected synced, got %s with differences %+v", recon.Items[0].Status, recon.Items[0].Differences)
	}
	if got := impactOf(t, recon, "FI-001"); !got.IsZero() {
		t.Errorf("one-sided spatial evidence must classify zero impact, got %+v", got)
	}
	if summary := classifySummary(t, recon); summary.RequiresRequote || summary.SpatialChanges != 0 {
		t.Errorf("one-sided spatial evidence must not count as spatial change, got %+v", summary)
	}
}

func TestClassify_ModeledNotQuoted_CommercialAndManufacturing(t *testing.T) {
	recon := mustReconcile(t,
		domain.CommercialItemSnapshot{},
		domain.DesignRevisionItem{FurnitureInstanceID: "FI-004", Parameters: map[string]any{"widthMm": 450}},
	)
	got := impactOf(t, recon, "FI-004")
	if !got.Commercial || !got.Manufacturing || got.Spatial {
		t.Errorf("modeled_not_quoted must be commercial+manufacturing (pending quote), got %+v", got)
	}
	if summary := classifySummary(t, recon); !summary.RequiresRequote {
		t.Errorf("modeled_not_quoted must derive requiresRequote=true")
	}
}

func TestClassify_QuotedNotModeled_CommercialOnly(t *testing.T) {
	recon := mustReconcile(t,
		domain.CommercialItemSnapshot{FurnitureInstanceID: "FI-005", Parameters: map[string]any{"widthMm": 600}},
		domain.DesignRevisionItem{},
	)
	got := impactOf(t, recon, "FI-005")
	if !got.Commercial || got.Manufacturing || got.Spatial {
		t.Errorf("quoted_not_modeled must be commercial-only (pending placement; manufacturing truth lives in design), got %+v", got)
	}
}

func TestClassify_Removed_InformationalNoImpact(t *testing.T) {
	// The removal is already recorded in the quote snapshot lifecycle itself:
	// reconciliation surfaces it, the commercial baseline already reflects it.
	recon := mustReconcile(t,
		domain.CommercialItemSnapshot{FurnitureInstanceID: "FI-006", LifecycleStatus: "removed"},
		domain.DesignRevisionItem{},
	)
	if recon.Items[0].Status != domain.ReconciliationStatusRemoved {
		t.Fatalf("expected removed, got %s", recon.Items[0].Status)
	}
	if got := impactOf(t, recon, "FI-006"); !got.IsZero() {
		t.Errorf("removed must be informational (no new impact), got %+v", got)
	}
}

func TestClassify_Conflict_BlocksRequote_FailClosed(t *testing.T) {
	recon := &domain.ReconciliationResult{
		ProjectID:        "p1",
		QuoteRevisionID:  "q1",
		DesignRevisionID: "d1",
		Summary:          domain.ReconciliationSummary{Total: 1, Conflict: 1},
		Items: []domain.ReconciliationItem{
			{FurnitureInstanceID: "FI-001", Status: domain.ReconciliationStatusConflict, Differences: []domain.StructuredDifference{}},
		},
	}
	summary := classifySummary(t, recon)
	if !summary.RequiresResolution {
		t.Errorf("conflict must set requiresResolution=true")
	}
	if summary.CanRequote {
		t.Errorf("conflict must set canRequote=false (fail-closed: no reliable truth to quote from)")
	}
	if summary.RequiresRequote {
		t.Errorf("conflict must not derive requiresRequote by itself")
	}
}

func TestClassify_MultipleImpactsCoexist(t *testing.T) {
	// One item can be commercial + manufacturing + spatial at once: a width
	// change plus a move with both-sided spatial evidence.
	recon := mustReconcile(t,
		domain.CommercialItemSnapshot{
			FurnitureInstanceID: "FI-001",
			Parameters:          map[string]any{"widthMm": 600},
			Transform:           &domain.Transform3D{TranslationMm: [3]float64{0, 0, 0}},
		},
		domain.DesignRevisionItem{
			FurnitureInstanceID: "FI-001",
			Parameters:          map[string]any{"widthMm": 800},
			Transform:           &domain.Transform3D{TranslationMm: [3]float64{900, 0, 0}},
		},
	)
	got := impactOf(t, recon, "FI-001")
	if !got.Commercial || !got.Manufacturing || !got.Spatial {
		t.Errorf("impacts are non-exclusive: expected all three, got %+v", got)
	}
}

func TestClassify_UnknownDifferencePath_FailClosed(t *testing.T) {
	if got := domain.ClassifyDifferencePath("futureSemantic.someField"); !got.Commercial || !got.Manufacturing {
		t.Errorf("unknown paths must fail closed as commercial+manufacturing, got %+v", got)
	}
}

func TestClassify_RequiresRequote_DerivedFromCommercialOnly(t *testing.T) {
	// requiresRequote is derived, never stored/user-set: manufacturing-only
	// changes surface staleness without demanding a new quote (#394 §35).
	recon := &domain.ReconciliationResult{
		ProjectID:        "p1",
		QuoteRevisionID:  "q1",
		DesignRevisionID: "d1",
		Summary:          domain.ReconciliationSummary{Total: 1, Modified: 1},
		Items: []domain.ReconciliationItem{
			{
				FurnitureInstanceID: "FI-001",
				Status:              domain.ReconciliationStatusModified,
				Differences: []domain.StructuredDifference{
					{Path: "transform.rotationDeg", QuoteValue: []float64{0, 0, 0}, DesignValue: []float64{90, 0, 0}},
				},
			},
		},
	}
	summary := classifySummary(t, recon)
	if summary.RequiresRequote {
		t.Errorf("spatial-only change must not require requote")
	}
	if summary.SpatialChanges != 1 {
		t.Errorf("expected 1 spatial change, got %d", summary.SpatialChanges)
	}
}

func TestClassify_ModifiedWithoutDifferences_FailsClosed(t *testing.T) {
	recon := &domain.ReconciliationResult{
		ProjectID:        "p1",
		QuoteRevisionID:  "q1",
		DesignRevisionID: "d1",
		Items: []domain.ReconciliationItem{
			{FurnitureInstanceID: "FI-001", Status: domain.ReconciliationStatusModified, Differences: []domain.StructuredDifference{}},
		},
	}
	if _, err := domain.ClassifyReconciliation(recon); err == nil {
		t.Errorf("modified without differences is corrupt input and must fail closed")
	}
}

func mustReconcile(t *testing.T, quoteItem domain.CommercialItemSnapshot, designItem domain.DesignRevisionItem) *domain.ReconciliationResult {
	t.Helper()
	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       "10000000-0000-0000-0000-000000000001",
		QuoteRevisionID: "20000000-0000-0000-0000-000000000001",
	}
	if quoteItem.FurnitureInstanceID != "" {
		quote.Items = []domain.CommercialItemSnapshot{quoteItem}
	}
	design := domain.DesignRevisionSnapshot{
		ProjectID:        quote.ProjectID,
		DesignRevisionID: "30000000-0000-0000-0000-000000000001",
	}
	if designItem.FurnitureInstanceID != "" {
		design.Items = []domain.DesignRevisionItem{designItem}
	}
	recon, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	return recon
}
