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
	if before.Machining.BomFingerprint == after.Machining.BomFingerprint {
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
	if result.Machining.BomFingerprint == after.Machining.BomFingerprint {
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
				OffsetMm: offset, RotationDeg: 0,
			},
			{
				HardwarePlacementID: "hp-handle-01", CatalogHardwareID: "hw-handle",
				HostComponentInstanceID: "door-01", AnchorFace: "front",
				OffsetMm: [2]float64{40, 360}, RotationDeg: 0,
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
				OffsetMm: [2]float64{298, 100}, RotationDeg: 0,
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
	if withA.Machining.BomFingerprint == withB.Machining.BomFingerprint {
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
	if result.PreflightStatus != "" || result.Machining.BomFingerprint != "" || len(result.Normalized.Components) != 0 {
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
	if result.PreflightStatus != AuthoringPreflightBlocked {
		t.Fatalf("preflight = %s, want blocked", result.PreflightStatus)
	}
	found := false
	for _, issue := range result.PreflightIssues {
		if issue.Code == "DRILLING_CONFLICT" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a DRILLING_CONFLICT issue: %+v", result.PreflightIssues)
	}
}

// Parity anchors for the shared- fixture math: these are the TS semantics
// (jointFastenerPositions + fnv1a fingerprint) pinned on values the contract
// fixture reuses.
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

func TestAuthoringBomFingerprintCanonicalization(t *testing.T) {
	// Fingerprint must be stable under input order and key order.
	ops := []ResolvedMachiningOperation{{
		OperationID:             "rel-a:op-1",
		HostComponentInstanceID: "side-left-01",
		Provenance:              ResolvedMachiningProvenance{SourceKind: "relationship", RelationshipID: "rel-a", CatalogRuleID: "minifix-dowel"},
		Holes:                   []ResolveHole{{Face: "front", XMm: 50, YMm: 350, DiameterMm: 15, DepthMm: 12.5, Type: "minifix"}},
	}}
	first := authoringBomFingerprint(nil, ops)

	reordered := []ResolvedMachiningOperation{{
		OperationID:             "rel-a:op-1",
		Provenance:              ResolvedMachiningProvenance{SourceKind: "relationship", RelationshipID: "rel-a", CatalogRuleID: "minifix-dowel"},
		HostComponentInstanceID: "side-left-01",
		Holes:                   []ResolveHole{{Type: "minifix", DepthMm: 12.5, DiameterMm: 15, YMm: 350, XMm: 50, Face: "front"}},
	}}
	second := authoringBomFingerprint(nil, reordered)

	if first != second {
		t.Fatalf("fingerprint must be canonical: %s vs %s", first, second)
	}
	if len(first) != 6+8 || first[:6] != "fnv1a-" {
		t.Fatalf("fingerprint shape = %q", first)
	}
}
