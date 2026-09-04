package domain

import (
	"strings"
	"testing"
	"time"
)

// #395 / DT-11 domain proofs: manufacturing fingerprint semantics (§25
// spatial-only never implies manufacturing change), release preflight
// fail-closed behavior, the §17 commercial gate and the approval transition.

func releaseTestItem(instanceID string, params map[string]any, materials map[string]string) DesignRevisionItem {
	return DesignRevisionItem{
		FurnitureInstanceID:   instanceID,
		FurnitureDefinitionID: "11111111-1111-4111-8111-111111111111",
		DefinitionVersion:     intPtr(2),
		Parameters:            params,
		MaterialChoices:       materials,
		Transform:             &Transform3D{},
	}
}

func intPtr(v int) *int { return &v }

func TestManufacturingFingerprint_DeterministicAndOrderIndependent(t *testing.T) {
	a := releaseTestItem("fi-1", map[string]any{"width": 600.0}, map[string]string{"body": "melamina-blanca"})
	b := releaseTestItem("fi-2", map[string]any{"width": 800.0}, map[string]string{"body": "melamina-roble"})

	first, err := ManufacturingFingerprint([]DesignRevisionItem{a, b})
	if err != nil {
		t.Fatalf("first fingerprint: %v", err)
	}
	second, err := ManufacturingFingerprint([]DesignRevisionItem{b, a}) // reversed order
	if err != nil {
		t.Fatalf("second fingerprint: %v", err)
	}
	if first != second {
		t.Fatalf("fingerprint must be order independent: %s vs %s", first, second)
	}
	if !strings.HasPrefix(first, "sha256-") || len(first) != len("sha256-")+64 {
		t.Fatalf("fingerprint must be sha256-<64hex>, got %s", first)
	}

	// Identical inputs across time (fresh timestamps must not matter).
	if again, _ := ManufacturingFingerprint([]DesignRevisionItem{a, b}); again != first {
		t.Fatalf("fingerprint must be deterministic")
	}
}

func TestManufacturingFingerprint_SpatialOnlyChangeIsSameFingerprint(t *testing.T) {
	base := releaseTestItem("fi-1", map[string]any{"width": 600.0}, map[string]string{"body": "melamina-blanca"})
	moved := base
	moved.Transform = &Transform3D{TranslationMm: [3]float64{1200, 0, 0}, RotationDeg: [3]float64{0, 90, 0}}
	moved.RoomID = "room-cocina"

	baseFingerprint, err := ManufacturingFingerprint([]DesignRevisionItem{base})
	if err != nil {
		t.Fatalf("base fingerprint: %v", err)
	}
	movedFingerprint, err := ManufacturingFingerprint([]DesignRevisionItem{moved})
	if err != nil {
		t.Fatalf("moved fingerprint: %v", err)
	}
	if baseFingerprint != movedFingerprint {
		t.Fatalf("spatial-only change (transform/room) must NOT change the manufacturing fingerprint (§25): %s vs %s", baseFingerprint, movedFingerprint)
	}
}

func TestManufacturingFingerprint_ManufacturingChangeChangesFingerprint(t *testing.T) {
	base := releaseTestItem("fi-1", map[string]any{"width": 600.0}, map[string]string{"body": "melamina-blanca"})
	baseFingerprint, err := ManufacturingFingerprint([]DesignRevisionItem{base})
	if err != nil {
		t.Fatalf("base fingerprint: %v", err)
	}

	cases := map[string]DesignRevisionItem{
		"parameter change": func() DesignRevisionItem { c := base; c.Parameters = map[string]any{"width": 650.0}; return c }(),
		"material change": func() DesignRevisionItem {
			c := base
			c.MaterialChoices = map[string]string{"body": "mdf-laqueado"}
			return c
		}(),
		"definition change": func() DesignRevisionItem {
			c := base
			c.FurnitureDefinitionID = "22222222-2222-4222-8222-222222222222"
			return c
		}(),
		"definition version": func() DesignRevisionItem { c := base; c.DefinitionVersion = intPtr(3); return c }(),
		"unit added":         base,
	}
	for name, changed := range cases {
		items := []DesignRevisionItem{changed}
		if name == "unit added" {
			items = append(items, releaseTestItem("fi-2", map[string]any{"width": 800.0}, nil))
		}
		changedFingerprint, err := ManufacturingFingerprint(items)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if changedFingerprint == baseFingerprint {
			t.Fatalf("%s must change the manufacturing fingerprint", name)
		}
	}
}

