package engine

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// authoringCabinetCatalog builds the #477 fixture cabinet: classic body
// (sides/floor/top/back), one overlay door carrying a hinge + handle, and one
// movable internal shelf (interno placement) — the surface the rich authoring
// resolve exercises. Hardware covers the joinery codes the shelf-support rule
// references plus two hinge definitions with different cup diameters.
func authoringCabinetCatalog() (domain.Module, domain.Catalog) {
	lateral := domain.Component{
		ID: "comp-side", Code: "LAT", Name: "Lateral", Placement: domain.PlacementLateralIzquierdo,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"LATERAL"},
		LengthFormula: "PH - 2*T", WidthFormula: "PD", Active: true,
	}
	right := lateral
	right.ID = "comp-side-r"
	right.Placement = domain.PlacementLateralDerecho
	floor := domain.Component{
		ID: "comp-base", Code: "PISO", Name: "Piso", Placement: domain.PlacementBase,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"INTERIOR"},
		LengthFormula: "PW - 2*T", WidthFormula: "PD - T", Active: true,
	}
	top := floor
	top.ID = "comp-top"
	top.Placement = domain.PlacementSuperior
	back := domain.Component{
		ID: "comp-back", Code: "FONDO", Name: "Fondo", Placement: domain.PlacementTrasera,
		GeometryKind: "rectangular_board", ThicknessMm: 15, OptionRoles: []string{"FONDO"},
		LengthFormula: "PW - 2*T", WidthFormula: "PH - 2*T", Active: true,
	}
	door := domain.Component{
		ID: "comp-door", Code: "PTA", Name: "Puerta", Placement: domain.PlacementPuerta,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"FRENTE"},
		LengthFormula: "PH - 4", WidthFormula: "PW - 4", Active: true,
	}
	shelf := domain.Component{
		ID: "comp-shelf", Code: "ENTRE", Name: "Entrepaño", Placement: domain.PlacementInterno,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"INTERIOR"},
		LengthFormula: "PW - 2*T", WidthFormula: "PD - T", Active: true,
	}

	handle := domain.Hardware{
		ID: "hw-handle", Code: "MAN-160", Name: "Manija 160", Unit: domain.UnitPiece, Active: true,
		PreviewShape: strPtr("bar-pull"), PreviewSizeMm: floatPtr(160),
		PreviewProjectionMm: floatPtr(37), PreviewDiameterMm: floatPtr(32),
	}
	hinge := domain.Hardware{
		ID: "hw-hinge", Code: "BIS-CL110", Name: "Bisagra CL110", Unit: domain.UnitPiece, Active: true,
		PreviewShape: strPtr("hinge"), PreviewSizeMm: floatPtr(96),
		PreviewProjectionMm: floatPtr(25), PreviewDiameterMm: floatPtr(35),
	}
	hingeB := domain.Hardware{
		ID: "hw-hinge-b", Code: "BIS-CL100", Name: "Bisagra CL100", Unit: domain.UnitPiece, Active: true,
		PreviewShape: strPtr("hinge"), PreviewSizeMm: floatPtr(80),
		PreviewProjectionMm: floatPtr(22), PreviewDiameterMm: floatPtr(32),
	}
	minifix := domain.Hardware{
		ID: "hw-minifix", Code: "HER-MIN-15", Name: "Minifix 15", Unit: domain.UnitPiece, Active: true,
	}
	dowel := domain.Hardware{
		ID: "hw-dowel", Code: "HER-TAQ-8X30", Name: "Tarugo 8x30", Unit: domain.UnitPiece, Active: true,
	}

	structure := domain.Structure{
		ID: "st-authoring", Code: "CUERPO-BASE", Name: "Cuerpo Base", Active: true,
		Components: []domain.ComponentInstance{
			{ComponentID: "comp-side", Quantity: 1},
			{ComponentID: "comp-side-r", Quantity: 1},
			{ComponentID: "comp-base", Quantity: 1},
			{ComponentID: "comp-top", Quantity: 1},
			{ComponentID: "comp-back", Quantity: 1},
		},
	}
	module := domain.Module{
		ID: "mod-authoring", Code: "AUTH-600", Name: "Gabinete Authoring 600",
		WidthMm: 600, HeightMm: 720, DepthMm: 560, StructureID: "st-authoring",
		Components: []domain.ComponentInstance{
			{ComponentID: "comp-shelf", Quantity: 1},
			{
				ComponentID: "comp-door", Quantity: 1,
				Overrides: &domain.ComponentInstanceOverrides{
					HardwarePlacements: []domain.HardwarePlacement{
						{HardwareID: "hw-hinge", AnchorFace: "front",
							RelativePosition: domain.HardwareRelPosition{XMm: 298, YMm: 100}},
						{HardwareID: "hw-handle", AnchorFace: "front",
							RelativePosition: domain.HardwareRelPosition{XMm: 40, YMm: 360}},
					},
				},
			},
		},
	}
	catalog := domain.Catalog{
		Structures: []domain.Structure{structure},
		Components: []domain.Component{right, lateral, floor, top, back, door, shelf},
		Hardware:   []domain.Hardware{handle, hinge, hingeB, minifix, dowel},
	}
	return module, catalog
}

func occurrence(instanceID, defID string, translation *[3]float64) AuthoringOccurrence {
	occ := AuthoringOccurrence{ComponentInstanceID: instanceID, ComponentDefinitionID: defID}
	if translation != nil {
		occ.Transform = &AuthoringOccurrenceTransform{Frame: "assembly", TranslationMm: *translation}
	}
	return occ
}

func shelfRelationship(id, shelfInstance string) AuthoringRelationship {
	return AuthoringRelationship{
		RelationshipID: id,
		Kind:           "shelf-support",
		Source:         AuthoringRelationshipAnchor{ComponentInstanceID: shelfInstance, Role: "shelf-edge"},
		Targets: []AuthoringRelationshipAnchor{
			{ComponentInstanceID: "side-left-01", Role: "inside-face"},
			{ComponentInstanceID: "side-right-01", Role: "inside-face"},
		},
	}
}

// defaultAuthoringOccurrences is the full default occurrence set the client
// echoes back (server-generated identities from the last resolve).
func defaultAuthoringOccurrences() []AuthoringOccurrence {
	return []AuthoringOccurrence{
		occurrence("side-left-01", "st-comp-side", nil),
		occurrence("side-right-01", "st-comp-side-r", nil),
		occurrence("floor-01", "st-comp-base", nil),
		occurrence("top-01", "st-comp-top", nil),
		occurrence("back-01", "st-comp-back", nil),
		occurrence("shelf-01", "mod-comp-shelf", nil),
		occurrence("door-01", "mod-comp-door", nil),
	}
}

func findBoard(layout FurnitureLayout, instanceID string) *LayoutComponent {
	for i := range layout.Components {
		if layout.Components[i].ComponentInstanceID == instanceID {
			return &layout.Components[i]
		}
	}
	return nil
}

