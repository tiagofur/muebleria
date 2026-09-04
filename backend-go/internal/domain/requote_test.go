package domain_test

import (
	"errors"
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #394 / DT-10: explicit re-quote draft builder over the exact reconciliation.

const (
	requoteProjectID = "10000000-0000-0000-0000-000000000001"
	requoteQuoteRev  = "20000000-0000-0000-0000-000000000003"
	requoteDesignRev = "30000000-0000-0000-0000-000000000005"
)

// demoSnapshots reproduces the canonical demo: Q3 accepted ↔ R5 published.
//   - FI-001 synced;
//   - FI-002 width 600 → 650 (commercial+manufacturing);
//   - FI-003 pure 1200mm move with spatial evidence on both sides;
//   - FI-004 modeled in SketchUp, never quoted.
func demoSnapshots() (domain.QuoteRevisionSnapshot, domain.DesignRevisionSnapshot) {
	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       requoteProjectID,
		QuoteRevisionID: requoteQuoteRev,
		Items: []domain.CommercialItemSnapshot{
			{
				FurnitureInstanceID: "a0000000-0000-4000-8000-000000000001",
				Parameters:          map[string]any{"widthMm": 600},
				MaterialChoices:     map[string]string{"frente": "roble"},
				LifecycleStatus:     "active",
			},
			{
				FurnitureInstanceID: "a0000000-0000-4000-8000-000000000002",
				Parameters:          map[string]any{"widthMm": 600},
				MaterialChoices:     map[string]string{"frente": "roble"},
				LifecycleStatus:     "active",
			},
			{
				FurnitureInstanceID: "a0000000-0000-4000-8000-000000000003",
				Parameters:          map[string]any{"widthMm": 900},
				LifecycleStatus:     "active",
				Transform:           &domain.Transform3D{TranslationMm: [3]float64{1000, 0, 0}},
			},
		},
	}
	design := domain.DesignRevisionSnapshot{
		ProjectID:        requoteProjectID,
		DesignRevisionID: requoteDesignRev,
		Items: []domain.DesignRevisionItem{
			{
				FurnitureInstanceID: "a0000000-0000-4000-8000-000000000001",
				Parameters:          map[string]any{"widthMm": 600},
				MaterialChoices:     map[string]string{"frente": "roble"},
			},
			{
				FurnitureInstanceID: "a0000000-0000-4000-8000-000000000002",
				Parameters:          map[string]any{"widthMm": 650},
				MaterialChoices:     map[string]string{"frente": "roble"},
			},
			{
				FurnitureInstanceID: "a0000000-0000-4000-8000-000000000003",
				Parameters:          map[string]any{"widthMm": 900},
				Transform:           &domain.Transform3D{TranslationMm: [3]float64{2200, 0, 0}},
			},
			{
				FurnitureInstanceID: "a0000000-0000-4000-8000-000000000004",
				Parameters:          map[string]any{"widthMm": 450},
				MaterialChoices:     map[string]string{"frente": "negro"},
			},
		},
	}
	return quote, design
}

func itemByID(items []domain.CommercialItemSnapshot, id string) (domain.CommercialItemSnapshot, bool) {
	for _, item := range items {
		if item.FurnitureInstanceID == id {
			return item, true
		}
	}
	return domain.CommercialItemSnapshot{}, false
}

