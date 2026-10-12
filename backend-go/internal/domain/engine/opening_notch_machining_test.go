package engine

import (
	"strings"
	"testing"
)

// #1302 / §13.3-2: the resolved side notch becomes a ROUTING machining
// operation derived from the SAME subtraction box the visible geometry
// consumes — one definition, never a second derivation. The operation is
// representation only: the #1302 release gate keeps opening designs from
// freezing a release, and machine output selection refuses machines whose
// evidenced capabilities cannot express routing.

func notchMachiningFixture(t *testing.T) (*AuthoringResolveResult, *AuthoringResolveResult) {
	t.Helper()
	module, catalog := oneDoorCabinetCatalog()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}
	modifiers := []ResolvedOpeningBodyModifier{{
		Effect:        OpeningModifierEffectNotch,
		Role:          "lateral",
		ProfileID:     "prof-8006",
		Boundary:      "top",
		NotchHeightMm: 56.5,
		NotchDepthMm:  27.2,
	}}
	notched, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, Dims: dims, OpeningBodyModifiers: modifiers,
	})
	if err != nil {
		t.Fatalf("resolve with notch: %v", err)
	}
	plain, err := ResolveAuthoringLayout(AuthoringResolveInput{Module: module, Catalog: catalog, Dims: dims})
	if err != nil {
		t.Fatalf("resolve without notch: %v", err)
	}
	return notched, plain
}

func TestOpeningNotchRoutingOperationPreservesResolvedGeometry(t *testing.T) {
	notched, _ := notchMachiningFixture(t)

	componentByID := make(map[string]*LayoutComponent, len(notched.Layout.Components))
	for i := range notched.Layout.Components {
		componentByID[notched.Layout.Components[i].ComponentInstanceID] = &notched.Layout.Components[i]
	}
	routingOps := []ResolvedMachiningOperation{}
	for _, operation := range notched.Machining.Operations {
		if operation.Provenance.SourceKind == "openingProfile" {
			routingOps = append(routingOps, operation)
		}
	}
	if len(routingOps) != 2 {
		t.Fatalf("both side boards must freeze one routing operation, got %d (ops: %d)", len(routingOps), len(notched.Machining.Operations))
	}
	for _, operation := range routingOps {
		if len(operation.Holes) != 0 || len(operation.Routing) != 1 {
			t.Fatalf("routing operation %s must carry exactly one cut and no holes", operation.OperationID)
		}
		if !strings.HasSuffix(operation.OperationID, ":notch-0") {
			t.Fatalf("routing operation id must be deterministic per host, got %q", operation.OperationID)
		}
		if operation.Provenance.OpeningProfileID != "prof-8006" || operation.Provenance.Boundary != "top" {
			t.Fatalf("routing provenance must name the profile and boundary, got %+v", operation.Provenance)
		}
		component, ok := componentByID[operation.HostComponentInstanceID]
		if !ok {
			t.Fatalf("routing host %s is not a published component", operation.HostComponentInstanceID)
		}
		if len(component.Notches) != 1 {
			t.Fatalf("host %s must carry the resolved notch", component.ComponentInstanceID)
		}
		cut := operation.Routing[0]
		if cut.StartMm != component.Notches[0].StartMm || cut.SizeMm != component.Notches[0].SizeMm {
			t.Fatalf("routing cut must BE the resolved notch box: cut %+v vs notch %+v", cut, component.Notches[0])
		}
	}
}

func TestOpeningNotchMovesFingerprintAndIsDeterministic(t *testing.T) {
	notched, plain := notchMachiningFixture(t)

	if notched.Machining.ManufacturingFingerprint == plain.Machining.ManufacturingFingerprint {
		t.Fatal("a notched board must move the manufacturing fingerprint")
	}
	module, catalog := oneDoorCabinetCatalog()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}
	modifiers := []ResolvedOpeningBodyModifier{{
		Effect: OpeningModifierEffectNotch, Role: "lateral", ProfileID: "prof-8006", Boundary: "top",
		NotchHeightMm: 56.5, NotchDepthMm: 27.2,
	}}
	again, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, Dims: dims, OpeningBodyModifiers: modifiers,
	})
	if err != nil {
		t.Fatalf("re-resolve: %v", err)
	}
	if again.Machining.ManufacturingFingerprint != notched.Machining.ManufacturingFingerprint {
		t.Fatal("repeated resolve must be byte-stable")
	}
}