// Scenario 1: parameter/material-only resolve keeps the exact GET layout
// semantics — the new boundary never drifts from the current endpoint.
func TestAuthoringResolveParityWithLayoutEndpointSemantics(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	choices := map[string]string{"FRENTE": "mat-oak18"}
	catalog.Materials = []domain.MaterialBoard{
		{ID: "mat-oak18", Code: "ROBLE-CLARO", Name: "Roble Claro", ThicknessMm: 18, PreviewColor: "#c4a574", Active: true},
	}

	reference, err := ResolveFurnitureLayout(module, catalog, nil, choices)
	if err != nil {
		t.Fatalf("reference layout: %v", err)
	}

	result, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, OptionChoices: choices, PrecisionMm: 0.01,
		Relationships: []AuthoringRelationship{},
	})
	if err != nil {
		t.Fatalf("authoring resolve: %v", err)
	}
	if len(result.StructuralIssues) != 0 {
		t.Fatalf("parity resolve must be accepted, got %+v", result.StructuralIssues)
	}
	if !reflect.DeepEqual(result.Layout, reference) {
		t.Fatalf("parameter/material resolve drifted from GET layout semantics:\n got %+v\nwant %+v", result.Layout, reference)
	}

	// The normalized snapshot is the complete effective state: default
	// occurrences and the materialized default placements.
	if len(result.Normalized.Components) != len(reference.Components) {
		t.Fatalf("normalized components = %d, want %d", len(result.Normalized.Components), len(reference.Components))
	}
	if len(result.Normalized.HardwarePlacements) != 2 {
		t.Fatalf("normalized placements = %d, want the definition hinge + handle", len(result.Normalized.HardwarePlacements))
	}
	var hingeEcho *AuthoringManualPlacement
	for i := range result.Normalized.HardwarePlacements {
		if result.Normalized.HardwarePlacements[i].CatalogHardwareID == "hw-hinge" {
			hingeEcho = &result.Normalized.HardwarePlacements[i]
		}
	}
	if hingeEcho == nil || hingeEcho.HardwarePlacementID == "" || hingeEcho.HostComponentInstanceID != "mod-comp-door-copy-0" {
		t.Fatalf("default hinge must materialize as an echoable intent: %+v", hingeEcho)
	}
	if hingeEcho.OffsetMm != [2]float64{298, 100} {
		t.Fatalf("default hinge offsets not resolved: %+v", hingeEcho.OffsetMm)
	}
}

func TestAuthoringResolveComponentQuantityBindingChangesAuthoritativeOutput(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	min, max, step := 1.0, 5.0, 1.0
	module.ParameterDefinitions = []domain.FurnitureParameterDefinition{{
		Name: "shelfCount", Label: "Shelf count", Type: domain.FurnitureParameterTypeNumber,
		DefaultValue: float64(1), Required: true, Integer: true, Unit: domain.FurnitureParameterUnitCount,
		Category: domain.FurnitureParameterCategoryConfiguration, Min: &min, Max: &max, Step: &step,
		Binding: &domain.FurnitureParameterBinding{Version: 1, Kind: domain.FurnitureParameterBindingComponentQuantity, ComponentID: "comp-shelf",
			Relationship: &domain.FurnitureParameterRelationshipBinding{Kind: "shelf-support", SourceRole: "shelf-edge", Targets: []domain.FurnitureParameterRelationshipTarget{
				{ComponentID: "comp-side", Role: "inside-face"}, {ComponentID: "comp-side-r", Role: "inside-face"},
			}}},
	}}
	resolve := func(count float64) *AuthoringResolveResult {
		result, err := ResolveAuthoringLayout(AuthoringResolveInput{Module: module, Catalog: catalog, PrecisionMm: 0.01, EvaluatedParameters: map[string]any{"shelfCount": count}})
		if err != nil {
			t.Fatalf("resolve shelfCount=%v: %v", count, err)
		}
		if len(result.StructuralIssues) != 0 {
			t.Fatalf("resolve shelfCount=%v rejected: %+v", count, result.StructuralIssues)
		}
		return result
	}
	one, three := resolve(1), resolve(3)
	countShelves := func(result *AuthoringResolveResult) int {
		count := 0
		for _, component := range result.Layout.Components {
			if component.ComponentDefinitionID == "mod-comp-shelf" {
				count++
			}
		}
		return count
	}
	if countShelves(one) != 1 || countShelves(three) != 3 {
		t.Fatalf("bound occurrences did not follow quantity: one=%d three=%d", countShelves(one), countShelves(three))
	}
	if len(one.Normalized.Relationships) != 1 || len(three.Normalized.Relationships) != 3 {
		t.Fatalf("bound relationships did not follow quantity: one=%d three=%d", len(one.Normalized.Relationships), len(three.Normalized.Relationships))
	}
	if len(three.Machining.Operations) <= len(one.Machining.Operations) {
		t.Fatalf("machining did not expand: one=%d three=%d", len(one.Machining.Operations), len(three.Machining.Operations))
	}
	if one.Machining.ManufacturingFingerprint == three.Machining.ManufacturingFingerprint {
		t.Fatal("quantity change must invalidate manufacturing fingerprint")
	}
}

func TestAuthoringResolveComponentConditionRemovesOnlyDependentIntent(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	structure := &catalog.Structures[0]
	kept := make([]domain.ComponentInstance, 0, len(structure.Components))
	for _, instance := range structure.Components {
		if instance.ComponentID != "comp-back" {
			kept = append(kept, instance)
		}
	}
	structure.Components = kept
	module.Components = append([]domain.ComponentInstance{{ComponentID: "comp-back", Quantity: 1}}, module.Components...)
	module.ParameterDefinitions = []domain.FurnitureParameterDefinition{{
		Name: "hasBackPanel", Label: "Has back panel", Type: domain.FurnitureParameterTypeBoolean, DefaultValue: true, Required: true, Category: domain.FurnitureParameterCategoryConfiguration,
		Binding: &domain.FurnitureParameterBinding{Version: 1, Kind: domain.FurnitureParameterBindingComponentCondition, ComponentID: "comp-back"},
	}}
	resolve := func(enabled bool) *AuthoringResolveResult {
		input := AuthoringResolveInput{Module: module, Catalog: catalog, PrecisionMm: 0.01, EvaluatedParameters: map[string]any{"hasBackPanel": enabled},
			Relationships:    []AuthoringRelationship{{RelationshipID: "rel-back-dependent", Kind: "shelf-support", Source: AuthoringRelationshipAnchor{ComponentInstanceID: "mod-comp-shelf-copy-0", Role: "shelf-edge"}, Targets: []AuthoringRelationshipAnchor{{ComponentInstanceID: "mod-comp-back-copy-0", Role: "inside-face"}}}},
			ManualPlacements: []AuthoringManualPlacement{{HardwarePlacementID: "hp-back-dependent", CatalogHardwareID: "hw-minifix", HostComponentInstanceID: "mod-comp-back-copy-0", AnchorFace: "front", OffsetMm: [2]float64{100, 100}}}, ManualPlacementsPresent: true}
		result, err := ResolveAuthoringLayout(input)
		if err != nil {
			t.Fatalf("resolve condition=%v: %v", enabled, err)
		}
		if len(result.StructuralIssues) != 0 {
			t.Fatalf("condition=%v rejected: %+v", enabled, result.StructuralIssues)
		}
		retry, err := ResolveAuthoringLayout(input)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(result, retry) {
			t.Fatalf("condition=%v retry drifted", enabled)
		}
		return result
	}
	withBack, withoutBack := resolve(true), resolve(false)
	hasBack := func(result *AuthoringResolveResult) bool {
		for _, component := range result.Layout.Components {
			if component.ComponentDefinitionID == "mod-comp-back" {
				if component.ComponentInstanceID != "mod-comp-back-copy-0" {
					t.Fatalf("condition entry id is not deterministic: %s", component.ComponentInstanceID)
				}
				return true
			}
		}
		return false
	}
	if !hasBack(withBack) || hasBack(withoutBack) {
		t.Fatalf("condition did not include/exclude entry: true=%v false=%v", hasBack(withBack), hasBack(withoutBack))
	}
	if len(withBack.Normalized.Relationships) != 1 || len(withoutBack.Normalized.Relationships) != 0 {
		t.Fatalf("dependent relationships true=%d false=%d", len(withBack.Normalized.Relationships), len(withoutBack.Normalized.Relationships))
	}
	if len(withBack.Normalized.HardwarePlacements) != 1 || len(withoutBack.Normalized.HardwarePlacements) != 0 {
		t.Fatalf("dependent hardware true=%d false=%d", len(withBack.Normalized.HardwarePlacements), len(withoutBack.Normalized.HardwarePlacements))
	}
	if len(withBack.Machining.Operations) == 0 || len(withoutBack.Machining.Operations) != 0 {
		t.Fatalf("dependent machining true=%d false=%d", len(withBack.Machining.Operations), len(withoutBack.Machining.Operations))
	}
	if withBack.Machining.ManufacturingFingerprint == withoutBack.Machining.ManufacturingFingerprint {
		t.Fatal("condition must change manufacturing fingerprint")
	}
}

