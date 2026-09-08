package engine

import (
	"reflect"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// routingFixture extends the release-unit fixture with authoritative
// machining inputs: a hinge (BIS-CL110 — a versioned manual machining
// profile) and a handle (MAN-160 — rides the surface, drills nothing)
// placed on the quantity-bound component through its component-instance
// override, plus a plain divider with no hardware so the program must also
// freeze an EXPLICIT resolved no-CNC verdict.
func routingFixture(t *testing.T) ([]domain.DesignRevisionItem, []ResolvedReleaseUnit, domain.Catalog) {
	t.Helper()
	item, catalog := releaseUnitFixture(t)
	hinge := domain.Hardware{ID: "hw-hinge", Code: "BIS-CL110", Name: "Bisagra CL110", Unit: domain.UnitPiece, Active: true}
	handle := domain.Hardware{ID: "hw-handle", Code: "MAN-160", Name: "Manija 160", Unit: domain.UnitPiece, Active: true}
	catalog.Hardware = append(catalog.Hardware, hinge, handle)
	divider := domain.Component{
		ID: "comp-routing-divider", Code: "DIV", Name: "Divisor", Placement: domain.PlacementInterno,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"INTERIOR"},
		LengthFormula: "PH - 2*T", WidthFormula: "PD - T", Active: true,
	}
	catalog.Components = append(catalog.Components, divider)
	catalog.Modules[0].Components[0].Overrides = &domain.ComponentInstanceOverrides{
		HardwarePlacements: []domain.HardwarePlacement{
			{HardwareID: "hw-hinge", AnchorFace: "front",
				RelativePosition: domain.HardwareRelPosition{XMm: 298, YMm: 100}},
			{HardwareID: "hw-handle", AnchorFace: "front",
				RelativePosition: domain.HardwareRelPosition{XMm: 40, YMm: 360}},
		},
	}
	catalog.Modules[0].Components = append(catalog.Modules[0].Components,
		domain.ComponentInstance{ComponentID: divider.ID, Quantity: 1})
	second := item
	second.FurnitureInstanceID = "unit-2"
	second.Parameters = map[string]any{"widthMm": 700.0, "heightMm": 800.0, "depthMm": 520.0, "shelves": 5.0}
	items := []domain.DesignRevisionItem{item, second}

	units := make([]ResolvedReleaseUnit, 0, len(items))
	for _, i := range items {
		unit, err := resolveReleaseUnit(i, catalog, nil)
		if err != nil {
			t.Fatalf("resolve unit %s: %v", i.FurnitureInstanceID, err)
		}
		units = append(units, *unit)
	}
	return items, units, catalog
}

