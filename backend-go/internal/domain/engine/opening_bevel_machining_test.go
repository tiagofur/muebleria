package engine

import (
	"strings"
	"testing"
)

// #1327 slice 3: the resolved door bevel becomes a BEVEL machining operation
// derived from the SAME wedge the visible geometry consumes — one definition,
// never a second derivation, and never a rectangular approximation of the
// 45° cut. The frozen program carries the wedge representationally: machine
// adapters refuse an angled cut their capabilities cannot evidence.

func bevelMachiningFixture(t *testing.T) (*AuthoringResolveResult, *AuthoringResolveResult) {
	t.Helper()
	module, catalog := oneDoorCabinetCatalog()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}
	modifiers := []ResolvedOpeningBodyModifier{{
		Effect:        OpeningModifierEffectBevel,
		Role:          "door",
		ProfileID:     "prof-gola-italiano",
		Boundary:      "top",
		BevelAngleDeg: 45,
		BevelSizeMm:   9,
	}}
	beveled, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, Dims: dims, OpeningBodyModifiers: modifiers,
	})
	if err != nil {
		t.Fatalf("resolve with bevel: %v", err)
	}
	plain, err := ResolveAuthoringLayout(AuthoringResolveInput{Module: module, Catalog: catalog, Dims: dims})
	if err != nil {
		t.Fatalf("resolve without bevel: %v", err)
	}
	return beveled, plain
}

func TestOpeningBevelMachiningOperationPreservesResolvedGeometry(t *testing.T) {
	beveled, _ := bevelMachiningFixture(t)

	componentByID := make(map[string]*LayoutComponent, len(beveled.Layout.Components))
	for i := range beveled.Layout.Components {
		componentByID[beveled.Layout.Components[i].ComponentInstanceID] = &beveled.Layout.Components[i]
	}
	var bevelOp *ResolvedMachiningOperation
	for i := range beveled.Machining.Operations {
		operation := &beveled.Machining.Operations[i]
		if operation.Provenance.SourceKind == "openingProfile" {
			if bevelOp != nil {
				t.Fatalf("exactly one door carries the bevel, got a second op %s", operation.OperationID)
			}
			bevelOp = operation
		}
	}
	if bevelOp == nil {
		t.Fatal("no openingProfile bevel operation in the resolved payload")
	}
	if len(bevelOp.Holes) != 0 || bevelOp.Bevel == nil || len(bevelOp.Routing) != 0 {
		t.Fatalf("bevel operation %s must carry exactly the wedge payload", bevelOp.OperationID)
	}
	if !strings.HasSuffix(bevelOp.OperationID, ":bevel-0") {
		t.Fatalf("bevel operation id must be deterministic per host, got %q", bevelOp.OperationID)
	}
	if bevelOp.Provenance.OpeningProfileID != "prof-gola-italiano" || bevelOp.Provenance.Boundary != "top" {
		t.Fatalf("bevel provenance must name the profile and boundary, got %+v", bevelOp.Provenance)
	}
	component, ok := componentByID[bevelOp.HostComponentInstanceID]
	if !ok {
		t.Fatalf("bevel host %s is not a published component", bevelOp.HostComponentInstanceID)
	}
	if len(component.Bevels) != 1 {
		t.Fatalf("host %s must carry the resolved bevel", component.ComponentInstanceID)
	}
	resolved := component.Bevels[0]
	wedge := bevelOp.Bevel
	if wedge.StartMm != resolved.StartMm || wedge.SizeMm != resolved.SizeMm ||
		wedge.AngleDeg != resolved.AngleDeg || wedge.Edge != resolved.Edge {
		t.Fatalf("bevel operation must BE the resolved wedge: %+v vs %+v", wedge, resolved)
	}
}

func TestOpeningBevelMovesFingerprintAndIsDeterministic(t *testing.T) {
	beveled, plain := bevelMachiningFixture(t)

	if beveled.Machining.ManufacturingFingerprint == plain.Machining.ManufacturingFingerprint {
		t.Fatal("a beveled door must move the manufacturing fingerprint")
	}
	module, catalog := oneDoorCabinetCatalog()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}
	modifiers := []ResolvedOpeningBodyModifier{{
		Effect: OpeningModifierEffectBevel, Role: "door", ProfileID: "prof-gola-italiano", Boundary: "top",
		BevelAngleDeg: 45, BevelSizeMm: 9,
	}}
	again, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, Dims: dims, OpeningBodyModifiers: modifiers,
	})
	if err != nil {
		t.Fatalf("re-resolve: %v", err)
	}
	if again.Machining.ManufacturingFingerprint != beveled.Machining.ManufacturingFingerprint {
		t.Fatal("repeated resolve must be byte-stable")
	}
}

