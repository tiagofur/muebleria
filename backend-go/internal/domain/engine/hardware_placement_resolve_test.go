package engine

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// oneDoorCabinetWithHingeGroup extends the one-door cabinet fixture with a
// hardware option group (BISAGRA: Blum cierre lento vs económica) and a
// role-based hinge placement on the door (#1046).
func oneDoorCabinetWithHingeGroup(requiredGroup bool) (domain.Module, domain.Catalog) {
	module, catalog := oneDoorCabinetCatalog()

	blum := domain.Hardware{
		ID: "hw-bisagra-cl", Code: "BIS-CL110", Name: "Bisagra cierre lento", Unit: domain.UnitPiece, Active: true,
		PreviewShape: strPtr("hinge"),
	}
	eco := domain.Hardware{
		ID: "hw-bisagra-eco", Code: "BIS-ECO", Name: "Bisagra económica", Unit: domain.UnitPiece, Active: true,
		PreviewShape: strPtr("hinge"),
	}
	catalog.Hardware = append(catalog.Hardware, blum, eco)
	catalog.OptionGroups = []domain.OptionGroup{{
		ID: "og-bisagra", Code: "BISAGRA", Name: "Bisagras", Kind: "hardware",
		Required: requiredGroup, OptionIDs: []string{"hw-bisagra-cl", "hw-bisagra-eco"},
	}}

	for i := range module.Components {
		if module.Components[i].ComponentID == "comp-door" {
			module.Components[i].Overrides = &domain.ComponentInstanceOverrides{
				HardwarePlacements: []domain.HardwarePlacement{{
					OptionRole:       "BISAGRA",
					AnchorFace:       "front",
					RelativePosition: domain.HardwareRelPosition{XMm: 100, YMm: 100},
				}},
			}
		}
	}
	return module, catalog
}

func TestResolveLayoutSubstitutesRolePlacementHardware(t *testing.T) {
	module, catalog := oneDoorCabinetWithHingeGroup(true)
	choices := map[string]string{"BISAGRA": "hw-bisagra-cl"}

	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, nil, choices, resolveOptions{})
	if err != nil {
		t.Fatalf("layout resolve: %v", err)
	}
	found := false
	for _, hw := range layout.Hardware {
		if hw.HardwareID == "hw-bisagra-cl" {
			found = true
		}
		if hw.HardwareID == "" {
			t.Fatalf("layout hardware carries an unresolved role: %+v", hw)
		}
	}
	if !found {
		t.Fatalf("expected the chosen hinge hw-bisagra-cl in layout hardware, got %+v", layout.Hardware)
	}
}

func TestResolveLayoutRoleWithoutChoiceFailsClosedWhenRequired(t *testing.T) {
	module, catalog := oneDoorCabinetWithHingeGroup(true)

	_, _, err := resolveFurnitureLayoutOpts(module, catalog, nil, map[string]string{}, resolveOptions{})
	if err == nil || !strings.Contains(err.Error(), "BISAGRA") {
		t.Fatalf("expected required-group failure naming BISAGRA, got %v", err)
	}
}

func TestResolveLayoutRoleWithoutChoiceDropsOptionalPlacement(t *testing.T) {
	module, catalog := oneDoorCabinetWithHingeGroup(false)

	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, nil, map[string]string{}, resolveOptions{})
	if err != nil {
		t.Fatalf("optional group without choice must not fail the resolve: %v", err)
	}
	for _, hw := range layout.Hardware {
		if hw.HardwareID == "hw-bisagra-cl" || hw.HardwareID == "hw-bisagra-eco" {
			t.Fatalf("optional placement without a choice must stay out, got %+v", hw)
		}
	}
}

func TestResolvePlacementHardwareIDsUnit(t *testing.T) {
	_, catalog := oneDoorCabinetWithHingeGroup(true)

	concrete := []domain.HardwarePlacement{{
		HardwareID: "hw-handle", AnchorFace: "front",
		RelativePosition: domain.HardwareRelPosition{XMm: 1, YMm: 2},
	}}
	out, err := resolvePlacementHardwareIDs(concrete, map[string]string{}, catalog, "b-1")
	if err != nil || len(out) != 1 || out[0].HardwareID != "hw-handle" {
		t.Fatalf("concrete placement must pass through untouched: %v %+v", err, out)
	}

	resolved, err := resolvePlacementHardwareIDs(
		[]domain.HardwarePlacement{{OptionRole: "BISAGRA", AnchorFace: "front"}},
		map[string]string{"BISAGRA": "hw-bisagra-eco"}, catalog, "b-1",
	)
	if err != nil || len(resolved) != 1 || resolved[0].HardwareID != "hw-bisagra-eco" {
		t.Fatalf("role must resolve to the chosen hardware: %v %+v", err, resolved)
	}

	if _, err := resolvePlacementHardwareIDs(
		[]domain.HardwarePlacement{{OptionRole: "BISAGRA", AnchorFace: "front"}},
		map[string]string{}, catalog, "b-1",
	); err == nil {
		t.Fatal("required group without a choice must fail closed")
	}

	inactive := catalog
	inactive.Hardware = append([]domain.Hardware{}, catalog.Hardware...)
	for i := range inactive.Hardware {
		if inactive.Hardware[i].ID == "hw-bisagra-eco" {
			inactive.Hardware[i].Active = false
		}
	}
	if _, err := resolvePlacementHardwareIDs(
		[]domain.HardwarePlacement{{OptionRole: "BISAGRA", AnchorFace: "front"}},
		map[string]string{"BISAGRA": "hw-bisagra-eco"}, inactive, "b-1",
	); err == nil || !strings.Contains(err.Error(), "inactiva") {
		t.Fatalf("inactive choice must fail closed: %v", err)
	}

	if _, err := resolvePlacementHardwareIDs(
		[]domain.HardwarePlacement{{AnchorFace: "front"}}, map[string]string{}, catalog, "b-1",
	); err == nil {
		t.Fatal("placement with neither hardwareId nor optionRole must fail")
	}
}

func TestConsumedOptionRolesIncludesPlacementRoles(t *testing.T) {
	module, catalog := oneDoorCabinetWithHingeGroup(true)
	choices := map[string]string{"BISAGRA": "hw-bisagra-cl"}

	consumed := ConsumedOptionRoles(module, choices, catalog, domain.ResolvedBom{})
	if consumed["BISAGRA"] != "hw-bisagra-cl" {
		t.Fatalf("placement role must consume its choice, got %+v", consumed)
	}

	if err := validateReleaseUnitChoices(module, choices, catalog, domain.ResolvedBom{}); err != nil {
		t.Fatalf("the frozen choice set must pass the release gate: %v", err)
	}

	// Without the choice in the map nothing is consumed (required-group
	// failures block at resolve; the gate must not fabricate consumption).
	consumed = ConsumedOptionRoles(module, map[string]string{}, catalog, domain.ResolvedBom{})
	if _, ok := consumed["BISAGRA"]; ok {
		t.Fatalf("no choice → no consumption, got %+v", consumed)
	}
}