func TestBuildRequoteDraft_DemoScenario(t *testing.T) {
	quote, design := demoSnapshots()
	quoteBefore, designBefore := demoSnapshots()

	recon, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	draft, err := domain.BuildRequoteDraft(quote, design, recon, domain.RequotePlan{})
	if err != nil {
		t.Fatalf("BuildRequoteDraft: %v", err)
	}

	if len(draft.Items) != 4 {
		t.Fatalf("expected 4 items in the draft, got %d: %+v", len(draft.Items), draft.Items)
	}

	// FI-001 stays synced: quoted values verbatim.
	fi001, ok := itemByID(draft.Items, "a0000000-0000-4000-8000-000000000001")
	if !ok || fi001.Parameters["widthMm"] != 600 {
		t.Errorf("FI-001 must keep its quoted values, got %+v", fi001)
	}

	// FI-002 incorporates the design truth: width 650, SAME identity.
	fi002, ok := itemByID(draft.Items, "a0000000-0000-4000-8000-000000000002")
	if !ok || fi002.Parameters["widthMm"] != 650 {
		t.Errorf("FI-002 must incorporate the design width 650, got %+v", fi002)
	}

	// FI-003 pure move: nothing commercial to incorporate — quoted values
	// verbatim, and the placement never leaks into the commercial snapshot.
	fi003, ok := itemByID(draft.Items, "a0000000-0000-4000-8000-000000000003")
	if !ok || fi003.Parameters["widthMm"] != 900 || fi003.Transform != nil {
		t.Errorf("FI-003 must stay spatial-only out of the commercial snapshot, got %+v", fi003)
	}

	// FI-004 modeled-not-quoted gets quoted with the SAME identity — no new
	// FurnitureInstance is ever minted.
	fi004, ok := itemByID(draft.Items, "a0000000-0000-4000-8000-000000000004")
	if !ok || fi004.Parameters["widthMm"] != 450 || fi004.MaterialChoices["frente"] != "negro" {
		t.Errorf("FI-004 must be incorporated from the design with its identity, got %+v", fi004)
	}

	wantIncorporated := []string{
		"a0000000-0000-4000-8000-000000000002",
		"a0000000-0000-4000-8000-000000000004",
	}
	if !reflect.DeepEqual(draft.IncorporatedInstanceIDs, wantIncorporated) {
		t.Errorf("incorporated = %v, want %v", draft.IncorporatedInstanceIDs, wantIncorporated)
	}

	// Identity preservation: the draft reuses exactly the input identities.
	for _, item := range draft.Items {
		if item.FurnitureInstanceID == "" {
			t.Errorf("draft item without furnitureInstanceId: %+v", item)
		}
	}

	// Purity: the builder never mutates its inputs (the accepted quote stays
	// exactly as it was).
	if !reflect.DeepEqual(quote, quoteBefore) {
		t.Errorf("BuildRequoteDraft mutated the quote snapshot input")
	}
	if !reflect.DeepEqual(design, designBefore) {
		t.Errorf("BuildRequoteDraft mutated the design snapshot input")
	}
}

func TestBuildRequoteDraft_ConflictBlocked(t *testing.T) {
	recon := &domain.ReconciliationResult{
		ProjectID:        requoteProjectID,
		QuoteRevisionID:  requoteQuoteRev,
		DesignRevisionID: requoteDesignRev,
		Summary:          domain.ReconciliationSummary{Total: 1, Conflict: 1},
		Items: []domain.ReconciliationItem{
			{FurnitureInstanceID: "FI-001", Status: domain.ReconciliationStatusConflict, Differences: []domain.StructuredDifference{}},
		},
	}
	_, err := domain.BuildRequoteDraft(domain.QuoteRevisionSnapshot{ProjectID: requoteProjectID, QuoteRevisionID: requoteQuoteRev}, domain.DesignRevisionSnapshot{ProjectID: requoteProjectID, DesignRevisionID: requoteDesignRev}, recon, domain.RequotePlan{})
	if !errors.Is(err, domain.ErrRequoteBlockedByConflict) {
		t.Errorf("conflicts must block the requote fail-closed, got %v", err)
	}
}