// Scenario 2: move shelf → the occurrence keeps its identity, the dependent
// relationship machining follows the new height, and the fingerprint moves.
func TestAuthoringResolveMoveShelf(t *testing.T) {
	module, catalog := authoringCabinetCatalog()

	resolveAt := func(z float64) *AuthoringResolveResult {
		moved := defaultAuthoringOccurrences()
		moved[5] = occurrence("shelf-01", "mod-comp-shelf", &[3]float64{18, 18, z})
		result, err := ResolveAuthoringLayout(AuthoringResolveInput{
			Module: module, Catalog: catalog, PrecisionMm: 0.01,
			Occurrences:   moved,
			Relationships: []AuthoringRelationship{shelfRelationship("rel-shelf-01", "shelf-01")},
		})
		if err != nil {
			t.Fatalf("resolve at z=%v: %v", z, err)
		}
		if len(result.StructuralIssues) != 0 {
			t.Fatalf("resolve at z=%v rejected: %+v", z, result.StructuralIssues)
		}
		return result
	}

	before, after := resolveAt(350), resolveAt(520)

	shelf := findBoard(after.Layout, "shelf-01")
	if shelf == nil || shelf.Transform.TranslationMm[2] != 520 {
		t.Fatalf("moved shelf must keep its identity at z=520: %+v", shelf)
	}
	if shelf.ComponentDefinitionID != "mod-comp-shelf" {
		t.Fatalf("moved shelf lost its template: %+v", shelf)
	}

	// Dependent machining: side-panel cam holes sit at the shelf height.
	var sideOpY float64
	for _, op := range after.Machining.Operations {
		if op.HostComponentInstanceID == "side-left-01" && op.Provenance.SourceKind == "relationship" {
			for _, hole := range op.Holes {
				if hole.Type == "minifix" {
					sideOpY = hole.YMm
				}
			}
		}
	}
	if sideOpY != 520 {
		t.Fatalf("side machining must follow the shelf to y=520, got %v", sideOpY)
	}
	if before.Machining.ManufacturingFingerprint == after.Machining.ManufacturingFingerprint {
		t.Fatal("moving a shelf must move the manufacturing fingerprint")
	}

	// The moved shelf's own end holes stay at mid-thickness (9): geometry
	// follows the effective thickness, not the client's will.
	for _, op := range after.Machining.Operations {
		if op.HostComponentInstanceID == "shelf-01" {
			for _, hole := range op.Holes {
				if hole.YMm != 9 {
					t.Fatalf("shelf end holes must stay at mid-thickness, got %v", hole.YMm)
				}
			}
		}
	}
}

// Scenario 3: add a second shelf sharing the reusable definition → distinct
// occurrence identities and independent relationships/machining.
func TestAuthoringResolveAddShelfSharedDefinition(t *testing.T) {
	module, catalog := authoringCabinetCatalog()

	snapshot := append(defaultAuthoringOccurrences(),
		occurrence("shelf-02", "mod-comp-shelf", &[3]float64{18, 18, 520}))
	result, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		Occurrences: snapshot,
		Relationships: []AuthoringRelationship{
			shelfRelationship("rel-shelf-01", "shelf-01"),
			shelfRelationship("rel-shelf-02", "shelf-02"),
		},
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(result.StructuralIssues) != 0 {
		t.Fatalf("add shelf rejected: %+v", result.StructuralIssues)
	}

	first, second := findBoard(result.Layout, "shelf-01"), findBoard(result.Layout, "shelf-02")
	if first == nil || second == nil {
		t.Fatalf("both shelves must materialize: %+v", result.Layout.Components)
	}
	if first.ComponentInstanceID == second.ComponentInstanceID {
		t.Fatal("occurrences collapsed into one identity")
	}
	if first.ComponentDefinitionID != second.ComponentDefinitionID || first.ComponentDefinitionID != "mod-comp-shelf" {
		t.Fatalf("shelves must share the reusable definition id: %q vs %q",
			first.ComponentDefinitionID, second.ComponentDefinitionID)
	}
	if second.Transform.TranslationMm[2] != 520 {
		t.Fatalf("added shelf must sit at its authored height: %+v", second)
	}

	opsByRelationship := map[string]int{}
	for _, op := range result.Machining.Operations {
		if op.Provenance.SourceKind == "relationship" {
			opsByRelationship[op.Provenance.RelationshipID]++
		}
	}
	if opsByRelationship["rel-shelf-01"] == 0 || opsByRelationship["rel-shelf-02"] == 0 {
		t.Fatalf("each occurrence must keep independent machining: %+v", opsByRelationship)
	}
}

