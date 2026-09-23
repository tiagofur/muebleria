package engine

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #826: the consumed-role derivation is the single source of truth shared by
// the release gate and every seeding surface. These tests pin the parity
// between ConsumedOptionRoles/Intersect/Reject and validateReleaseUnitChoices,
// the BOM-neutrality of the intersection, and the base-treatment conservatism.

// consumptionFixture builds one resolvable unit whose definition consumes
// INTERIOR (board), EDGE (edged part) and HINGE (optional hardware line).
func consumptionFixture(t *testing.T) (domain.DesignRevisionItem, domain.Catalog) {
	t.Helper()
	item, catalog := releaseUnitFixture(t)
	module := &catalog.Modules[0]
	module.StructureID, module.ParameterDefinitions, module.Components = "", nil, nil
	module.BoardParts = []domain.BoardPart{{ID: "fixed-part", Description: "Fixed panel", Quantity: 1, LengthMm: 600, WidthMm: 400, OptionRole: "INTERIOR", Edges: []domain.EdgeAssignment{{Side: "L1", Enabled: true}, {Side: "L2"}, {Side: "W1"}, {Side: "W2"}}}}
	module.HardwareLines = []domain.HardwareLine{{ID: "hinge-line", OptionRole: "HINGE", Quantity: 2}}
	catalog.Edges = []domain.EdgeBand{{ID: "edge", Active: true}}
	catalog.Hardware = []domain.Hardware{{ID: "hinge", Active: true}}
	item.Parameters = nil
	item.MaterialChoices = map[string]string{"INTERIOR": "mat-body", "EDGE": "edge", "HINGE": "hinge"}
	return item, catalog
}

func TestConsumedOptionRolesMatchesReleaseGate(t *testing.T) {
	item, catalog := consumptionFixture(t)
	unit, err := resolveReleaseUnit(item, catalog, nil)
	if err != nil {
		t.Fatal(err)
	}
	consumed := ConsumedOptionRoles(catalog.Modules[0], item.MaterialChoices, catalog, unit.BOM)
	if !reflect.DeepEqual(map[string]string{"INTERIOR": "mat-body", "EDGE": "edge", "HINGE": "hinge"}, consumed) {
		t.Fatalf("consumed derivation mismatch: %+v", consumed)
	}
	if err := validateReleaseUnitChoices(catalog.Modules[0], item.MaterialChoices, catalog, unit.BOM); err != nil {
		t.Fatalf("gate must accept exactly the consumed set: %v", err)
	}
	// Any role outside the consumed set is what the gate rejects — the helper
	// and the verdict share one derivation.
	extra := map[string]string{"INTERIOR": "mat-body", "EDGE": "edge", "HINGE": "hinge", "JALADERA": "hinge"}
	gateErr := validateReleaseUnitChoices(catalog.Modules[0], extra, catalog, unit.BOM)
	if gateErr == nil || !contains(gateErr.Error(), "JALADERA") {
		t.Fatalf("gate must reject the unconsumed role by name: %v", gateErr)
	}
	if _, ok := consumed["JALADERA"]; ok {
		t.Fatal("helper must not report unconsumed roles")
	}
}