func TestReleaseRoutingFreezesRouteIntent(t *testing.T) {
	routing := []ResolvedMachiningOperation{
		{
			OperationID: "bd-1:drill-op", HostComponentInstanceID: "bd-1",
			Provenance: ResolvedMachiningProvenance{SourceKind: "relationship", RelationshipID: "rel-1"},
			Holes:      []ResolveHole{{Face: "front", XMm: 9, YMm: 9, DiameterMm: 8, DepthMm: 12, Type: "dowel"}},
		},
		{
			OperationID: "bd-2:notch-0", HostComponentInstanceID: "bd-2",
			Provenance: ResolvedMachiningProvenance{SourceKind: "openingProfile", OpeningProfileID: "prof-8006", Boundary: "top"},
			Routing:    []ResolveRoutingCut{{StartMm: [3]float64{0, 532.8, 663.5}, SizeMm: [3]float64{18, 27.2, 56.5}}},
		},
	}
	byHost, err := releaseRoutingOperationsFromResolved(routing)
	if err != nil {
		t.Fatalf("freeze operations: %v", err)
	}
	drill := byHost["bd-1"][0]
	if drill.Operation != ReleaseRoutingOperationDrill || len(drill.Holes) != 1 || len(drill.Routing) != 0 {
		t.Fatalf("drill freeze mismatch: %+v", drill)
	}
	route := byHost["bd-2"][0]
	if route.Operation != ReleaseRoutingOperationRoute || len(route.Routing) != 1 || len(route.Holes) != 0 {
		t.Fatalf("route freeze mismatch: %+v", route)
	}
	if route.Routing[0].SizeMm != [3]float64{18, 27.2, 56.5} {
		t.Fatalf("route freeze must carry the resolved box verbatim: %+v", route.Routing[0])
	}

	if _, err := releaseRoutingOperationsFromResolved([]ResolvedMachiningOperation{{
		OperationID: "both", HostComponentInstanceID: "bd-1",
		Holes:   []ResolveHole{{Face: "front", XMm: 1, YMm: 1, DiameterMm: 8, DepthMm: 12, Type: "dowel"}},
		Routing: []ResolveRoutingCut{{StartMm: [3]float64{}, SizeMm: [3]float64{1, 1, 1}}},
	}}); err == nil || !strings.Contains(err.Error(), "both holes and routing") {
		t.Fatalf("dual-payload operation must be refused, got %v", err)
	}
	// A payload-less operation never freezes an intent: it is skipped like the
	// historical empty-hole skip (relationship resolutions may derive zero
	// holes), never presented as CNC work.
	byHost, err = releaseRoutingOperationsFromResolved([]ResolvedMachiningOperation{{
		OperationID: "empty", HostComponentInstanceID: "bd-3",
	}})
	if err != nil {
		t.Fatalf("payload-less operation must skip, got %v", err)
	}
	if len(byHost) != 0 {
		t.Fatalf("payload-less operation must not freeze anything, got %+v", byHost)
	}
}

func TestValidateReleaseRoutingProgramRouteIntent(t *testing.T) {
	// A frozen route operation with the resolved box and opening provenance is
	// structurally valid — the representation contract exists even while no
	// machine evidences routing capability. Each scenario re-derives the
	// program and mutates ONLY the CNC part's single operation.
	buildWithRoute := func(edit func(*ReleaseRoutingOperation)) (*ReleaseRoutingProgram, []ResolvedReleaseUnit, error) {
		items, units, catalog := routingFixture(t)
		program, _, err := DeriveReleaseRoutingProgram(items, units, catalog, nil)
		if err != nil {
			t.Fatal(err)
		}
		route := ReleaseRoutingOperation{
			OperationID: "bd:notch-0",
			Provenance:  ResolvedMachiningProvenance{SourceKind: "openingProfile", OpeningProfileID: "prof-8006", Boundary: "top"},
			Operation:   ReleaseRoutingOperationRoute,
			Routing:     []ReleaseRoutingCut{{StartMm: [3]float64{0, 532.8, 663.5}, SizeMm: [3]float64{18, 27.2, 56.5}}},
		}
		if edit != nil {
			edit(&route)
		}
		for i := range program.Units {
			for j := range program.Units[i].Parts {
				if len(program.Units[i].Parts[j].Operations) > 0 {
					program.Units[i].Parts[j].Operations = []ReleaseRoutingOperation{route}
				}
			}
		}
		return program, units, nil
	}

	program, units, _ := buildWithRoute(nil)
	if err := ValidateReleaseRoutingProgram(program, units); err != nil {
		t.Fatalf("valid route operation rejected: %v", err)
	}

	scenarios := []struct {
		name  string
		edit  func(*ReleaseRoutingOperation)
		match string
	}{
		{"route without cuts", func(o *ReleaseRoutingOperation) { o.Routing = nil }, "freezes no cuts"},
		{"route carrying holes", func(o *ReleaseRoutingOperation) {
			o.Holes = []ReleaseRoutingHole{{Face: "front", XMm: 9, YMm: 9, DiameterMm: 8, DepthMm: 12, Type: "dowel"}}
		}, "must not carry holes"},
		{"route with wrong provenance", func(o *ReleaseRoutingOperation) {
			o.Provenance = ResolvedMachiningProvenance{SourceKind: "relationship", RelationshipID: "rel-1"}
		}, "only openingProfile provenance"},
		{"route with non-positive extent", func(o *ReleaseRoutingOperation) {
			o.Routing[0].SizeMm[1] = 0
		}, "positive extents"},
	}
	for _, scenario := range scenarios {
		t.Run(scenario.name, func(t *testing.T) {
			program, units, _ := buildWithRoute(scenario.edit)
			if err := ValidateReleaseRoutingProgram(program, units); err == nil ||
				!strings.Contains(err.Error(), scenario.match) {
				t.Fatalf("want %q rejection, got %v", scenario.match, err)
			}
		})
	}
}