// Scenario 4: remove shelf → only that occurrence, its relationship and its
// dependent machining disappear; the hinge machining survives untouched.
func TestAuthoringResolveRemoveShelf(t *testing.T) {
	module, catalog := authoringCabinetCatalog()

	base := defaultAuthoringOccurrences()
	result, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		Occurrences:   base,
		Relationships: []AuthoringRelationship{shelfRelationship("rel-shelf-01", "shelf-01")},
	})
	if err != nil {
		t.Fatalf("with shelf: %v", err)
	}

	removed := make([]AuthoringOccurrence, 0, len(base))
	for _, occ := range base {
		if occ.ComponentInstanceID != "shelf-01" {
			removed = append(removed, occ)
		}
	}
	after, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		Occurrences: removed,
		// The relationship dies with the occurrence: dropping it is the
		// authoring intent, and re-sending it would be orphaned anyway.
	})
	if err != nil {
		t.Fatalf("without shelf: %v", err)
	}
	if len(after.StructuralIssues) != 0 {
		t.Fatalf("removing every movable internal occurrence is valid authoring: %+v", after.StructuralIssues)
	}

	if findBoard(after.Layout, "shelf-01") != nil {
		t.Fatal("removed shelf must not materialize")
	}
	for _, op := range after.Machining.Operations {
		if op.Provenance.SourceKind == "relationship" {
			t.Fatalf("removed shelf relationship must leave no machining: %+v", op)
		}
	}
	var hingeOps int
	for _, op := range after.Machining.Operations {
		if op.Provenance.SourceKind == "manualHardwarePlacement" {
			hingeOps++
		}
	}
	if hingeOps != 1 {
		t.Fatalf("unrelated hinge machining must survive the removal, got %d ops", hingeOps)
	}
	if result.Machining.ManufacturingFingerprint == after.Machining.ManufacturingFingerprint {
		t.Fatal("removing a shelf must change the fingerprint")
	}
}

// Scenario 5: move manual hinge → hinge machining moves, shelf machining
// stays byte-identical.
func TestAuthoringResolveMoveHinge(t *testing.T) {
	module, catalog := authoringCabinetCatalog()

	hingeAt := func(offset [2]float64) *AuthoringResolveResult {
		placements := []AuthoringManualPlacement{
			{
				HardwarePlacementID: "hp-hinge-01", CatalogHardwareID: "hw-hinge",
				HostComponentInstanceID: "door-01", AnchorFace: "front",
				OffsetMm: offset,
			},
			{
				HardwarePlacementID: "hp-handle-01", CatalogHardwareID: "hw-handle",
				HostComponentInstanceID: "door-01", AnchorFace: "front",
				OffsetMm: [2]float64{40, 360},
			},
		}
		result, err := ResolveAuthoringLayout(AuthoringResolveInput{
			Module: module, Catalog: catalog, PrecisionMm: 0.01,
			Occurrences:      defaultAuthoringOccurrences(),
			Relationships:    []AuthoringRelationship{shelfRelationship("rel-shelf-01", "shelf-01")},
			ManualPlacements: placements, ManualPlacementsPresent: true,
		})
		if err != nil {
			t.Fatalf("resolve: %v", err)
		}
		if len(result.StructuralIssues) != 0 {
			t.Fatalf("moved hinge rejected: %+v", result.StructuralIssues)
		}
		return result
	}

	before, after := hingeAt([2]float64{298, 100}), hingeAt([2]float64{298, 480})

	holeAfter := func(result *AuthoringResolveResult) [2]float64 {
		for _, op := range result.Machining.Operations {
			if op.Provenance.HardwarePlacementID == "hp-hinge-01" {
				return [2]float64{op.Holes[0].XMm, op.Holes[0].YMm}
			}
		}
		return [2]float64{}
	}
	if holeAfter(before) != [2]float64{298, 100} || holeAfter(after) != [2]float64{298, 480} {
		t.Fatalf("hinge machining must follow the placement: before=%v after=%v", holeAfter(before), holeAfter(after))
	}

	// The client's own placement identity survives the round trip.
	found := false
	for _, hw := range after.Layout.Hardware {
		if hw.PlacementID == "hp-hinge-01" {
			found = true
			if hw.HostComponentInstanceID != "door-01" || hw.PlacementKind != HardwarePlacementKindManual {
				t.Fatalf("hinge placement identity lost: %+v", hw)
			}
		}
	}
	if !found {
		t.Fatal("authored hinge must render with its own placementId")
	}

	// Shelf machining stays identical: only the manual provenance group moved.
	shelfOps := func(result *AuthoringResolveResult) []ResolvedMachiningOperation {
		var ops []ResolvedMachiningOperation
		for _, op := range result.Machining.Operations {
			if op.Provenance.SourceKind == "relationship" {
				ops = append(ops, op)
			}
		}
		return ops
	}
	if !reflect.DeepEqual(shelfOps(before), shelfOps(after)) {
		t.Fatal("moving a hinge must not touch shelf machining")
	}
}

// Scenario 6: replace hinge → the new definition's asset renders and its own
// cup diameter drives the machining; BOM identity follows the selection.
func TestAuthoringResolveReplaceHinge(t *testing.T) {
	module, catalog := authoringCabinetCatalog()

	placements := func(hardwareID string) []AuthoringManualPlacement {
		return []AuthoringManualPlacement{
			{
				HardwarePlacementID: "hp-hinge-01", CatalogHardwareID: hardwareID,
				HostComponentInstanceID: "door-01", AnchorFace: "front",
				OffsetMm: [2]float64{298, 100},
			},
		}
	}
	resolveWith := func(hardwareID string) *AuthoringResolveResult {
		result, err := ResolveAuthoringLayout(AuthoringResolveInput{
			Module: module, Catalog: catalog, PrecisionMm: 0.01,
			Occurrences:      defaultAuthoringOccurrences(),
			ManualPlacements: placements(hardwareID), ManualPlacementsPresent: true,
		})
		if err != nil {
			t.Fatalf("resolve: %v", err)
		}
		if len(result.StructuralIssues) != 0 {
			t.Fatalf("replacement rejected: %+v", result.StructuralIssues)
		}
		return result
	}

	withA, withB := resolveWith("hw-hinge"), resolveWith("hw-hinge-b")

	diameter := func(result *AuthoringResolveResult) float64 {
		for _, op := range result.Machining.Operations {
			if op.Provenance.HardwarePlacementID == "hp-hinge-01" {
				return op.Holes[0].DiameterMm
			}
		}
		return 0
	}
	if diameter(withA) != 35 || diameter(withB) != 32 {
		t.Fatalf("replacement must resolve machining from the selected definition: A=%v B=%v", diameter(withA), diameter(withB))
	}
	if withA.Machining.ManufacturingFingerprint == withB.Machining.ManufacturingFingerprint {
		t.Fatal("a machining-relevant replacement must move the fingerprint")
	}

	var rendered string
	for _, hw := range withB.Layout.Hardware {
		if hw.PlacementID == "hp-hinge-01" {
			rendered = hw.HardwareID
		}
	}
	if rendered != "hw-hinge-b" {
		t.Fatalf("layout must render the selected definition, got %q", rendered)
	}
	if withB.Normalized.HardwarePlacements[0].CatalogHardwareID != "hw-hinge-b" {
		t.Fatalf("normalized snapshot must echo the replacement: %+v", withB.Normalized.HardwarePlacements)
	}
}

// Scenario 7: invalid/orphan identity → structured rejection, no partial
// accepted result.
func TestAuthoringResolveOrphanAnchorRejected(t *testing.T) {
	module, catalog := authoringCabinetCatalog()

	result, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		Occurrences: defaultAuthoringOccurrences(),
		Relationships: []AuthoringRelationship{
			shelfRelationship("rel-shelf-01", "shelf-ghost"),
		},
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(result.StructuralIssues) == 0 {
		t.Fatal("orphan anchor must reject")
	}
	if result.StructuralIssues[0].Code != "RELATIONSHIP_ORPHANED" {
		t.Fatalf("orphan anchor code = %s", result.StructuralIssues[0].Code)
	}
	if result.ValidationStatus != "" || result.Machining.ManufacturingFingerprint != "" || len(result.Normalized.Components) != 0 {
		t.Fatalf("rejected request must not carry a partial accepted result: %+v", result)
	}
}

