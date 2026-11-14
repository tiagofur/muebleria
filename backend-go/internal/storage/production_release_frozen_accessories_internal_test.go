package storage

// #1627 s3 — pure mapping of the quote's frozen inserts onto the release
// items (no database): bound units take their frozen inserts, a snapshot
// frozen before #1627 leaves unchosen optional groups without insert, and
// units the snapshot does not describe stay untouched.

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func frozenAccessoryCatalog() domain.Catalog {
	kit := "kit-e"
	return domain.Catalog{
		Hardware: []domain.Hardware{
			{ID: kit, Code: "KIT-E", Name: "Kit E", Unit: "set", Active: true},
			{ID: "hw-gal", Code: "GAL", Name: "Galería", Unit: "set", Active: true},
			{ID: "hw-cap", Code: "CAP", Name: "Boxcap", Unit: "set", Active: true},
		},
		Agregados: []domain.Agregado{{ID: "agr-e", Code: "AGR-E", Name: "Cajón E", Active: true, CommercialKitHardwareID: &kit}},
		OptionGroups: []domain.OptionGroup{
			{ID: "og-ins", Code: "INS_E", Name: "Insertos", Kind: "hardware", OptionIDs: []string{"hw-gal", "hw-cap"}, KitHardwareID: &kit},
		},
		Modules: []domain.Module{{
			ID: "mod-e", Code: "MOD-E", Name: "Cajonera",
			Agregados: []domain.ModuleAgregadoInstance{{ID: "inst-e", AgregadoID: "agr-e", Quantity: 1}},
		}},
	}
}

func TestApplyFrozenAccessoriesToItems_1627(t *testing.T) {
	catalog := frozenAccessoryCatalog()
	items := []domain.DesignRevisionItem{
		{FurnitureInstanceID: "fi-new", FurnitureDefinitionID: "mod-e", MaterialChoices: map[string]string{}},
		{FurnitureInstanceID: "fi-legacy", FurnitureDefinitionID: "mod-e", MaterialChoices: map[string]string{}},
		{FurnitureInstanceID: "fi-legacy-explicit", FurnitureDefinitionID: "mod-e", MaterialChoices: map[string]string{"INS_E": "hw-cap"}},
		{FurnitureInstanceID: "fi-unbound", FurnitureDefinitionID: "mod-e", MaterialChoices: map[string]string{}},
	}
	snapshot := &domain.QuoteCommercialSnapshot{Units: []domain.QuoteCommercialUnit{
		{FurnitureInstanceID: "fi-new", PricingContext: &domain.QuoteCommercialPricingContext{AccessoryChoices: map[string]string{"INS_E": "hw-gal"}}},
		{FurnitureInstanceID: "fi-legacy", PricingContext: &domain.QuoteCommercialPricingContext{}},
		{FurnitureInstanceID: "fi-legacy-explicit", PricingContext: &domain.QuoteCommercialPricingContext{}},
	}}

	out := applyFrozenAccessoriesToItems(snapshot, items, catalog)
	want := map[string]string{
		"fi-new":             "hw-gal",
		"fi-legacy":          domain.AccessoryChoiceNone,
		"fi-legacy-explicit": "hw-cap",
		"fi-unbound":         "",
	}
	for _, item := range out {
		if got := item.MaterialChoices["INS_E"]; got != want[item.FurnitureInstanceID] {
			t.Fatalf("%s: INS_E = %q, want %q", item.FurnitureInstanceID, got, want[item.FurnitureInstanceID])
		}
	}
	for _, item := range items {
		if item.FurnitureInstanceID != "fi-legacy-explicit" && len(item.MaterialChoices) != 0 {
			t.Fatalf("the input items must never be mutated: %+v", item)
		}
	}
}