func TestReleaseRoutingFreezesBevelIntent(t *testing.T) {
	byHost, err := releaseRoutingOperationsFromResolved([]ResolvedMachiningOperation{{
		OperationID: "puerta:bevel-0", HostComponentInstanceID: "puerta",
		Provenance: ResolvedMachiningProvenance{SourceKind: "openingProfile", OpeningProfileID: "prof-gola-italiano", Boundary: "top"},
		Holes:      []ResolveHole{},
		Bevel: &ResolveRoutingBevel{
			StartMm: [3]float64{0, 9, 667}, SizeMm: [3]float64{596, 9, 9}, AngleDeg: 45, Edge: "top_front",
		},
	}})
	if err != nil {
		t.Fatalf("freeze operations: %v", err)
	}
	bevel := byHost["puerta"][0]
	if bevel.Operation != ReleaseRoutingOperationBevel || bevel.Bevel == nil || len(bevel.Holes) != 0 || len(bevel.Routing) != 0 {
		t.Fatalf("bevel freeze mismatch: %+v", bevel)
	}
	if bevel.Bevel.SizeMm != [3]float64{596, 9, 9} || bevel.Bevel.AngleDeg != 45 || bevel.Bevel.Edge != "top_front" {
		t.Fatalf("bevel freeze must carry the resolved wedge verbatim: %+v", bevel.Bevel)
	}

	for name, scenario := range map[string]struct {
		operation ResolvedMachiningOperation
		match     string
	}{
		"bevel and holes": {
			operation: ResolvedMachiningOperation{
				OperationID: "x", HostComponentInstanceID: "bd-1",
				Holes: []ResolveHole{{Face: "front", XMm: 1, YMm: 1, DiameterMm: 8, DepthMm: 12, Type: "dowel"}},
				Bevel: &ResolveRoutingBevel{AngleDeg: 45, Edge: "top_front"},
			},
			match: "both holes and a bevel",
		},
		"bevel and routing": {
			operation: ResolvedMachiningOperation{
				OperationID: "x", HostComponentInstanceID: "bd-1",
				Routing: []ResolveRoutingCut{{SizeMm: [3]float64{1, 1, 1}}},
				Bevel:   &ResolveRoutingBevel{AngleDeg: 45, Edge: "top_front"},
			},
			match: "both routing cuts and a bevel",
		},
	} {
		if _, err := releaseRoutingOperationsFromResolved([]ResolvedMachiningOperation{scenario.operation}); err == nil ||
			!strings.Contains(err.Error(), scenario.match) {
			t.Fatalf("%s must be refused, got %v", name, err)
		}
	}
}

func TestValidateReleaseRoutingProgramBevelIntent(t *testing.T) {
	// A frozen bevel operation with the resolved wedge and opening provenance
	// is structurally valid — the representation contract exists even while no
	// machine evidences angled-cut capability. Each scenario re-derives the
	// program and mutates ONLY the CNC part's single operation.
	buildWithBevel := func(edit func(*ReleaseRoutingOperation)) (*ReleaseRoutingProgram, []ResolvedReleaseUnit, error) {
		items, units, catalog := routingFixture(t)
		program, _, err := DeriveReleaseRoutingProgram(items, units, catalog, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		bevel := ReleaseRoutingOperation{
			OperationID: "puerta:bevel-0",
			Provenance:  ResolvedMachiningProvenance{SourceKind: "openingProfile", OpeningProfileID: "prof-gola-italiano", Boundary: "top"},
			Operation:   ReleaseRoutingOperationBevel,
			Bevel:       &ReleaseRoutingBevel{StartMm: [3]float64{0, 9, 667}, SizeMm: [3]float64{596, 9, 9}, AngleDeg: 45, Edge: "top_front"},
		}
		if edit != nil {
			edit(&bevel)
		}
		for i := range program.Units {
			for j := range program.Units[i].Parts {
				if len(program.Units[i].Parts[j].Operations) > 0 {
					program.Units[i].Parts[j].Operations = []ReleaseRoutingOperation{bevel}
				}
			}
		}
		return program, units, nil
	}

	program, units, _ := buildWithBevel(nil)
	if err := ValidateReleaseRoutingProgram(program, units); err != nil {
		t.Fatalf("valid bevel operation rejected: %v", err)
	}

	scenarios := []struct {
		name  string
		edit  func(*ReleaseRoutingOperation)
		match string
	}{
		{"bevel without wedge", func(o *ReleaseRoutingOperation) { o.Bevel = nil }, "freezes no wedge"},
		{"bevel carrying holes", func(o *ReleaseRoutingOperation) {
			o.Holes = []ReleaseRoutingHole{{Face: "front", XMm: 9, YMm: 9, DiameterMm: 8, DepthMm: 12, Type: "dowel"}}
		}, "must not carry holes or routing cuts"},
		{"bevel with wrong provenance", func(o *ReleaseRoutingOperation) {
			o.Provenance = ResolvedMachiningProvenance{SourceKind: "relationship", RelationshipID: "rel-1"}
		}, "bevel freezes only openingProfile provenance"},
		{"bevel at a non-v1 angle", func(o *ReleaseRoutingOperation) { o.Bevel.AngleDeg = 60 }, "v1 freezes only 45°"},
		{"bevel with unknown edge", func(o *ReleaseRoutingOperation) { o.Bevel.Edge = "top_back" }, "unknown edge"},
		{"bevel with non-positive extent", func(o *ReleaseRoutingOperation) { o.Bevel.SizeMm[1] = 0 }, "positive extents"},
	}
	for _, scenario := range scenarios {
		t.Run(scenario.name, func(t *testing.T) {
			program, units, _ := buildWithBevel(scenario.edit)
			if err := ValidateReleaseRoutingProgram(program, units); err == nil ||
				!strings.Contains(err.Error(), scenario.match) {
				t.Fatalf("want %q rejection, got %v", scenario.match, err)
			}
		})
	}
}