func TestBuildRequoteDraft_NoCommercialChange_Rejected(t *testing.T) {
	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       requoteProjectID,
		QuoteRevisionID: requoteQuoteRev,
		Items: []domain.CommercialItemSnapshot{
			{FurnitureInstanceID: "FI-001", Parameters: map[string]any{"widthMm": 600}},
		},
	}
	design := domain.DesignRevisionSnapshot{
		ProjectID:        requoteProjectID,
		DesignRevisionID: requoteDesignRev,
		Items: []domain.DesignRevisionItem{
			{FurnitureInstanceID: "FI-001", Parameters: map[string]any{"widthMm": 600}},
		},
	}
	recon, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	if _, err := domain.BuildRequoteDraft(quote, design, recon, domain.RequotePlan{}); !errors.Is(err, domain.ErrRequoteNoCommercialChange) {
		t.Errorf("fully synced inputs must reject the requote, got %v", err)
	}
}

func TestBuildRequoteDraft_SpatialOnlyRejected_NeverCreatesRevision(t *testing.T) {
	// Negative proof (#394 §34): a pure move must NEVER silently create a
	// new commercial revision.
	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       requoteProjectID,
		QuoteRevisionID: requoteQuoteRev,
		Items: []domain.CommercialItemSnapshot{
			{
				FurnitureInstanceID: "FI-001",
				Parameters:          map[string]any{"widthMm": 600},
				Transform:           &domain.Transform3D{TranslationMm: [3]float64{0, 0, 0}},
			},
		},
	}
	design := domain.DesignRevisionSnapshot{
		ProjectID:        requoteProjectID,
		DesignRevisionID: requoteDesignRev,
		Items: []domain.DesignRevisionItem{
			{
				FurnitureInstanceID: "FI-001",
				Parameters:          map[string]any{"widthMm": 600},
				Transform:           &domain.Transform3D{TranslationMm: [3]float64{1200, 0, 0}},
			},
		},
	}
	recon, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	if _, err := domain.BuildRequoteDraft(quote, design, recon, domain.RequotePlan{}); !errors.Is(err, domain.ErrRequoteNoCommercialChange) {
		t.Errorf("spatial-only change must reject the requote, got %v", err)
	}
}

func TestBuildRequoteDraft_SelectionKeepsQuotedValues(t *testing.T) {
	quote, design := demoSnapshots()
	recon, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	// Explicit decision: incorporate ONLY the new modeled unit FI-004; the
	// FI-002 width change stays as quoted.
	plan := domain.RequotePlan{Include: map[string]bool{"a0000000-0000-4000-8000-000000000004": true}}
	draft, err := domain.BuildRequoteDraft(quote, design, recon, plan)
	if err != nil {
		t.Fatalf("BuildRequoteDraft: %v", err)
	}
	fi002, ok := itemByID(draft.Items, "a0000000-0000-4000-8000-000000000002")
	if !ok || fi002.Parameters["widthMm"] != 600 {
		t.Errorf("unselected FI-002 must keep the quoted width 600, got %+v", fi002)
	}
	fi004, ok := itemByID(draft.Items, "a0000000-0000-4000-8000-000000000004")
	if !ok || fi004.Parameters["widthMm"] != 450 {
		t.Errorf("selected FI-004 must be incorporated, got %+v", fi004)
	}
	if len(draft.IncorporatedInstanceIDs) != 1 {
		t.Errorf("expected only FI-004 incorporated, got %v", draft.IncorporatedInstanceIDs)
	}
}

func TestBuildRequoteDraft_SelectionExcludesModeledNotQuoted(t *testing.T) {
	quote, design := demoSnapshots()
	recon, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	plan := domain.RequotePlan{Include: map[string]bool{"a0000000-0000-4000-8000-000000000002": true}}
	draft, err := domain.BuildRequoteDraft(quote, design, recon, plan)
	if err != nil {
		t.Fatalf("BuildRequoteDraft: %v", err)
	}
	if _, exists := itemByID(draft.Items, "a0000000-0000-4000-8000-000000000004"); exists {
		t.Errorf("unselected modeled_not_quoted unit must stay out of the draft")
	}
}

func TestBuildRequoteDraft_EmptySelectionRejected(t *testing.T) {
	quote, design := demoSnapshots()
	recon, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	plan := domain.RequotePlan{Include: map[string]bool{}}
	if _, err := domain.BuildRequoteDraft(quote, design, recon, plan); !errors.Is(err, domain.ErrRequoteNoCommercialChange) {
		t.Errorf("a selection that incorporates nothing must reject the requote, got %v", err)
	}
}