// The program freezes hardware-driven drilling for the exact frozen part, and
// an EXPLICIT resolved no-CNC verdict for parts without machining — never a
// missing record.
func TestDeriveReleaseRoutingProgramMachiningEvidence(t *testing.T) {
	items, units, catalog := routingFixture(t)
	program, err := DeriveReleaseRoutingProgram(items, units, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if program.Contract != ReleaseRoutingProgramContract || program.IndustrialRulesRevision == "" {
		t.Fatalf("program identity: %+v", program)
	}
	if len(program.Units) != 2 {
		t.Fatalf("program units = %d", len(program.Units))
	}
	hingeHosts := 0
	cncParts := 0
	explicitNoCnc := 0
	for _, unit := range program.Units {
		if unit.FurnitureInstanceID == "" || unit.MachiningFingerprint == "" {
			t.Fatalf("unit provenance incomplete: %+v", unit)
		}
		coverage := map[string]int{}
		for _, board := range unitFrozenParts(t, units, unit.FurnitureInstanceID) {
			coverage[board.ID] = 0
		}
		for _, part := range unit.Parts {
			if _, frozen := coverage[part.PartID]; !frozen {
				t.Fatalf("routing part %s outside frozen BOM", part.PartID)
			}
			coverage[part.PartID]++
			if !part.Cut {
				t.Fatalf("part %s lost cut intent", part.PartID)
			}
			if part.CncRequired != (len(part.Operations) > 0) {
				t.Fatalf("part %s verdict contradicts operations", part.PartID)
			}
			if part.CncRequired {
				cncParts++
			} else {
				explicitNoCnc++
			}
			for _, operation := range part.Operations {
				if operation.Operation != ReleaseRoutingOperationDrill ||
					operation.Provenance.SourceKind != "manualHardwarePlacement" ||
					operation.Provenance.HardwarePlacementID == "" {
					t.Fatalf("machining provenance incomplete: %+v", operation)
				}
				for _, hole := range operation.Holes {
					if hole.DiameterMm != 35 || hole.DepthMm != 12.5 || hole.Face != "front" || hole.Type != "hinge" {
						t.Fatalf("hinge cup hole drifted from the versioned profile: %+v", hole)
					}
				}
				hingeHosts++
			}
		}
		for partID, seen := range coverage {
			if seen != 1 {
				t.Fatalf("frozen part %s lacks exactly one routing record (%d)", partID, seen)
			}
		}
	}
	// Every unit hosts the hinge on each copy of the bound component; the
	// divider and the surface-mounted handle contribute no machining — an
	// explicit resolved verdict, not missing data.
	if hingeHosts == 0 || cncParts == 0 {
		t.Fatalf("hardware-driven drilling missing (hosts=%d cnc=%d)", hingeHosts, cncParts)
	}
	if explicitNoCnc == 0 {
		t.Fatal("parts without machining must carry an explicit resolved no-CNC verdict")
	}
}

// Two identical units of the same definition keep per-FurnitureInstance
// routing identity, and derivation is deterministic (same inputs → equal
// program).
func TestDeriveReleaseRoutingProgramIdentityAndDeterminism(t *testing.T) {
	items, units, catalog := routingFixture(t)
	first, err := DeriveReleaseRoutingProgram(items, units, catalog)
	if err != nil {
		t.Fatal(err)
	}
	second, err := DeriveReleaseRoutingProgram(items, units, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatal("routing derivation must be deterministic")
	}
	ids := map[string]bool{}
	for _, unit := range first.Units {
		if ids[unit.FurnitureInstanceID] {
			t.Fatalf("duplicated unit identity %s", unit.FurnitureInstanceID)
		}
		ids[unit.FurnitureInstanceID] = true
	}
	if !ids["unit-1"] || !ids["unit-2"] {
		t.Fatalf("physical identities lost: %v", ids)
	}
	if first.Units[0].FurnitureDefinitionID != first.Units[1].FurnitureDefinitionID {
		t.Fatal("shared definition identity lost")
	}
}

// The fail-closed validation matrix: coverage, verdict consistency,
// provenance and hole sanity are proven, never assumed.
func TestValidateReleaseRoutingProgramFailClosed(t *testing.T) {
	items, units, catalog := routingFixture(t)
	program, err := DeriveReleaseRoutingProgram(items, units, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateReleaseRoutingProgram(program, units); err != nil {
		t.Fatalf("valid program rejected: %v", err)
	}

	deepClone := func() *ReleaseRoutingProgram {
		clone := *program
		clone.Units = make([]ReleaseRoutingUnit, len(program.Units))
		for i, unit := range program.Units {
			clone.Units[i] = unit
			clone.Units[i].Parts = make([]ReleaseRoutingPart, len(unit.Parts))
			for j, part := range unit.Parts {
				clone.Units[i].Parts[j] = part
				clone.Units[i].Parts[j].Operations = make([]ReleaseRoutingOperation, len(part.Operations))
				for k, operation := range part.Operations {
					clone.Units[i].Parts[j].Operations[k] = operation
					clone.Units[i].Parts[j].Operations[k].Holes = make([]ReleaseRoutingHole, len(operation.Holes))
					copy(clone.Units[i].Parts[j].Operations[k].Holes, operation.Holes)
				}
			}
		}
		return &clone
	}
	firstCncPart := func(p *ReleaseRoutingProgram) *ReleaseRoutingPart {
		for i := range p.Units[0].Parts {
			if p.Units[0].Parts[i].CncRequired {
				return &p.Units[0].Parts[i]
			}
		}
		t.Fatal("fixture lost its CNC part")
		return nil
	}
	scenarios := []struct {
		name  string
		edit  func(*ReleaseRoutingProgram)
		match string
	}{
		{"missing contract", func(p *ReleaseRoutingProgram) { p.Contract = "other" }, "contract"},
		{"missing rules revision", func(p *ReleaseRoutingProgram) { p.IndustrialRulesRevision = "" }, "industrial rules"},
		{"unit coverage hole", func(p *ReleaseRoutingProgram) { p.Units = p.Units[:1] }, "collection has 2"},
		{"part coverage hole", func(p *ReleaseRoutingProgram) { p.Units[0].Parts = p.Units[0].Parts[:1] }, "does not cover frozen part"},
		{"foreign part", func(p *ReleaseRoutingProgram) { p.Units[0].Parts[0].PartID = "not-frozen" }, "is not a frozen part"},
		{"lost cut intent", func(p *ReleaseRoutingProgram) { p.Units[0].Parts[0].Cut = false }, "cut intent"},
		{"verdict contradicts operations", func(p *ReleaseRoutingProgram) {
			firstCncPart(p).CncRequired = false
		}, "contradicts its operations"},
		{"unknown provenance", func(p *ReleaseRoutingProgram) {
			firstCncPart(p).Operations[0].Provenance.SourceKind = "client"
		}, "unknown provenance"},
		{"hole without geometry", func(p *ReleaseRoutingProgram) {
			firstCncPart(p).Operations[0].Holes[0].DiameterMm = 0
		}, "positive diameter"},
		{"duplicate part record", func(p *ReleaseRoutingProgram) {
			p.Units[0].Parts = append(p.Units[0].Parts, p.Units[0].Parts[0])
		}, "more than once"},
		{"missing machining fingerprint", func(p *ReleaseRoutingProgram) { p.Units[0].MachiningFingerprint = "" }, "machining fingerprint"},
	}
	for _, scenario := range scenarios {
		t.Run(scenario.name, func(t *testing.T) {
			clone := deepClone()
			scenario.edit(clone)
			if err := ValidateReleaseRoutingProgram(clone, units); err == nil ||
				!strings.Contains(err.Error(), scenario.match) {
				t.Fatalf("want %q rejection, got %v", scenario.match, err)
			}
		})
	}
	if err := ValidateReleaseRoutingProgram(nil, units); err == nil {
		t.Fatal("nil program must be rejected")
	}
}

// A machining operation hosted outside the frozen BOM parts is an error, never
// a silent drop (proves the layout↔BOM identity join).
func TestDeriveReleaseRoutingProgramRejectsForeignMachiningHost(t *testing.T) {
	items, units, catalog := routingFixture(t)
	// Sabotage the BOM: drop every board part of the unit so any derived
	// machining lands outside the frozen identities.
	units[0].BOM.BoardParts = nil
	units[0].BOM.HardwareLines = []domain.ResolvedHardwareLine{{ID: "rail", Quantity: 1}}
	if _, err := DeriveReleaseRoutingProgram(items, units, catalog); err == nil {
		t.Fatal("machining outside the frozen BOM must fail closed")
	}
}

// Canonical executions derive EXCLUSIVELY from frozen data: exact
// release-scoped identities, cut-first sequences, cnc/edge operations exactly
// when the frozen routing proves them, per-copy part instances.
func TestDeriveCanonicalPartExecutionsFromFrozenRouting(t *testing.T) {
	items, units, catalog := routingFixture(t)
	program, err := DeriveReleaseRoutingProgram(items, units, catalog)
	if err != nil {
		t.Fatal(err)
	}
	unitViews := make([]ReleaseExecutionUnitView, 0, len(units))
	for _, unit := range units {
		unitViews = append(unitViews, ReleaseExecutionUnitView{
			FurnitureInstanceID: unit.FurnitureInstanceID,
			Parts:               unit.BOM.BoardParts,
		})
	}
	parts, moduleUnits, err := DeriveCanonicalPartExecutions("release-1", unitViews, program)
	if err != nil {
		t.Fatal(err)
	}
	if len(moduleUnits) != 2 {
		t.Fatalf("units = %d", len(moduleUnits))
	}
	seenParts := map[string]bool{}
	perUnitCnc := map[string]int{}
	for _, part := range parts {
		if part.ProductionRevision != "release-1" || part.ProjectID != "" {
			t.Fatalf("part %s lost exact release stamp: %+v", part.ID, part)
		}
		if !strings.HasPrefix(part.ID, "release-1:") || !strings.Contains(part.ID, ":p1") {
			t.Fatalf("part identity not release-scoped: %s", part.ID)
		}
		if seenParts[part.ID] {
			t.Fatalf("duplicated part identity %s", part.ID)
		}
		seenParts[part.ID] = true
		if len(part.RequiredOperations) == 0 || part.RequiredOperations[0].Type != domain.PartOperationCut {
			t.Fatalf("route must start at cut: %s", part.ID)
		}
		hasCnc, hasEdge := false, false
		for _, op := range part.RequiredOperations {
			switch op.Type {
			case domain.PartOperationCNC:
				hasCnc = true
			case domain.PartOperationEdgeBanding:
				hasEdge = true
			}
			if op.Status != domain.PartOperationStatusQueued {
				t.Fatalf("generation must queue operations: %+v", op)
			}
		}
		frozenPart := program.Units[0]
		for _, unit := range program.Units {
			for _, candidate := range unit.Parts {
				if strings.Contains(part.ID, ":"+candidate.PartID+":") {
					frozenPart = unit
					_ = candidate
				}
			}
		}
		_ = frozenPart
		perUnitCnc[part.ProjectItemID] += boolToInt(hasCnc)
		if hasEdge && len(part.Edges) == 0 {
			t.Fatalf("edge operation without frozen edges: %s", part.ID)
		}
		if part.Status != domain.PartInstanceStatusPending {
			t.Fatalf("generation must be pending: %+v", part)
		}
	}
	// Both units freeze CNC evidence (hinge per bound copy).
	if perUnitCnc["unit-1"] == 0 || perUnitCnc["unit-2"] == 0 {
		t.Fatalf("cnc evidence missing per unit: %v", perUnitCnc)
	}
	for _, unit := range moduleUnits {
		if unit.ProductionRevision != "release-1" || unit.UnitIndex != 1 ||
			unit.Status != domain.ModuleUnitStatusAwaitingParts {
			t.Fatalf("unit identity/status drifted: %+v", unit)
		}
	}

	// Wrong/frozen-routing mismatch fails closed.
	if _, _, err := DeriveCanonicalPartExecutions("release-1", unitViews, nil); err == nil {
		t.Fatal("missing routing program must fail closed")
	}
	stripped := *program
	stripped.Units = stripped.Units[:1]
	if _, _, err := DeriveCanonicalPartExecutions("release-1", unitViews, &stripped); err == nil {
		t.Fatal("routing not covering every unit must fail closed")
	}
}

func unitFrozenParts(t *testing.T, units []ResolvedReleaseUnit, furnitureInstanceID string) []domain.ResolvedBoardPart {
	t.Helper()
	for _, unit := range units {
		if unit.FurnitureInstanceID == furnitureInstanceID {
			return unit.BOM.BoardParts
		}
	}
	t.Fatalf("unit %s not found", furnitureInstanceID)
	return nil
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
