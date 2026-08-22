package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestJobCostingFixtureParity validates parity with
// contracts/jobCosting.json (OC-080..OC-084, issue #304).
func TestJobCostingFixtureParity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "jobCosting.json"))
	if err != nil {
		t.Fatalf("read contracts/jobCosting.json: %v", err)
	}
	var fixture struct {
		TimeEntryCategories         []string          `json:"timeEntryCategories"`
		RejectedTimeEntryCategories []string          `json:"rejectedTimeEntryCategories"`
		OtherCostKinds              []string          `json:"otherCostKinds"`
		RejectedOtherCostKinds      []string          `json:"rejectedOtherCostKinds"`
		MaterialValuationBases      []string          `json:"materialValuationBases"`
		MaterialValuationTruth      map[string]string `json:"materialValuationTruth"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse contracts/jobCosting.json: %v", err)
	}

	assertFixtureSetParity(t, "timeEntryCategories", fixture.TimeEntryCategories, timeEntryCategories, IsValidTimeEntryCategory)
	assertFixtureSetParity(t, "otherCostKinds", fixture.OtherCostKinds, otherCostKinds, IsValidOtherCostKind)

	for _, rejected := range fixture.RejectedTimeEntryCategories {
		if IsValidTimeEntryCategory(rejected) {
			t.Errorf("fixture rejected timeEntryCategory %q must be invalid in Go", rejected)
		}
	}
	for _, rejected := range fixture.RejectedOtherCostKinds {
		if IsValidOtherCostKind(rejected) {
			t.Errorf("fixture rejected otherCostKind %q must be invalid in Go", rejected)
		}
	}

	// Valuation bases + truth semantics mirror the fixture exactly.
	for _, basis := range fixture.MaterialValuationBases {
		switch MaterialValuationBasis(basis) {
		case ValuationBasisPOUnitCost, ValuationBasisCatalog:
		default:
			t.Errorf("fixture materialValuationBasis %q missing from Go", basis)
		}
	}
	wantTruth := map[string]CostTruth{}
	for basis, truth := range fixture.MaterialValuationTruth {
		wantTruth[basis] = CostTruth(truth)
	}
	if wantTruth["po_unit_cost"] != CostTruthActual || wantTruth["catalog"] != CostTruthProxy {
		t.Errorf("materialValuationTruth mismatch: %+v", wantTruth)
	}
}

// TestBuildCostBaselineFreezesSnapshotAndRelease mirrors the TS test of
// captureCostBaseline (OC-080): revenue, full estimated breakdown, expected
// margin and traceable sources.
func TestBuildCostBaselineFreezesSnapshotAndRelease(t *testing.T) {
	snapshot := &QuotePriceSnapshot{
		CapturedAt: time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC),
		Breakdown: QuoteBreakdown{
			MaterialsCost: 100, EdgeTotal: 20, HardwareTotal: 30, DirectCost: 150,
			LaborModular: 50, LaborFixedCost: 10, MarginFactor: 1.3, SalePrice: 400,
		},
	}
	release := &ProductionRelease{
		ID: "rel-1", ProjectID: "p1", ProjectVersion: 3, DesignRevisionID: "dr-1",
		BOMFingerprint: "fp-aaa", ReleasedBy: "ing-1", ReleasedAt: time.Date(2026, 8, 20, 11, 0, 0, 0, time.UTC),
	}

	baseline, err := BuildCostBaseline(nil, snapshot, release, "p1", "mgr-1", time.Date(2026, 8, 21, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("BuildCostBaseline: %v", err)
	}
	if baseline.Revenue != 400 {
		t.Errorf("revenue = %v, want 400", baseline.Revenue)
	}
	if baseline.EstimatedDirectCost != 210 {
		t.Errorf("estimatedDirectCost = %v, want 210", baseline.EstimatedDirectCost)
	}
	if baseline.ExpectedGrossMargin != 190 || baseline.ExpectedMarginPercent != 47.5 {
		t.Errorf("expected margin = %v/%v, want 190/47.5", baseline.ExpectedGrossMargin, baseline.ExpectedMarginPercent)
	}
	if baseline.Source.ReleaseID != "rel-1" || baseline.Source.BOMFingerprint != "fp-aaa" || baseline.Source.ProjectVersion != 3 {
		t.Errorf("baseline source not traceable: %+v", baseline.Source)
	}

	if _, err := BuildCostBaseline(nil, nil, release, "p1", "mgr-1", time.Now().UTC()); err == nil {
		t.Error("without quote snapshot the baseline must be blocked")
	}
	if _, err := BuildCostBaseline(nil, snapshot, nil, "p1", "mgr-1", time.Now().UTC()); err == nil {
		t.Error("without production release the baseline must be blocked")
	}

	existing := &JobCosting{Baseline: baseline}
	if _, err := BuildCostBaseline(existing, snapshot, release, "p1", "mgr-1", time.Now().UTC()); err == nil {
		t.Error("a baseline for the same release must not be overwritten")
	}
	reRelease := &ProductionRelease{ID: "rel-2", ProjectID: "p1", ProjectVersion: 4, BOMFingerprint: "fp-bbb"}
	next, err := BuildCostBaseline(existing, snapshot, reRelease, "p1", "mgr-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("recapture after re-release: %v", err)
	}
	if next.Source.ReleaseID != "rel-2" {
		t.Errorf("recaptured baseline must bind the new release, got %s", next.Source.ReleaseID)
	}
}

// TestValueMaterialConsumptions mirrors the TS valuation test (OC-082): real
// PO price first, catalog price as proxy, missing valuations surfaced.
func TestValueMaterialConsumptions(t *testing.T) {
	poCost := 10.0
	catalogCost := 8.0
	valuation := ValueMaterialConsumptions([]MaterialConsumptionInput{
		{MaterialID: "mat-po", Quantity: 5, POUnitCost: &poCost},
		{MaterialID: "mat-cat", Quantity: 2, CatalogUnitCost: &catalogCost},
		{MaterialID: "mat-none", Quantity: 3},
		{MaterialID: "mat-zero", Quantity: 0, POUnitCost: &poCost},
	})
	if len(valuation.Lines) != 2 {
		t.Fatalf("lines = %d, want 2", len(valuation.Lines))
	}
	if valuation.Lines[0].Basis != ValuationBasisPOUnitCost || valuation.Lines[0].Truth != CostTruthActual || valuation.Lines[0].Amount != 50 {
		t.Errorf("po line = %+v", valuation.Lines[0])
	}
	if valuation.Lines[1].Basis != ValuationBasisCatalog || valuation.Lines[1].Truth != CostTruthProxy || valuation.Lines[1].Amount != 16 {
		t.Errorf("catalog line = %+v", valuation.Lines[1])
	}
	if valuation.Total != 66 || valuation.Truth != CostTruthProxy {
		t.Errorf("total/truth = %v/%v, want 66/proxy", valuation.Total, valuation.Truth)
	}
	if len(valuation.MissingValuationMaterialIDs) != 1 || valuation.MissingValuationMaterialIDs[0] != "mat-none" {
		t.Errorf("missing = %+v", valuation.MissingValuationMaterialIDs)
	}
}

// TestComputeJobCostSummary mirrors the TS end-to-end numbers (OC-084):
// material + rework, labor at frozen rates, other costs, variance and both
// gross margins.
func TestComputeJobCostSummary(t *testing.T) {
	baseline := &CostBaseline{
		Revenue: 400, EstimatedDirectCost: 210, ExpectedGrossMargin: 190, ExpectedMarginPercent: 47.5,
	}

	poCost := 10.0
	catalogCost := 8.0
	material := ValueMaterialConsumptions([]MaterialConsumptionInput{
		{MaterialID: "mat-po", Quantity: 5, POUnitCost: &poCost},
		{MaterialID: "mat-cat", Quantity: 2, CatalogUnitCost: &catalogCost},
	})

	summary := ComputeJobCostSummary(JobCostSummaryInput{
		Baseline: baseline,
		TimeEntries: []TimeEntry{
			{ID: "t1", Category: TimeCategoryCut, Minutes: 60, RatePerHour: 30},
			{ID: "t2", Category: TimeCategoryAssembly, Minutes: 90, RatePerHour: 30},
		},
		LaborRatePerHour: 30,
		Rework:           &ReworkCostInput{MaterialCost: 12, LaborMinutes: 30},
		Material:         &material,
		OtherCosts: []OtherActualCost{
			{ID: "o1", Kind: OtherCostFreight, Amount: 80},
			{ID: "o2", Kind: OtherCostOutsource, Amount: 25},
		},
	})

	if summary.Revenue == nil || *summary.Revenue != 400 {
		t.Errorf("revenue = %v, want 400", summary.Revenue)
	}
	if summary.ActualMaterialCost != 78 || summary.ActualMaterialTruth != CostTruthProxy {
		t.Errorf("material = %v (%v), want 78 (proxy)", summary.ActualMaterialCost, summary.ActualMaterialTruth)
	}
	if summary.ActualLaborMinutes != 180 {
		t.Errorf("labor minutes = %v, want 180", summary.ActualLaborMinutes)
	}
	if summary.ActualLaborCost == nil || *summary.ActualLaborCost != 90 {
		t.Errorf("labor cost = %v, want 90", summary.ActualLaborCost)
	}
	if summary.ActualOtherCost != 105 {
		t.Errorf("other = %v, want 105", summary.ActualOtherCost)
	}
	if summary.ActualDirectCost == nil || *summary.ActualDirectCost != 273 {
		t.Errorf("direct = %v, want 273", summary.ActualDirectCost)
	}
	if summary.Variance == nil || *summary.Variance != 63 {
		t.Errorf("variance = %v, want 63", summary.Variance)
	}
	if summary.ActualGrossMargin == nil || *summary.ActualGrossMargin != 127 {
		t.Errorf("actual margin = %v, want 127", summary.ActualGrossMargin)
	}
	if summary.ActualMarginPercent == nil || *summary.ActualMarginPercent != 31.75 {
		t.Errorf("actual margin %% = %v, want 31.75", summary.ActualMarginPercent)
	}
	if summary.MinutesByCategory["cut"] != 60 || summary.MinutesByCategory["assembly"] != 90 {
		t.Errorf("minutes by category = %+v", summary.MinutesByCategory)
	}
	if summary.OtherCostByKind["freight"] != 80 {
		t.Errorf("other by kind = %+v", summary.OtherCostByKind)
	}
}

// TestComputeJobCostSummaryHonestNulls keeps the Data Truth contract: without
// a baseline revenue/estimated/variance are null; without an hourly rate the
// labor cost (and everything downstream) is null, never zero.
func TestComputeJobCostSummaryHonestNulls(t *testing.T) {
	noBaseline := ComputeJobCostSummary(JobCostSummaryInput{})
	if noBaseline.Revenue != nil || noBaseline.EstimatedDirectCost != nil ||
		noBaseline.Variance != nil || noBaseline.ExpectedGrossMargin != nil {
		t.Errorf("without baseline the summary must stay null: %+v", noBaseline)
	}

	baseline := &CostBaseline{Revenue: 400, EstimatedDirectCost: 210, ExpectedGrossMargin: 190, ExpectedMarginPercent: 47.5}
	noRate := ComputeJobCostSummary(JobCostSummaryInput{
		Baseline: baseline,
		TimeEntries: []TimeEntry{
			{ID: "t1", Category: TimeCategoryCnc, Minutes: 60, RatePerHour: 0},
		},
		LaborRatePerHour: 0,
	})
	if noRate.ActualLaborCost != nil || noRate.ActualDirectCost != nil ||
		noRate.Variance != nil || noRate.ActualGrossMargin != nil {
		t.Errorf("without a rate labor cannot be priced: %+v", noRate)
	}
	if noRate.ActualLaborMinutes != 60 {
		t.Errorf("minutes must still be visible, got %v", noRate.ActualLaborMinutes)
	}
}

// TestValidateJobCostingTransition guards the append-only/void-once
// invariants of the costing payload.
func TestValidateJobCostingTransition(t *testing.T) {
	now := time.Date(2026, 8, 21, 12, 0, 0, 0, time.UTC)
	prev := &JobCosting{
		ID: "jc-1", ProjectID: "p1", LaborRatePerHour: 30,
		TimeEntries: []TimeEntry{{ID: "t1", Category: TimeCategoryCut, Minutes: 60, RatePerHour: 30, At: now}},
		OtherCosts:  []OtherActualCost{{ID: "o1", Kind: OtherCostFreight, Amount: 80, At: now}},
	}

	if err := ValidateJobCostingTransition(prev, prev); err != nil {
		t.Fatalf("identity transition must pass: %v", err)
	}

	mutated := *prev
	mutated.TimeEntries = []TimeEntry{{ID: "t1", Category: TimeCategoryCut, Minutes: 999, RatePerHour: 30, At: now}}
	if err := ValidateJobCostingTransition(prev, &mutated); err == nil {
		t.Error("time entries are immutable")
	}

	removed := *prev
	removed.TimeEntries = nil
	if err := ValidateJobCostingTransition(prev, &removed); err == nil {
		t.Error("time entries cannot be removed")
	}

	voided := *prev
	entries := append([]TimeEntry{}, prev.TimeEntries...)
	entries[0].RemovedAt = &now
	entries[0].RemovedByUserID = "mgr-1"
	voided.TimeEntries = entries
	if err := ValidateJobCostingTransition(prev, &voided); err != nil {
		t.Errorf("a proper void must pass: %v", err)
	}
	unauthored := *prev
	unauthored.TimeEntries = append([]TimeEntry{}, prev.TimeEntries...)
	unauthored.TimeEntries[0].RemovedAt = &now
	if err := ValidateJobCostingTransition(prev, &unauthored); err == nil {
		t.Error("a void without author must be rejected")
	}
}