func TestIntersectConsumedOptionChoicesBomNeutral(t *testing.T) {
	item, catalog := consumptionFixture(t)
	// Commercial seed carrying every group: only consumed roles survive,
	// except base-treatment roles which are never dropped.
	item.MaterialChoices = map[string]string{
		"INTERIOR": "mat-body", "EDGE": "edge", "HINGE": "hinge",
		"JALADERA": "hinge", "CORREDERA": "hinge", "FRENTES": "mat-body",
		"ZOCLO": "mat-body", "BISAGRA": "hinge",
	}
	before, err := resolveReleaseUnitOpt(domain.DesignRevisionItem{FurnitureInstanceID: item.FurnitureInstanceID,
		FurnitureDefinitionID: item.FurnitureDefinitionID, Parameters: nil,
		MaterialChoices: map[string]string{"INTERIOR": "mat-body", "EDGE": "edge", "HINGE": "hinge"}}, catalog, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	filtered, ok := IntersectConsumedOptionChoices(item, catalog)
	if !ok {
		t.Fatal("resolvable unit must intersect")
	}
	want := map[string]string{"INTERIOR": "mat-body", "EDGE": "edge", "HINGE": "hinge", "ZOCLO": "mat-body"}
	if !reflect.DeepEqual(want, filtered) {
		t.Fatalf("intersection must keep consumed + base-treatment roles only: %+v", filtered)
	}
	after, err := resolveReleaseUnitOpt(domain.DesignRevisionItem{FurnitureInstanceID: item.FurnitureInstanceID,
		FurnitureDefinitionID: item.FurnitureDefinitionID, Parameters: nil,
		MaterialChoices: filtered}, catalog, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	beforeJSON, _ := json.Marshal(before.BOM)
	afterJSON, _ := json.Marshal(after.BOM)
	if string(beforeJSON) != string(afterJSON) {
		t.Fatal("intersection changed the resolved BOM — pricing is not neutral")
	}
	// Known conservative limit, pinned: a base-treatment role kept for pricing
	// safety is still rejected by the strict release gate when the module
	// default base mode does not consume it (pre-existing behavior).
	if _, err := ResolveReleaseUnit(domain.DesignRevisionItem{FurnitureInstanceID: item.FurnitureInstanceID,
		FurnitureDefinitionID: item.FurnitureDefinitionID, Parameters: nil,
		MaterialChoices: filtered}, catalog); err == nil {
		t.Fatal("strict gate behavior changed — document or revisit")
	}
}

func TestIntersectSkipsUnresolvableUnits(t *testing.T) {
	item, catalog := consumptionFixture(t)
	version := 3
	item.DefinitionVersion = &version
	filtered, ok := IntersectConsumedOptionChoices(item, catalog)
	if ok || !reflect.DeepEqual(item.MaterialChoices, filtered) {
		t.Fatal("unresolvable units keep their choices untouched")
	}
}

// #826 review case 2: an empty consumed-role set does NOT mean zero demand.
// A module made only of FIXED-ID hardware lines resolves a valid hardware BOM
// while consuming no choice role at all — surplus roles must converge there,
// with the BOM byte-identical (fixed hardware ignores choices by definition).
func TestIntersectConvergesWhenOnlyFixedHardwareConsumes(t *testing.T) {
	item, catalog := consumptionFixture(t)
	module := &catalog.Modules[0]
	module.BoardParts = nil
	module.HardwareLines = []domain.HardwareLine{{ID: "rail-fixed", HardwareID: "hinge", Quantity: 4}}
	item.Parameters = nil
	item.MaterialChoices = map[string]string{"JALADERA": "hinge", "CORREDERA": "hinge"}

	before, err := resolveReleaseUnitOpt(item, catalog, nil, false)
	if err != nil {
		t.Fatalf("fixed-hardware module must resolve: %v", err)
	}
	if len(before.BOM.HardwareLines) == 0 {
		t.Fatal("fixture must produce hardware demand")
	}
	filtered, ok := IntersectConsumedOptionChoices(item, catalog)
	if !ok {
		t.Fatal("hardware-demand BOM with no consumed roles must still converge")
	}
	if len(filtered) != 0 {
		t.Fatalf("no role is consumed — every surplus role must converge away, got %+v", filtered)
	}
	converged := item
	converged.MaterialChoices = filtered
	after, err := resolveReleaseUnitOpt(converged, catalog, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	beforeJSON, _ := json.Marshal(before.BOM)
	afterJSON, _ := json.Marshal(after.BOM)
	if string(beforeJSON) != string(afterJSON) {
		t.Fatal("convergence changed the fixed-hardware BOM — not neutral")
	}
	// The strict release gate accepts the converged unit (choices ≡ consumed).
	if _, err := ResolveReleaseUnit(converged, catalog); err != nil {
		t.Fatalf("converged unit must be release-resolvable: %v", err)
	}
}

// #826 review case 2 counterpart: a genuinely zero-demand unit (no board
// parts, no hardware) keeps its choices — nothing proves any role unused and
// the release gate already blocks it with the typed zero-demand verdict.
func TestIntersectKeepsChoicesWhenBOMHasNoDemand(t *testing.T) {
	item, catalog := consumptionFixture(t)
	module := &catalog.Modules[0]
	module.BoardParts = nil
	module.HardwareLines = nil
	item.Parameters = nil
	item.MaterialChoices = map[string]string{"JALADERA": "hinge"}
	filtered, ok := IntersectConsumedOptionChoices(item, catalog)
	if ok || !reflect.DeepEqual(item.MaterialChoices, filtered) {
		t.Fatal("zero-demand units keep their choices untouched")
	}
}
