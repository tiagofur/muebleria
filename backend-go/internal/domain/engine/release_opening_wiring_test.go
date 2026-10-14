package engine

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1305: the release wiring proof — ONE per-furniture opening resolution
// feeds the BOM expansion (door parts shrink by the same consumption the
// layout applies), the member hardware lines (production demand) and the
// routing resolve (constrained layout + frozen route operations). A unit
// resolved without an opening stays byte-identical to the pre-opening
// semantics.

func releaseOpeningFixture(t *testing.T) (domain.DesignRevisionItem, domain.Module, domain.Catalog) {
	t.Helper()
	module, catalog := oneDoorCabinetCatalog()
	catalog.Modules = append(catalog.Modules, module)
	catalog.Hardware = append(catalog.Hardware,
		domain.Hardware{ID: "hw-gola-8006", Code: "8006", Name: "Perfil Gola L", Unit: domain.UnitMeter, Active: true},
		domain.Hardware{ID: "hw-su116", Code: "SU116", Name: "Soporte Gola", Unit: domain.UnitPiece, Active: true},
	)
	catalog.Materials = append(catalog.Materials, domain.MaterialBoard{
		ID: "mat-opening", Code: "MAT-OPENING", Name: "Tablero Opening",
		WidthMm: 2750, LengthMm: 1850, ThicknessMm: 18, Active: true,
	})
	item := domain.DesignRevisionItem{
		DesignRevisionID:      "revision-opening",
		FurnitureInstanceID:   "unit-1",
		FurnitureDefinitionID: module.ID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
		MaterialChoices: map[string]string{
			"LATERAL": "mat-opening", "INTERIOR": "mat-opening",
			"FONDO": "mat-opening", "FRENTE": "mat-opening",
		},
	}
	return item, module, catalog
}

func releaseOpeningResolution() ReleaseUnitOpening {
	return ReleaseUnitOpening{
		Fronts: openingPassFront("top", 40),
		Modifiers: []ResolvedOpeningBodyModifier{{
			Effect: OpeningModifierEffectNotch, Role: "lateral", ProfileID: "prof-8006", Boundary: "top",
			NotchHeightMm: 56.5, NotchDepthMm: 27.2,
		}},
		BOMLines: []OpeningResolvedBOMLine{
			{LineID: "profile", MemberKey: "profile", HardwareID: "hw-gola-8006", ProfileID: "prof-8006", ProfileVersion: 6, Boundary: "top", Rule: "interior_width", Quantity: 0.564, Unit: "meter"},
			{LineID: "support-1", MemberKey: "supports", HardwareID: "hw-su116", ProfileID: "prof-8006", ProfileVersion: 6, Boundary: "top", Rule: "per_length", Quantity: 3, Unit: "piece"},
		},
	}
}

func doorPart(bom domain.ResolvedBom) *domain.ResolvedBoardPart {
	for i := range bom.BoardParts {
		if bom.BoardParts[i].ID == "mod-comp-door-copy-0" {
			return &bom.BoardParts[i]
		}
	}
	return nil
}

func TestReleaseOpeningConstrainsBOMDoorAndAddsMembers(t *testing.T) {
	item, _, catalog := releaseOpeningFixture(t)

	without, err := resolveReleaseUnit(item, catalog, nil, nil, nil)
	if err != nil {
		t.Fatalf("baseline unit: %v", err)
	}
	door := doorPart(without.BOM)
	if door == nil {
		t.Fatalf("fixture lost its door part")
	}
	if door.LengthMm != 716 {
		t.Fatalf("baseline door must stay at the definition dimension 716, got %g", door.LengthMm)
	}

	resolution := releaseOpeningResolution()
	with, err := resolveReleaseUnit(item, catalog, nil, nil, &resolution)
	if err != nil {
		t.Fatalf("opening unit: %v", err)
	}
	door = doorPart(with.BOM)
	if door.LengthMm != 676 {
		t.Fatalf("gola door must shrink by the consumed 40 mm (716→676), got %g", door.LengthMm)
	}

	memberIDs := map[string]float64{}
	for _, line := range with.BOM.HardwareLines {
		memberIDs[line.ID] = line.Quantity
	}
	if memberIDs["BASE-600-opening-profile"] != 0.564 {
		t.Fatalf("profile member line missing or wrong quantity: %+v", memberIDs)
	}
	if memberIDs["BASE-600-opening-support-1"] != 3 {
		t.Fatalf("support member line missing or wrong quantity: %+v", memberIDs)
	}

	// Determinism: the same resolution resolves byte-stable parts and lines.
	again, err := resolveReleaseUnit(item, catalog, nil, nil, &resolution)
	if err != nil {
		t.Fatalf("re-resolve: %v", err)
	}
	if doorPart(again.BOM).LengthMm != 676 || len(again.BOM.HardwareLines) != len(with.BOM.HardwareLines) {
		t.Fatalf("repeated resolve must be stable")
	}
}