func TestAuthoringResolveStructuralRejections(t *testing.T) {
	module, catalog := authoringCabinetCatalog()

	cases := []struct {
		name     string
		input    func() AuthoringResolveInput
		wantCode string
	}{
		{
			name: "unknown template",
			input: func() AuthoringResolveInput {
				snapshot := defaultAuthoringOccurrences()
				snapshot[5] = occurrence("shelf-01", "mod-comp-ghost", nil)
				return AuthoringResolveInput{Module: module, Catalog: catalog, Occurrences: snapshot}
			},
			wantCode: "OCCURRENCE_UNKNOWN_TEMPLATE",
		},
		{
			name: "duplicate occurrence id",
			input: func() AuthoringResolveInput {
				snapshot := append(defaultAuthoringOccurrences(), occurrence("shelf-01", "mod-comp-shelf", nil))
				return AuthoringResolveInput{Module: module, Catalog: catalog, Occurrences: snapshot}
			},
			wantCode: "OCCURRENCE_DUPLICATE_ID",
		},
		{
			name: "structural template omitted",
			input: func() AuthoringResolveInput {
				var snapshot []AuthoringOccurrence
				for _, occ := range defaultAuthoringOccurrences() {
					if occ.ComponentInstanceID != "back-01" {
						snapshot = append(snapshot, occ)
					}
				}
				return AuthoringResolveInput{Module: module, Catalog: catalog, Occurrences: snapshot}
			},
			wantCode: "SNAPSHOT_INCOMPLETE",
		},
		{
			name: "non-movable count change",
			input: func() AuthoringResolveInput {
				snapshot := append(defaultAuthoringOccurrences(), occurrence("door-02", "mod-comp-door", nil))
				return AuthoringResolveInput{Module: module, Catalog: catalog, Occurrences: snapshot}
			},
			wantCode: "OCCURRENCE_COUNT_UNSUPPORTED",
		},
		{
			name: "wrong catalog component",
			input: func() AuthoringResolveInput {
				snapshot := defaultAuthoringOccurrences()
				snapshot[5].CatalogComponentID = "comp-side"
				return AuthoringResolveInput{Module: module, Catalog: catalog, Occurrences: snapshot}
			},
			wantCode: "CATALOG_REFERENCE_MISSING",
		},
		{
			name: "unknown transform frame",
			input: func() AuthoringResolveInput {
				snapshot := defaultAuthoringOccurrences()
				snapshot[5].Transform = &AuthoringOccurrenceTransform{Frame: "project", TranslationMm: [3]float64{18, 18, 350}}
				return AuthoringResolveInput{Module: module, Catalog: catalog, Occurrences: snapshot}
			},
			wantCode: "TRANSFORM_INVALID",
		},
		{
			name: "hardware host invalid",
			input: func() AuthoringResolveInput {
				return AuthoringResolveInput{
					Module: module, Catalog: catalog, Occurrences: defaultAuthoringOccurrences(),
					ManualPlacements: []AuthoringManualPlacement{{
						HardwarePlacementID: "hp-hinge-01", CatalogHardwareID: "hw-hinge",
						HostComponentInstanceID: "door-ghost", AnchorFace: "front",
					}},
					ManualPlacementsPresent: true,
				}
			},
			wantCode: "HARDWARE_HOST_INVALID",
		},
		{
			name: "hardware reference invalid",
			input: func() AuthoringResolveInput {
				return AuthoringResolveInput{
					Module: module, Catalog: catalog, Occurrences: defaultAuthoringOccurrences(),
					ManualPlacements: []AuthoringManualPlacement{{
						HardwarePlacementID: "hp-hinge-01", CatalogHardwareID: "hw-ghost",
						HostComponentInstanceID: "door-01", AnchorFace: "front",
					}},
					ManualPlacementsPresent: true,
				}
			},
			wantCode: "HARDWARE_REFERENCE_INVALID",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := ResolveAuthoringLayout(tc.input())
			if err != nil {
				t.Fatalf("resolve: %v", err)
			}
			if len(result.StructuralIssues) == 0 {
				t.Fatal("expected structural rejection")
			}
			if result.StructuralIssues[0].Code != tc.wantCode {
				t.Fatalf("code = %s, want %s", result.StructuralIssues[0].Code, tc.wantCode)
			}
		})
	}
}

// Order insensitivity: reordering the occurrence array must not change which
// occurrence takes which default pose slot (identity follows the ID, not the
// position) and the resolve must be byte-deterministic across retries.
func TestAuthoringResolveDeterministicAndOrderInsensitive(t *testing.T) {
	module, catalog := authoringCabinetCatalog()

	snapshot := defaultAuthoringOccurrences()
	snapshot[5] = occurrence("shelf-01", "mod-comp-shelf", &[3]float64{18, 18, 520})
	snapshot = append(snapshot, occurrence("shelf-02", "mod-comp-shelf", nil))
	input := AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		Occurrences: snapshot,
		Relationships: []AuthoringRelationship{
			shelfRelationship("rel-shelf-01", "shelf-01"),
			shelfRelationship("rel-shelf-02", "shelf-02"),
		},
	}

	first, err := ResolveAuthoringLayout(input)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	second, err := ResolveAuthoringLayout(input)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	firstJSON, _ := json.Marshal(first)
	secondJSON, _ := json.Marshal(second)
	if string(firstJSON) != string(secondJSON) {
		t.Fatal("stateless retries must be byte-deterministic")
	}

	// Reversed occurrence order: shelf-02 (un-authored) still takes the
	// default slot 0 (z=150) and identities do not swap.
	reversed := make([]AuthoringOccurrence, len(snapshot))
	for i, occ := range snapshot {
		reversed[len(snapshot)-1-i] = occ
	}
	reversedInput := input
	reversedInput.Occurrences = reversed
	reversedResult, err := ResolveAuthoringLayout(reversedInput)
	if err != nil {
		t.Fatalf("reversed resolve: %v", err)
	}
	if !reflect.DeepEqual(reversedResult.Layout, first.Layout) {
		t.Fatal("occurrence array order must not change the resolved layout")
	}
	if !reflect.DeepEqual(reversedResult.Machining, first.Machining) {
		t.Fatal("occurrence array order must not change machining")
	}
	if findBoard(first.Layout, "shelf-02").Transform.TranslationMm[2] != 150 {
		t.Fatalf("un-authored shelf must take the default pose slot: %+v", findBoard(first.Layout, "shelf-02"))
	}
}