func approvalTestDefinitions() map[string]FurnitureDefinitionParameters {
	return map[string]FurnitureDefinitionParameters{
		"11111111-1111-4111-8111-111111111111": {
			ParameterDefinitions: []FurnitureParameterDefinition{
				{Name: "width", Label: "Ancho", Type: FurnitureParameterTypeNumber, Required: true, Category: FurnitureParameterCategoryDimension, Min: float64Ptr(300), Max: float64Ptr(1200)},
			},
		},
	}
}

func float64Ptr(v float64) *float64 { return &v }

func TestRunManufacturingPreflight_Ready(t *testing.T) {
	items := []DesignRevisionItem{releaseTestItem("fi-1", map[string]any{"width": 600.0}, map[string]string{"body": "melamina-blanca"})}
	result := RunManufacturingPreflight("rev-1", items, approvalTestDefinitions())
	if result.Status != ManufacturingPreflightReady {
		t.Fatalf("expected ready, got %s with issues %+v", result.Status, result.Issues)
	}
	if result.Scope != ManufacturingPreflightScope {
		t.Fatalf("scope mismatch: %s", result.Scope)
	}
}

func TestRunManufacturingPreflight_EmptyRevisionBlocks(t *testing.T) {
	result := RunManufacturingPreflight("rev-1", nil, approvalTestDefinitions())
	if result.Status != ManufacturingPreflightBlocked {
		t.Fatalf("empty revision must block")
	}
	if result.Issues[0].Code != PreflightIssueEmptyRevision {
		t.Fatalf("expected empty_revision, got %s", result.Issues[0].Code)
	}
}

func TestRunManufacturingPreflight_MissingDefinitionBlocks(t *testing.T) {
	items := []DesignRevisionItem{releaseTestItem("fi-1", map[string]any{"width": 600.0}, nil)}
	result := RunManufacturingPreflight("rev-1", items, map[string]FurnitureDefinitionParameters{})
	if result.Status != ManufacturingPreflightBlocked {
		t.Fatalf("missing definition must block")
	}
	if result.Issues[0].Code != PreflightIssueMissingDefinition {
		t.Fatalf("expected missing_definition, got %s", result.Issues[0].Code)
	}
}

func TestRunManufacturingPreflight_InvalidParametersBlock(t *testing.T) {
	items := []DesignRevisionItem{
		releaseTestItem("fi-1", map[string]any{"width": 9999.0}, nil),        // above max 1200
		releaseTestItem("fi-2", map[string]any{"width": "seiscientos"}, nil), // wrong type
	}
	result := RunManufacturingPreflight("rev-1", items, approvalTestDefinitions())
	if result.Status != ManufacturingPreflightBlocked {
		t.Fatalf("invalid parameters must block")
	}
	if len(result.Issues) != 2 {
		t.Fatalf("expected one issue per invalid item, got %+v", result.Issues)
	}
	for _, issue := range result.Issues {
		if issue.Code != PreflightIssueInvalidParameters {
			t.Fatalf("expected invalid_parameters, got %s", issue.Code)
		}
	}
}

func TestRunManufacturingPreflight_DuplicateInstanceBlocks(t *testing.T) {
	items := []DesignRevisionItem{
		releaseTestItem("fi-1", map[string]any{"width": 600.0}, nil),
		releaseTestItem("fi-1", map[string]any{"width": 800.0}, nil),
	}
	result := RunManufacturingPreflight("rev-1", items, approvalTestDefinitions())
	if result.Status != ManufacturingPreflightBlocked {
		t.Fatalf("duplicate instance identity must block (§17 ambiguous IDs)")
	}
}

func TestRunManufacturingPreflight_EmptyMaterialChoiceBlocks(t *testing.T) {
	items := []DesignRevisionItem{releaseTestItem("fi-1", map[string]any{"width": 600.0}, map[string]string{"body": ""})}
	result := RunManufacturingPreflight("rev-1", items, approvalTestDefinitions())
	if result.Status != ManufacturingPreflightBlocked {
		t.Fatalf("empty material value must block")
	}
	if result.Issues[0].Code != PreflightIssueInvalidMaterialUse {
		t.Fatalf("expected invalid_material_choice, got %s", result.Issues[0].Code)
	}
}

