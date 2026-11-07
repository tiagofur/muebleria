package engine_test

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1555 (P1 del review ronda 2, PR #1563): the #826 consumed-role derivation
// (shared by the design working-copy intersection, the quote freeze and the
// release gate) must keep the choice keys the resolve CONSULTS when it draws
// and quotes a bay — the kit accessory groups and the agregado option role.
// Dropping them changed the NEXT resolve's BOM (the accessory line vanished;
// a non-default drawer fell back to the default kit), violating the
// BOM-neutrality guarantee #826 declares. Built on the SAME resolvable
// accessory scenario as the #1502 parity contract.

// filterByConsumed applies the #826 intersection rule (keep only consumed
// roles) — exactly what IntersectConsumedOptionChoices computes on the
// resolved unit.
func filterByConsumed(choices, consumed map[string]string) map[string]string {
	out := map[string]string{}
	for role, id := range choices {
		if _, ok := consumed[role]; ok {
			out[role] = id
		}
	}
	return out
}

func TestConsumedOptionRolesKeepsAccessoryChoiceBomNeutral_1555(t *testing.T) {
	f := loadAccessoryKitFixture(t)
	catalog, mod := buildAccessoryKitScenario(f, true, true)
	choices := accessoryTestChoices(f, map[string]string{f.AccessoryGroup.Code: f.ChosenAccessoryID})

	bom, err := engine.ResolveBomWithContext(mod, choices, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("ResolveBomWithContext: %v", err)
	}
	if got := len(accessoryKitLinesOf(bom)); got != 1 {
		t.Fatalf("scenario precondition: expected 1 accessory kit line, got %d", got)
	}

	consumed := engine.ConsumedOptionRoles(mod, choices, catalog, bom)
	if consumed[f.AccessoryGroup.Code] != f.ChosenAccessoryID {
		t.Fatalf("the accessory group %s must be consumed with the chosen id %q: consumed=%v",
			f.AccessoryGroup.Code, f.ChosenAccessoryID, consumed)
	}
	// Gate condition (validateReleaseUnitChoices): every choice is consumed
	// with exactly its value.
	for role, id := range choices {
		if consumed[role] != id {
			t.Fatalf("gate would reject %s=%s: consumed=%v", role, id, consumed)
		}
	}

	// End-to-end neutrality: the filtered map resolves the SAME accessory
	// demand as the original — the line the user chose survives the save.
	filtered := filterByConsumed(choices, consumed)
	bomFiltered, err := engine.ResolveBomWithContext(mod, filtered, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("ResolveBomWithContext (filtered): %v", err)
	}
	before, after := accessoryKitLinesOf(bom), accessoryKitLinesOf(bomFiltered)
	if len(after) != len(before) || after[0].ID != before[0].ID || after[0].HardwareID != before[0].HardwareID {
		t.Fatalf("BOM-neutrality violated: accessory lines before=%+v after=%+v", before, after)
	}
}

func TestConsumedOptionRolesDropsNonMemberAccessory_1555(t *testing.T) {
	f := loadAccessoryKitFixture(t)
	catalog, mod := buildAccessoryKitScenario(f, true, false)
	choices := accessoryTestChoices(f, map[string]string{f.AccessoryGroup.Code: "hw-ajeno"})

	bom, err := engine.ResolveBomWithContext(mod, choices, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("ResolveBomWithContext: %v", err)
	}
	consumed := engine.ConsumedOptionRoles(mod, choices, catalog, bom)
	if _, ok := consumed[f.AccessoryGroup.Code]; ok {
		t.Fatalf("a non-member accessory is consumed by nobody: %v", consumed)
	}
	if _, kept := filterByConsumed(choices, consumed)[f.AccessoryGroup.Code]; kept {
		t.Fatal("the non-member choice must be dropped by the intersection (and rejected by the gate)")
	}
}

func TestConsumedOptionRolesAgregadoRoleChoice_1555(t *testing.T) {
	kitA, kitB := "kit-a", "kit-b"
	catalog := domain.Catalog{
		Agregados: []domain.Agregado{
			{ID: "agr-a", Code: "CAJON-A", Name: "Cajón A", Active: true, CommercialKitHardwareID: &kitA},
			{ID: "agr-b", Code: "CAJON-B", Name: "Cajón B", Active: true, CommercialKitHardwareID: &kitB},
		},
	}
	mod := domain.Module{
		ID: "mod-drawer", Code: "MOD-DRW", Name: "Base con cajón",
		Agregados: []domain.ModuleAgregadoInstance{
			{ID: "inst-1", AgregadoID: "agr-a", OptionRole: "CAJON", Quantity: 1},
		},
	}

	t.Run("non-default drawer choice is consumed (it changes the kit)", func(t *testing.T) {
		consumed := engine.ConsumedOptionRoles(mod, map[string]string{"CAJON": "agr-b"}, catalog, domain.ResolvedBom{})
		if consumed["CAJON"] != "agr-b" {
			t.Fatalf("the drawer choice governed the bay: consumed=%v", consumed)
		}
	})

	t.Run("default drawer choice is consumed too (gate neutrality)", func(t *testing.T) {
		consumed := engine.ConsumedOptionRoles(mod, map[string]string{"CAJON": "agr-a"}, catalog, domain.ResolvedBom{})
		if consumed["CAJON"] != "agr-a" {
			t.Fatalf("an explicit choice equal to the default still governs: consumed=%v", consumed)
		}
	})

	t.Run("unknown drawer id is consumed by nobody", func(t *testing.T) {
		consumed := engine.ConsumedOptionRoles(mod, map[string]string{"CAJON": "agr-fantasma"}, catalog, domain.ResolvedBom{})
		if _, ok := consumed["CAJON"]; ok {
			t.Fatalf("a non-existent agregado must stay droppable/rejectable: %v", consumed)
		}
	})

	t.Run("instance override wins: the group choice is not what governed", func(t *testing.T) {
		withOverride := mod
		withOverride.Agregados = []domain.ModuleAgregadoInstance{{
			ID: "inst-1", AgregadoID: "agr-a", OptionRole: "CAJON", Quantity: 1,
			OptionOverrides: map[string]string{"CAJON": "agr-a"},
		}}
		consumed := engine.ConsumedOptionRoles(withOverride, map[string]string{"CAJON": "agr-b"}, catalog, domain.ResolvedBom{})
		if consumed["CAJON"] == "agr-b" {
			t.Fatalf("the instance override governed the bay, not the group choice: %v", consumed)
		}
	})
}