// Drilling conflict: a pilot deeper than the host board's effective thickness
// blocks preflight without rejecting the resolve.
func TestAuthoringResolveDrillingConflictBlocksPreflight(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	// A 12mm door board (FRENTE choice) cannot host the 12.5mm hinge pilot.
	catalog.Materials = []domain.MaterialBoard{
		{ID: "mat-thin12", Code: "FINO-12", Name: "Fino 12", ThicknessMm: 12, Active: true},
	}

	result, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, OptionChoices: map[string]string{"FRENTE": "mat-thin12"}, PrecisionMm: 0.01,
		Occurrences: defaultAuthoringOccurrences(),
		ManualPlacements: []AuthoringManualPlacement{{
			HardwarePlacementID: "hp-hinge-01", CatalogHardwareID: "hw-hinge",
			HostComponentInstanceID: "door-01", AnchorFace: "front",
		}},
		ManualPlacementsPresent: true,
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(result.StructuralIssues) != 0 {
		t.Fatalf("drilling conflict is manufacturing, not structural: %+v", result.StructuralIssues)
	}
	if result.ValidationStatus != AuthoringValidationBlocked {
		t.Fatalf("preflight = %s, want blocked", result.ValidationStatus)
	}
	found := false
	for _, issue := range result.ValidationIssues {
		if issue.Code == "DRILLING_CONFLICT" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a DRILLING_CONFLICT issue: %+v", result.ValidationIssues)
	}
}

// Real drilling collision (#468): placing a hardware hole (e.g. hinge on side-left-01)
// into the shelf-joint drilling zone produces DRILLING_CONFLICT and blocks preflight.
// Moving the hinge away clears the conflict, leaving shelf machining untouched.
func TestAuthoringResolveHoleCollisionBetweenHingeAndShelfBlocksPreflight(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	collidingInput := AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		Occurrences: defaultAuthoringOccurrences(),
		Relationships: []AuthoringRelationship{
			shelfRelationship("rel-shelf-1", "shelf-01"),
		},
		ManualPlacements: []AuthoringManualPlacement{
			{
				HardwarePlacementID:     "hp-hinge-top",
				CatalogHardwareID:       "hw-hinge",
				HostComponentInstanceID: "side-left-01",
				AnchorFace:              "front",
				OffsetMm:                [2]float64{50, 150},
			},
		},
		ManualPlacementsPresent: true,
	}
	result, err := ResolveAuthoringLayout(collidingInput)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if result.ValidationStatus != AuthoringValidationBlocked {
		t.Fatalf("validation status = %s, want blocked", result.ValidationStatus)
	}
	var conflictIssue *domain.ContractIssue
	for i := range result.ValidationIssues {
		if result.ValidationIssues[i].Code == "DRILLING_CONFLICT" {
			conflictIssue = &result.ValidationIssues[i]
			break
		}
	}
	if conflictIssue == nil {
		t.Fatalf("expected DRILLING_CONFLICT issue, got: %+v", result.ValidationIssues)
	}

	var shelfOpsUnderCollision []ResolvedMachiningOperation
	for _, op := range result.Machining.Operations {
		if op.Provenance.SourceKind == "relationship" {
			shelfOpsUnderCollision = append(shelfOpsUnderCollision, op)
		}
	}
	if len(shelfOpsUnderCollision) == 0 {
		t.Fatalf("shelf machining must not be deleted under collision")
	}

	// Move hinge away to offset [50, 300] (away from the shelf at y=150)
	resolvedInput := collidingInput
	resolvedInput.ManualPlacements = []AuthoringManualPlacement{
		{
			HardwarePlacementID:     "hp-hinge-top",
			CatalogHardwareID:       "hw-hinge",
			HostComponentInstanceID: "side-left-01",
			AnchorFace:              "front",
			OffsetMm:                [2]float64{50, 300},
		},
	}
	clearedResult, err := ResolveAuthoringLayout(resolvedInput)
	if err != nil {
		t.Fatalf("resolve cleared: %v", err)
	}
	if clearedResult.ValidationStatus != AuthoringValidationClear {
		t.Fatalf("validation status = %s, want clear; issues: %+v", clearedResult.ValidationStatus, clearedResult.ValidationIssues)
	}
	for _, issue := range clearedResult.ValidationIssues {
		if issue.Code == "DRILLING_CONFLICT" {
			t.Fatalf("unexpected DRILLING_CONFLICT in cleared result")
		}
	}

	// Machining isolation check: shelf operations must be preserved untouched
	var shelfOpsAfterClear []ResolvedMachiningOperation
	for _, op := range clearedResult.Machining.Operations {
		if op.Provenance.SourceKind == "relationship" {
			shelfOpsAfterClear = append(shelfOpsAfterClear, op)
		}
	}
	if len(shelfOpsAfterClear) != len(shelfOpsUnderCollision) {
		t.Fatalf("shelf ops count changed: got %d, want %d", len(shelfOpsAfterClear), len(shelfOpsUnderCollision))
	}
	for i := range shelfOpsUnderCollision {
		if shelfOpsUnderCollision[i].OperationID != shelfOpsAfterClear[i].OperationID ||
			len(shelfOpsUnderCollision[i].Holes) != len(shelfOpsAfterClear[i].Holes) {
			t.Fatalf("shelf op %d changed collaterally", i)
		}
	}
}

// Parity anchors for the shared fixture math.
func TestJointFastenerPositionsParityAnchors(t *testing.T) {
	// span 542, margin 50, max 512, grid 32 → [50, 492]
	got := jointFastenerPositions(542, 50, 512, 32)
	if len(got) != 2 || got[0] != 50 || got[1] != 492 {
		t.Fatalf("fastener positions = %v, want [50 492]", got)
	}
	// Narrow span collapses to the snapped midpoint.
	got = jointFastenerPositions(60, 50, 512, 32)
	if len(got) != 1 || got[0] != 32 {
		t.Fatalf("narrow span positions = %v, want [32]", got)
	}
}

func TestRoundToPrecisionUsesArbitraryStep(t *testing.T) {
	tests := []struct {
		value float64
		want  float64
	}{
		{10.12, 10},
		{10.13, 10.25},
		{-0.13, -0.25},
		{0.375, 0.5},
	}
	for _, tc := range tests {
		if got := roundToPrecision(tc.value, 0.25); got != tc.want {
			t.Fatalf("roundToPrecision(%v, 0.25) = %v, want %v", tc.value, got, tc.want)
		}
	}
}

func TestRelationshipParametersRejectNonScalarJSON(t *testing.T) {
	issues := validateRelationships([]AuthoringRelationship{{
		RelationshipID: "rel-1",
		Kind:           "shelf-support",
		Source:         AuthoringRelationshipAnchor{ComponentInstanceID: "shelf-1"},
		Targets:        []AuthoringRelationshipAnchor{{ComponentInstanceID: "side-1"}},
		Parameters:     map[string]any{"positions": []any{32.0, 64.0}},
	}}, []layoutBoard{{id: "shelf-1"}, {id: "side-1"}})
	if len(issues) != 1 || issues[0].Code != "RELATIONSHIP_INVALID" {
		t.Fatalf("issues = %#v, want one RELATIONSHIP_INVALID", issues)
	}
}