func TestBuildRequoteDraft_QuotedNotModeledKept(t *testing.T) {
	// A sold unit absent from the design is never deleted from the
	// commercial snapshot (pending placement, not a price change).
	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       requoteProjectID,
		QuoteRevisionID: requoteQuoteRev,
		Items: []domain.CommercialItemSnapshot{
			{FurnitureInstanceID: "FI-SOLD", Parameters: map[string]any{"widthMm": 700}, LifecycleStatus: "active"},
		},
	}
	design := domain.DesignRevisionSnapshot{
		ProjectID:        requoteProjectID,
		DesignRevisionID: requoteDesignRev,
		Items: []domain.DesignRevisionItem{
			{FurnitureInstanceID: "FI-NEW", Parameters: map[string]any{"widthMm": 300}},
		},
	}
	recon, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	draft, err := domain.BuildRequoteDraft(quote, design, recon, domain.RequotePlan{})
	if err != nil {
		t.Fatalf("BuildRequoteDraft: %v", err)
	}
	sold, ok := itemByID(draft.Items, "FI-SOLD")
	if !ok || sold.Parameters["widthMm"] != 700 {
		t.Errorf("quoted_not_modeled unit must be carried verbatim, got %+v ok=%v", sold, ok)
	}
}

func TestBuildRequoteDraft_RemovedKeptWithLifecycle(t *testing.T) {
	quote := domain.QuoteRevisionSnapshot{
		ProjectID:       requoteProjectID,
		QuoteRevisionID: requoteQuoteRev,
		Items: []domain.CommercialItemSnapshot{
			{FurnitureInstanceID: "FI-GONE", LifecycleStatus: "cancelled"},
			{FurnitureInstanceID: "FI-001", Parameters: map[string]any{"widthMm": 600}},
		},
	}
	design := domain.DesignRevisionSnapshot{
		ProjectID:        requoteProjectID,
		DesignRevisionID: requoteDesignRev,
		Items: []domain.DesignRevisionItem{
			{FurnitureInstanceID: "FI-001", Parameters: map[string]any{"widthMm": 800}},
		},
	}
	recon, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	draft, err := domain.BuildRequoteDraft(quote, design, recon, domain.RequotePlan{})
	if err != nil {
		t.Fatalf("BuildRequoteDraft: %v", err)
	}
	gone, ok := itemByID(draft.Items, "FI-GONE")
	if !ok || gone.LifecycleStatus != "cancelled" {
		t.Errorf("removed unit must be carried with its terminal lifecycle, got %+v ok=%v", gone, ok)
	}
}

func TestBuildRequoteDraft_InconsistentReconciliationRejected(t *testing.T) {
	quote, design := demoSnapshots()
	recon, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	recon.QuoteRevisionID = "40000000-0000-0000-0000-000000000099"
	if _, err := domain.BuildRequoteDraft(quote, design, recon, domain.RequotePlan{}); !errors.Is(err, domain.ErrRequoteInconsistentInput) {
		t.Errorf("mismatched reconciliation must be rejected, got %v", err)
	}
}

func TestBuildRequoteDraft_DesignValuesAreCommercialOnly(t *testing.T) {
	// Transform, room and technical locators never leak into the draft even
	// when the design item carries them (#394 §20).
	quote, design := demoSnapshots()
	recon, err := domain.Reconcile(quote, design)
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	draft, err := domain.BuildRequoteDraft(quote, design, recon, domain.RequotePlan{})
	if err != nil {
		t.Fatalf("BuildRequoteDraft: %v", err)
	}
	for _, item := range draft.Items {
		if item.Transform != nil || item.RoomID != "" {
			t.Errorf("draft item %s leaked spatial data into the commercial snapshot: %+v", item.FurnitureInstanceID, item)
		}
	}
}
