package engine

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1252 Acceptance 7: Explicit definition and verification of choice
// precedence when resolving hardware demand.
//
// Documented precedence contract (preserves current pricing & resolve):
//  1. Concrete Placement wins: if a ComponentInstance placement declares a
//     concrete HardwareID, that hardware is placed regardless of any option
//     group choice.
//  2. Unit Option Choice: if a placement declares an OptionRole without a
//     concrete HardwareID, it resolves through the effective optionChoices
//     map provided to the resolve engine.
//     - In design authoring (DesignWorkingItem / DesignRevisionItem),
//       optionChoices is the item's MaterialChoices (which carries design
//       authoring defaults rolled into the item, or per-item overrides).
//     - In formal quotation (ProjectItem), optionChoices is the item's
//       project_item_choices (line-item / project scope).
//  3. No Choice for Required Group: fails closed (returns error naming the
//     unresolved option group).
//  4. No Choice for Optional Group: optional placement is dropped (0 demand,
//     no error).

func TestHardwareChoicePrecedence_ConcretePlacementWinsOverGroupChoice(t *testing.T) {
	module, catalog := oneDoorCabinetWithHingeGroup(true)

	// Placement has both concrete ID and group role: concrete MUST win in layout.
	for i := range module.Components {
		if module.Components[i].ComponentID == "comp-door" {
			module.Components[i].Overrides.HardwarePlacements[0] = domain.HardwarePlacement{
				HardwareID:       "hw-bisagra-concrete",
				OptionRole:       "BISAGRA",
				AnchorFace:       "front",
				RelativePosition: domain.HardwareRelPosition{XMm: 100, YMm: 100},
			}
		}
	}
	catalog.Hardware = append(catalog.Hardware, domain.Hardware{
		ID: "hw-bisagra-concrete", Code: "BIS-CONCRETE", Name: "Bisagra concreta fija",
		Unit: domain.UnitPiece, Active: true, PreviewShape: strPtr("hinge"),
	})

	// Even if effective choices choose the other hinge:
	choices := map[string]string{"BISAGRA": "hw-bisagra-cl"}

	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, nil, choices, resolveOptions{})
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}

	foundConcrete := false
	foundGroup := false
	for _, hw := range layout.Hardware {
		if hw.HardwareID == "hw-bisagra-concrete" {
			foundConcrete = true
		}
		if hw.HardwareID == "hw-bisagra-cl" {
			foundGroup = true
		}
	}
	if !foundConcrete {
		t.Fatalf("expected concrete placement hw-bisagra-concrete to win in layout, got %+v", layout.Hardware)
	}
	if foundGroup {
		t.Fatalf("group choice hw-bisagra-cl must not be placed when placement is concrete")
	}
}

func TestHardwareChoicePrecedence_UnitOptionChoiceResolvesGroupDemand(t *testing.T) {
	module, catalog := oneDoorCabinetWithHingeGroup(true)
	choices := boardMaterials(&catalog)
	// Design/Project chooses eco hinge:
	choices["BISAGRA"] = "hw-bisagra-eco"

	bom, err := ResolveBomWithContext(module, choices, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("resolve bom: %v", err)
	}

	byID := hardwareLinesByHardwareID(bom)
	if _, ecoFound := byID["hw-bisagra-eco"]; !ecoFound {
		t.Fatalf("expected group choice hw-bisagra-eco, got %+v", bom.HardwareLines)
	}
	if _, clFound := byID["hw-bisagra-cl"]; clFound {
		t.Fatalf("unselected choice hw-bisagra-cl must not be placed")
	}
}

func TestHardwareChoicePrecedence_MissingChoiceForRequiredGroupFailsClosed(t *testing.T) {
	module, catalog := oneDoorCabinetWithHingeGroup(true)
	choices := map[string]string{} // no choice for required BISAGRA

	// In layout resolve, required group without a choice fails closed:
	_, _, err := resolveFurnitureLayoutOpts(module, catalog, nil, choices, resolveOptions{})
	if err == nil {
		t.Fatal("expected failure when required group has no choice")
	}
}

func TestHardwareChoicePrecedence_MissingChoiceForOptionalGroupDropsDemand(t *testing.T) {
	module, catalog := oneDoorCabinetWithHingeGroup(false) // optional
	choices := boardMaterials(&catalog)
	delete(choices, "BISAGRA")

	bom, err := ResolveBomWithContext(module, choices, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("optional group without choice must not error: %v", err)
	}

	byID := hardwareLinesByHardwareID(bom)
	if _, found := byID["hw-bisagra-cl"]; found {
		t.Fatalf("no hinge should be placed when optional group has no choice")
	}
	if _, found := byID["hw-bisagra-eco"]; found {
		t.Fatalf("no hinge should be placed when optional group has no choice")
	}
}