func TestFingerprintIsSHA256OverUTF8CanonicalJSON(t *testing.T) {
	a := fingerprintBodiesHash(
		[]any{map[string]any{"sort": "puerta-á", "body": map[string]any{"id": "puerta-á"}}},
		nil, nil, nil,
	)
	b := fingerprintBodiesHash(
		[]any{map[string]any{"sort": "puerta-a", "body": map[string]any{"id": "puerta-a"}}},
		nil, nil, nil,
	)
	if len(a) != len("sha256-")+64 || a[:len("sha256-")] != "sha256-" {
		t.Fatalf("fingerprint format = %q", a)
	}
	if a == b {
		t.Fatal("UTF-8-distinct identifiers must change the SHA-256 fingerprint")
	}
}

func TestIndustrialRulesRevisionChangesWithRuleTruth(t *testing.T) {
	before := AuthoringIndustrialRulesRevision()
	profile := authoringManualMachiningProfiles["BIS-CL110"]
	profile.PilotDepthMm++
	authoringManualMachiningProfiles["BIS-CL110"] = profile
	t.Cleanup(func() {
		profile.PilotDepthMm--
		authoringManualMachiningProfiles["BIS-CL110"] = profile
	})
	after := AuthoringIndustrialRulesRevision()
	if before == after {
		t.Fatal("an industrial machining-rule change must move its revision")
	}
}

func TestAuthoringResolveFingerprintCoversFullManufacturingIdentity(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	base := func(placements []AuthoringManualPlacement) *AuthoringResolveResult {
		result, err := ResolveAuthoringLayout(AuthoringResolveInput{
			Module: module, Catalog: catalog, PrecisionMm: 0.01,
			Occurrences:             defaultAuthoringOccurrences(),
			Relationships:           []AuthoringRelationship{shelfRelationship("rel-shelf-01", "shelf-01")},
			ManualPlacements:        placements,
			ManualPlacementsPresent: true,
		})
		if err != nil {
			t.Fatalf("resolve: %v", err)
		}
		if len(result.StructuralIssues) != 0 {
			t.Fatalf("rejected: %+v", result.StructuralIssues)
		}
		return result
	}
	hinge := AuthoringManualPlacement{
		HardwarePlacementID: "hp-hinge-01", CatalogHardwareID: "hw-hinge",
		HostComponentInstanceID: "door-01", AnchorFace: "front",
		OffsetMm: [2]float64{298, 100},
	}
	handle := AuthoringManualPlacement{
		HardwarePlacementID: "hp-handle-01", CatalogHardwareID: "hw-handle",
		HostComponentInstanceID: "door-01", AnchorFace: "front",
		OffsetMm: [2]float64{40, 360},
	}

	withHinge := base([]AuthoringManualPlacement{hinge})
	withBoth := base([]AuthoringManualPlacement{hinge, handle})

	// A non-machining hardware swap (the handle) must move the fingerprint:
	// it is part of the manufacturing identity even without drilling.
	if withHinge.Machining.ManufacturingFingerprint == withBoth.Machining.ManufacturingFingerprint {
		t.Fatal("adding a manual hardware placement must move the manufacturing fingerprint")
	}

	// Two hinges with DIFFERENT technical profiles but same drilling pattern
	// would collide on a machining-only fingerprint; the hardware identity in
	// the fingerprint prevents it (replacement scenario).
	replaced := base([]AuthoringManualPlacement{{
		HardwarePlacementID: "hp-hinge-01", CatalogHardwareID: "hw-hinge-b",
		HostComponentInstanceID: "door-01", AnchorFace: "front",
		OffsetMm: [2]float64{298, 100},
	}})
	if replaced.Machining.ManufacturingFingerprint == withHinge.Machining.ManufacturingFingerprint {
		t.Fatal("hardware substitution must move the manufacturing fingerprint")
	}

	// A material change moves the fingerprint even with identical machining.
	oak := catalog
	oak.Materials = []domain.MaterialBoard{
		{ID: "mat-oak18", Code: "ROBLE-CLARO", Name: "Roble Claro", ThicknessMm: 18, Active: true},
	}
	withMaterial, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: oak, OptionChoices: map[string]string{"FRENTE": "mat-oak18"}, PrecisionMm: 0.01,
		Occurrences:      defaultAuthoringOccurrences(),
		Relationships:    []AuthoringRelationship{shelfRelationship("rel-shelf-01", "shelf-01")},
		ManualPlacements: []AuthoringManualPlacement{hinge}, ManualPlacementsPresent: true,
	})
	if err != nil {
		t.Fatalf("resolve with material: %v", err)
	}
	if withMaterial.Machining.ManufacturingFingerprint == withHinge.Machining.ManufacturingFingerprint {
		t.Fatal("a material change must move the manufacturing fingerprint")
	}
}

func TestAuthoringResolveRejectsPartialTargetSets(t *testing.T) {
	module, catalog := authoringCabinetCatalog()

	result, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		Occurrences: defaultAuthoringOccurrences(),
		Relationships: []AuthoringRelationship{{
			RelationshipID: "rel-shelf-01",
			Kind:           "shelf-support",
			Source:         AuthoringRelationshipAnchor{ComponentInstanceID: "shelf-01", Role: "shelf-edge"},
			Targets: []AuthoringRelationshipAnchor{
				{ComponentInstanceID: "side-left-01", Role: "inside-face"},
				{ComponentInstanceID: "side-ghost", Role: "inside-face"},
			},
		}},
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(result.StructuralIssues) == 0 {
		t.Fatal("a relationship with one valid and one orphaned target must reject")
	}
	if result.StructuralIssues[0].Code != "RELATIONSHIP_ORPHANED" {
		t.Fatalf("code = %s, want RELATIONSHIP_ORPHANED", result.StructuralIssues[0].Code)
	}
}

func TestAuthoringResolveRejectsMultiEntryTemplates(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	// Duplicate the shelf entry: the component is now instantiated by two
	// definition entries (possibly with different formulas/overrides).
	module.Components = append([]domain.ComponentInstance{{ComponentID: "comp-shelf", Quantity: 1}}, module.Components...)

	result, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		Occurrences:   defaultAuthoringOccurrences(),
		Relationships: []AuthoringRelationship{},
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(result.StructuralIssues) == 0 {
		t.Fatal("planning a template with multiple definition entries must always reject")
	}
	if result.StructuralIssues[0].Code != "OCCURRENCE_COUNT_UNSUPPORTED" {
		t.Fatalf("code = %s, want OCCURRENCE_COUNT_UNSUPPORTED", result.StructuralIssues[0].Code)
	}
}

func TestAuthoringResolveRejectsOutOfRangeHardwareOffset(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	outOfRangeInput := AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		Occurrences: defaultAuthoringOccurrences(),
		Relationships: []AuthoringRelationship{},
		ManualPlacements: []AuthoringManualPlacement{
			{
				HardwarePlacementID:     "hp-hinge-out-of-range",
				CatalogHardwareID:       "hw-hinge",
				HostComponentInstanceID: "door-01",
				AnchorFace:              "front",
				OffsetMm:                [2]float64{1500, 100}, // Door width is 596mm
			},
		},
		ManualPlacementsPresent: true,
	}

	result, err := ResolveAuthoringLayout(outOfRangeInput)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(result.StructuralIssues) == 0 {
		t.Fatal("expected structural issues for out-of-range hardware offset")
	}
	if result.StructuralIssues[0].Code != "HARDWARE_PLACEMENT_INVALID" {
		t.Fatalf("issue code = %s, want HARDWARE_PLACEMENT_INVALID", result.StructuralIssues[0].Code)
	}
}