func TestRunManufacturingPreflight_LegacyModuleDimensionProjection(t *testing.T) {
	// Legacy modules persist NO parameter definitions: their published
	// contract is the width/height/depth projection (#483). Dimensions must
	// validate; unknown parameter names must still fail closed.
	legacy := map[string]FurnitureDefinitionParameters{
		"11111111-1111-4111-8111-111111111111": {ParameterDefinitions: nil},
	}
	dimensions := releaseTestItem("fi-1", map[string]any{"widthMm": 600.0, "heightMm": 720.0}, nil)
	if result := RunManufacturingPreflight("rev-1", []DesignRevisionItem{dimensions}, legacy); result.Status != ManufacturingPreflightReady {
		t.Fatalf("legacy module dimensions must validate through the projection, got %s: %+v", result.Status, result.Issues)
	}

	fractional := releaseTestItem("fi-1", map[string]any{"widthMm": 600.5}, nil)
	if result := RunManufacturingPreflight("rev-1", []DesignRevisionItem{fractional}, legacy); result.Status != ManufacturingPreflightBlocked {
		t.Fatalf("fractional millimeters must fail the integer mm projection")
	}

	unknown := releaseTestItem("fi-1", map[string]any{"color": "rojo"}, nil)
	if result := RunManufacturingPreflight("rev-1", []DesignRevisionItem{unknown}, legacy); result.Status != ManufacturingPreflightBlocked {
		t.Fatalf("undeclared parameter names must fail closed even on legacy modules")
	}
}

func TestEvaluateReleaseCommercialGate(t *testing.T) {
	classification := func(summary ImpactClassificationSummary) *ImpactClassificationResult {
		return &ImpactClassificationResult{
			ProjectID:        "p1",
			QuoteRevisionID:  "q1",
			DesignRevisionID: "r1",
			Summary:          summary,
		}
	}

	if err := EvaluateReleaseCommercialGate(nil); err != nil {
		t.Fatalf("no commercial baseline (design-first) must not gate: %v", err)
	}
	if err := EvaluateReleaseCommercialGate(classification(ImpactClassificationSummary{CanRequote: true})); err != nil {
		t.Fatalf("clean classification must release: %v", err)
	}
	spatialOnly := ImpactClassificationSummary{CanRequote: true, SpatialChanges: 2}
	if err := EvaluateReleaseCommercialGate(classification(spatialOnly)); err != nil {
		t.Fatalf("spatial-only changes must release (§25): %v", err)
	}

	conflict := classification(ImpactClassificationSummary{RequiresResolution: true})
	var conflictErr *ReleaseCommercialGateError
	if err := EvaluateReleaseCommercialGate(conflict); !errorsAs(err, &conflictErr) || conflictErr.Cause != ReleaseBlockerReconciliationConflict {
		t.Fatalf("conflicts must block with reconciliation_conflict, got %v", err)
	}
	outdated := classification(ImpactClassificationSummary{RequiresRequote: true, CommercialChanges: 1})
	var outdatedErr *ReleaseCommercialGateError
	if err := EvaluateReleaseCommercialGate(outdated); !errorsAs(err, &outdatedErr) || outdatedErr.Cause != ReleaseBlockerCommercialOutdated {
		t.Fatalf("pending commercial changes must block with commercial_baseline_outdated, got %v", err)
	}
}

func errorsAs(err error, target **ReleaseCommercialGateError) bool {
	if e, ok := err.(*ReleaseCommercialGateError); ok {
		*target = e
		return true
	}
	return false
}

func TestValidateDesignRevisionApproval(t *testing.T) {
	if err := ValidateDesignRevisionApproval(DesignRevisionStatusPublished); err != nil {
		t.Fatalf("published must be approvable: %v", err)
	}
	if err := ValidateDesignRevisionApproval(DesignRevisionStatusApproved); err != nil {
		t.Fatalf("approved replay must be an idempotent no-op, not an error: %v", err)
	}
	if err := ValidateDesignRevisionApproval(DesignRevisionStatusSuperseded); err == nil {
		t.Fatalf("superseded history must never approve")
	}
}

func TestManufacturingFingerprint_NilMapsAreStable(t *testing.T) {
	item := releaseTestItem("fi-1", nil, nil)
	item.Parameters = nil
	item.MaterialChoices = nil
	fingerprint, err := ManufacturingFingerprint([]DesignRevisionItem{item})
	if err != nil {
		t.Fatalf("nil maps must be treated as empty deterministically: %v", err)
	}
	if fingerprint == "" {
		t.Fatalf("fingerprint must not be empty")
	}
	_ = time.Time{}
}
