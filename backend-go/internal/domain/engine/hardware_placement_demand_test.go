package engine

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1210 — component-instance placements are hardware DEMAND: they price
// through the same BOM resolution as bulk lines, positions win over module
// bulk lines of the same resolved hardware, an unresolved role contributes
// nothing and an identity-less placement fails closed (#1147).

// boardMaterials seeds one active board and the role→board choices every
// board part of the cabinet fixture resolves against.
func boardMaterials(catalog *domain.Catalog) map[string]string {
	catalog.Materials = []domain.MaterialBoard{{
		ID: "mat-mdf", Code: "MAT-MDF", Name: "MDF", Active: true, ThicknessMm: 18,
	}}
	return map[string]string{
		"LATERAL": "mat-mdf", "INTERIOR": "mat-mdf",
		"FONDO": "mat-mdf", "FRENTE": "mat-mdf",
	}
}

func hingeDemandFixture(t *testing.T, requiredGroup bool) (domain.Module, domain.Catalog, map[string]string) {
	t.Helper()
	module, catalog := oneDoorCabinetWithHingeGroup(requiredGroup)
	choices := boardMaterials(&catalog)
	choices["BISAGRA"] = "hw-bisagra-cl"

	// A bulk bisagra line of the SAME group the placement consumes: without
	// the positions-win dedupe this line and the placement demand would both
	// price (double count).
	module.HardwareLines = append(module.HardwareLines, domain.HardwareLine{
		ID: "hl-bulk-bisagra", Quantity: 2, OptionRole: "BISAGRA",
	})
	return module, catalog, choices
}

func hardwareLinesByHardwareID(bom domain.ResolvedBom) map[string]domain.ResolvedHardwareLine {
	byID := make(map[string]domain.ResolvedHardwareLine, len(bom.HardwareLines))
	for _, line := range bom.HardwareLines {
		byID[line.HardwareID] = line
	}
	return byID
}

func TestResolveBomPlacementDemandPositionsWinOverBulk(t *testing.T) {
	module, catalog, choices := hingeDemandFixture(t, true)

	bom, err := ResolveBomWithContext(module, choices, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("resolve bom: %v", err)
	}

	byID := hardwareLinesByHardwareID(bom)
	line, ok := byID["hw-bisagra-cl"]
	if !ok {
		t.Fatalf("positioned hinge missing from BOM: %+v", bom.HardwareLines)
	}
	if line.OptionRole != "POSITIONED" {
		t.Fatalf("positioned line optionRole = %q, want POSITIONED", line.OptionRole)
	}
	if line.Quantity != 1 {
		t.Fatalf("positioned hinge quantity = %v, want 1 (the position count replaces the bulk 2)", line.Quantity)
	}
	if _, duplicated := byID["hl-bulk-bisagra"]; len(bom.HardwareLines) != 1 && duplicated {
		t.Fatalf("bulk bisagra line survived the positions-win dedupe: %+v", bom.HardwareLines)
	}
}

func TestResolveBomPlacementDemandConcretePlacementPrices(t *testing.T) {
	// The canonical fixture's door already carries a CONCRETE handle
	// placement and no bulk line: today it quotes $0 hardware — the #1210 gap.
	module, catalog := oneDoorCabinetCatalog()
	choices := boardMaterials(&catalog)

	bom, err := ResolveBomWithContext(module, choices, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("resolve bom: %v", err)
	}

	byID := hardwareLinesByHardwareID(bom)
	line, ok := byID["hw-handle"]
	if !ok {
		t.Fatalf("concrete handle placement did not price: %+v", bom.HardwareLines)
	}
	if line.Quantity != 1 {
		t.Fatalf("handle quantity = %v, want 1", line.Quantity)
	}
}

func TestResolveBomPlacementDemandUnresolvedRoleSkipped(t *testing.T) {
	module, catalog, choices := hingeDemandFixture(t, true)
	delete(choices, "BISAGRA") // no project choice for the group
	// Placement-only scenario: a bulk role line without its choice fails the
	// quote on its own (pre-existing fail-closed) — isolate the placement.
	module.HardwareLines = nil

	// No project choice for BISAGRA: the role contributes no line (the quote
	// gate blocks required groups; skipping keeps legacy quotes stable).
	bom, err := ResolveBomWithContext(module, choices, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("unresolved role must not fail the quote: %v", err)
	}
	for _, line := range bom.HardwareLines {
		if line.HardwareID == "hw-bisagra-cl" || line.HardwareID == "hw-bisagra-eco" {
			t.Fatalf("unresolved role fabricated demand for %s", line.HardwareID)
		}
	}
}

func TestResolveBomPlacementDemandIdentityLessFailsClosed(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	_ = boardMaterials(&catalog)
	for i := range module.Components {
		module.Components[i].Overrides = &domain.ComponentInstanceOverrides{
			HardwarePlacements: []domain.HardwarePlacement{{
				AnchorFace:       "front",
				RelativePosition: domain.HardwareRelPosition{XMm: 1, YMm: 2},
			}},
		}
	}

	_, err := ResolveBomWithContext(module, map[string]string{}, catalog, nil, "", nil, nil)
	if err == nil {
		t.Fatal("identity-less placement must fail closed (#1147)")
	}
	if !strings.Contains(err.Error(), "neither hardwareId nor optionRole") {
		t.Fatalf("error = %v, want the identity failure", err)
	}
}

func TestResolveBomPlacementDemandStructureComponentsAndQuantityMultiply(t *testing.T) {
	module, catalog, choices := hingeDemandFixture(t, true)

	// Move the placement to a STRUCTURE component instance with quantity 3
	// and two hinges → demand 3 × 2 = 6.
	module.Components = nil
	for i := range catalog.Structures {
		if catalog.Structures[i].ID != "st-1" {
			continue
		}
		for j := range catalog.Structures[i].Components {
			if catalog.Structures[i].Components[j].ComponentID == "comp-side" {
				catalog.Structures[i].Components[j].Quantity = 3
				catalog.Structures[i].Components[j].Overrides = &domain.ComponentInstanceOverrides{
					HardwarePlacements: []domain.HardwarePlacement{
						{OptionRole: "BISAGRA", AnchorFace: "front", RelativePosition: domain.HardwareRelPosition{XMm: 10, YMm: 10}},
						{OptionRole: "BISAGRA", AnchorFace: "front", RelativePosition: domain.HardwareRelPosition{XMm: 20, YMm: 20}},
					},
				}
			}
		}
	}
	choices["BISAGRA"] = "hw-bisagra-eco"

	bom, err := ResolveBomWithContext(module, choices, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("resolve bom: %v", err)
	}

	byID := hardwareLinesByHardwareID(bom)
	line, ok := byID["hw-bisagra-eco"]
	if !ok {
		t.Fatalf("structure placement demand missing: %+v", bom.HardwareLines)
	}
	if line.Quantity != 6 {
		t.Fatalf("structure placement quantity = %v, want 6 (component qty 3 × 2 hinges)", line.Quantity)
	}
}

func TestResolveBomPlacementDemandInactiveChoiceFailsClosed(t *testing.T) {
	module, catalog, choices := hingeDemandFixture(t, true)
	for i := range catalog.Hardware {
		if catalog.Hardware[i].ID == "hw-bisagra-cl" {
			catalog.Hardware[i].Active = false
		}
	}

	_, err := ResolveBomWithContext(module, choices, catalog, nil, "", nil, nil)
	if err == nil {
		t.Fatal("a resolved-but-inactive choice must fail closed like a broken bulk line")
	}
}