func TestAuthoringResolveRejectsDerivedHardwarePlacementEdit(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	input := AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		Occurrences: defaultAuthoringOccurrences(),
		Relationships: []AuthoringRelationship{},
		ManualPlacements: []AuthoringManualPlacement{
			{
				HardwarePlacementID:     "HP-DERIVED-1",
				CatalogHardwareID:       "hw-hinge",
				HostComponentInstanceID: "door-01",
				AnchorFace:              "front",
				OffsetMm:                [2]float64{298, 100},
			},
		},
		ManualPlacementsPresent: true,
	}

	result, err := ResolveAuthoringLayout(input)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(result.StructuralIssues) == 0 {
		t.Fatal("expected structural issues for derived hardware placement edit")
	}
	if result.StructuralIssues[0].Code != "HARDWARE_DERIVED_EDIT" {
		t.Fatalf("issue code = %s, want HARDWARE_DERIVED_EDIT", result.StructuralIssues[0].Code)
	}
}

func TestAuthoringResolveRejectsIncompatibleHardwareSubstitution(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	catalog.Hardware = append(catalog.Hardware, domain.Hardware{
		ID:     "hw-incompatible",
		Code:   "INCOMPATIBLE",
		Name:   "Incompatible Hardware",
		Active: true,
	})

	input := AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		Occurrences: defaultAuthoringOccurrences(),
		Relationships: []AuthoringRelationship{},
		ManualPlacements: []AuthoringManualPlacement{
			{
				HardwarePlacementID:     "hp-hinge-01",
				CatalogHardwareID:       "hw-incompatible",
				HostComponentInstanceID: "door-01",
				AnchorFace:              "front",
				OffsetMm:                [2]float64{298, 100},
			},
		},
		ManualPlacementsPresent: true,
	}

	result, err := ResolveAuthoringLayout(input)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(result.StructuralIssues) == 0 {
		t.Fatal("expected structural issues for incompatible hardware substitution")
	}
	if result.StructuralIssues[0].Code != "HARDWARE_INCOMPATIBLE" {
		t.Fatalf("issue code = %s, want HARDWARE_INCOMPATIBLE", result.StructuralIssues[0].Code)
	}
}

func TestAuthoringResolveMachiningIsolationAndDrillingConflictClearance(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	// Initial state: shelf at z=150 on side-left-01, hinge at y=150 on side-left-01 -> collision!
	conflictInput := AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		Occurrences: defaultAuthoringOccurrences(),
		Relationships: []AuthoringRelationship{
			shelfRelationship("rel-shelf-1", "shelf-01"),
		},
		ManualPlacements: []AuthoringManualPlacement{
			{
				HardwarePlacementID:     "hp-hinge-top",
				CatalogHardwareID:       "hw-hinge",
				HostComponentInstanceID: "side-left-01",
				AnchorFace:              "front",
				OffsetMm:                [2]float64{50, 150}, // Collides with shelf hole at [50, 150]
			},
			{
				HardwarePlacementID:     "hp-hinge-bottom",
				CatalogHardwareID:       "hw-hinge",
				HostComponentInstanceID: "side-left-01",
				AnchorFace:              "front",
				OffsetMm:                [2]float64{50, 500},
			},
		},
		ManualPlacementsPresent: true,
	}

	resultConflict, err := ResolveAuthoringLayout(conflictInput)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	hasConflict := false
	for _, issue := range resultConflict.ValidationIssues {
		if issue.Code == "DRILLING_CONFLICT" {
			hasConflict = true
			break
		}
	}
	if !hasConflict {
		t.Fatal("expected DRILLING_CONFLICT when hinge hole overlaps shelf hole")
	}

	// Move hinge away: offset changes 50 -> 200 (clear of shelf at 50)
	clearInput := conflictInput
	clearInput.ManualPlacements = []AuthoringManualPlacement{
		{
			HardwarePlacementID:     "hp-hinge-top",
			CatalogHardwareID:       "hw-hinge",
			HostComponentInstanceID: "side-left-01",
			AnchorFace:              "front",
			OffsetMm:                [2]float64{50, 200}, // Clear of shelf
		},
		{
			HardwarePlacementID:     "hp-hinge-bottom",
			CatalogHardwareID:       "hw-hinge",
			HostComponentInstanceID: "side-left-01",
			AnchorFace:              "front",
			OffsetMm:                [2]float64{50, 500},
		},
	}

	resultClear, err := ResolveAuthoringLayout(clearInput)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	for _, issue := range resultClear.ValidationIssues {
		if issue.Code == "DRILLING_CONFLICT" {
			t.Fatalf("DRILLING_CONFLICT should have cleared after moving hinge away: %v", issue)
		}
	}

	// Verify machining isolation:
	// Shelf operations must remain identical before and after moving hp-hinge-top!
	var shelfOpConflict, shelfOpClear *ResolvedMachiningOperation
	for _, op := range resultConflict.Machining.Operations {
		if op.Provenance.SourceKind == "relationship" && op.Provenance.RelationshipID == "rel-shelf-1" {
			shelfOpConflict = &op
			break
		}
	}
	for _, op := range resultClear.Machining.Operations {
		if op.Provenance.SourceKind == "relationship" && op.Provenance.RelationshipID == "rel-shelf-1" {
			shelfOpClear = &op
			break
		}
	}
	if shelfOpConflict == nil || shelfOpClear == nil {
		t.Fatal("expected shelf operations to exist in both results")
	}
	if len(shelfOpConflict.Holes) != len(shelfOpClear.Holes) {
		t.Fatalf("shelf hole count changed: %d vs %d", len(shelfOpConflict.Holes), len(shelfOpClear.Holes))
	}
	for i := range shelfOpConflict.Holes {
		if shelfOpConflict.Holes[i] != shelfOpClear.Holes[i] {
			t.Fatalf("shelf hole %d changed after hinge move: %+v vs %+v", i, shelfOpConflict.Holes[i], shelfOpClear.Holes[i])
		}
	}

	// Bottom hinge operation must also remain identical
	var bottomHingeOpConflict, bottomHingeOpClear *ResolvedMachiningOperation
	for _, op := range resultConflict.Machining.Operations {
		if op.Provenance.HardwarePlacementID == "hp-hinge-bottom" {
			bottomHingeOpConflict = &op
			break
		}
	}
	for _, op := range resultClear.Machining.Operations {
		if op.Provenance.HardwarePlacementID == "hp-hinge-bottom" {
			bottomHingeOpClear = &op
			break
		}
	}
	if bottomHingeOpConflict == nil || bottomHingeOpClear == nil {
		t.Fatal("expected bottom hinge operation in both results")
	}
	if bottomHingeOpConflict.Holes[0] != bottomHingeOpClear.Holes[0] {
		t.Fatalf("bottom hinge hole changed: %+v vs %+v", bottomHingeOpConflict.Holes[0], bottomHingeOpClear.Holes[0])
	}
}