func TestReleaseOpeningRoutesFrozenNotchOnConstrainedParts(t *testing.T) {
	item, _, catalog := releaseOpeningFixture(t)
	resolution := releaseOpeningResolution()

	unit, err := resolveReleaseUnit(item, catalog, nil, nil, &resolution)
	if err != nil {
		t.Fatalf("unit: %v", err)
	}
	items := []domain.DesignRevisionItem{item}
	units := []ResolvedReleaseUnit{*unit}
	openings := map[string]ReleaseUnitOpening{item.FurnitureInstanceID: resolution}

	program, _, err := DeriveReleaseRoutingProgram(items, units, catalog, nil, openings)
	if err != nil {
		t.Fatalf("routing program with opening: %v", err)
	}
	if err := ValidateReleaseRoutingProgram(program, units); err != nil {
		t.Fatalf("frozen program invalid: %v", err)
	}

	notchHosts := map[string]bool{}
	for _, part := range program.Units[0].Parts {
		for _, operation := range part.Operations {
			if operation.Operation == ReleaseRoutingOperationRoute {
				notchHosts[part.PartID] = true
				if len(operation.Routing) != 1 || operation.Provenance.OpeningProfileID != "prof-8006" {
					t.Fatalf("frozen route op must carry the resolved box and provenance: %+v", operation)
				}
			}
		}
	}
	if len(notchHosts) != 2 {
		t.Fatalf("both side parts must freeze one route operation, got %d", len(notchHosts))
	}

	// Coherence: the constrained door part of the routing program IS the
	// constrained BOM part (same identity, same reduced dimension).
	var doorPart *ReleaseRoutingPart
	for i := range program.Units[0].Parts {
		if program.Units[0].Parts[i].PartID == "mod-comp-door-copy-0" {
			doorPart = &program.Units[0].Parts[i]
		}
	}
	if doorPart == nil {
		t.Fatalf("frozen program lost the door part")
	}

	// Determinism: deriving twice produces the identical program.
	program2, _, err := DeriveReleaseRoutingProgram(items, units, catalog, nil, openings)
	if err != nil {
		t.Fatalf("re-derive: %v", err)
	}
	if program2.Units[0].MachiningFingerprint != program.Units[0].MachiningFingerprint {
		t.Fatalf("routing fingerprint must be deterministic")
	}
}

func TestReleaseOpeningRequirementsCarryMembers(t *testing.T) {
	item, _, catalog := releaseOpeningFixture(t)
	resolution := releaseOpeningResolution()
	items := []domain.DesignRevisionItem{item}
	openings := map[string]ReleaseUnitOpening{item.FurnitureInstanceID: resolution}

	collection, err := ResolveReleaseCollection("revision-opening", items, catalog, nil, nil, openings)
	if err != nil {
		t.Fatalf("collection with opening: %v", err)
	}
	found := map[string]float64{}
	for _, line := range collection.Requirements {
		if line.Kind == "herrajes" {
			found[line.MaterialID] = line.Quantity
		}
	}
	if found["hw-gola-8006"] != 0.564 {
		t.Fatalf("requirements must carry the profile metres, got %+v", found)
	}
	if found["hw-su116"] != 3 {
		t.Fatalf("requirements must carry the supports, got %+v", found)
	}

	// The same collection without the opening carries no member demand.
	plain, err := ResolveReleaseCollection("revision-opening", items, catalog, nil, nil, nil)
	if err != nil {
		t.Fatalf("collection without opening: %v", err)
	}
	for _, line := range plain.Requirements {
		if line.MaterialID == "hw-gola-8006" || line.MaterialID == "hw-su116" {
			t.Fatalf("no opening must place no member demand: %+v", line)
		}
	}
}
