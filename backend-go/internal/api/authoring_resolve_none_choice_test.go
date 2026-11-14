package api

// #1627 s2 (review B2): the authoring resolve/preview choice validation
// accepts the explicit «Sin inserto» only on an OPTIONAL kit-linked insert
// group — never on a required one, nor on a group that is not tied to a kit.

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestValidateMaterialChoicesExplicitNoInsert_1627(t *testing.T) {
	kit := "kit-e"
	catalog := domain.Catalog{
		Hardware: []domain.Hardware{{ID: "hw-gal", Code: "GAL", Name: "Galería", Active: true}},
		OptionGroups: []domain.OptionGroup{
			{Code: "INS_OPT", Kind: "hardware", OptionIDs: []string{"hw-gal"}, KitHardwareID: &kit},
			{Code: "INS_REQ", Kind: "hardware", Required: true, OptionIDs: []string{"hw-gal"}, KitHardwareID: &kit},
			{Code: "BISAGRA", Kind: "hardware", OptionIDs: []string{"hw-gal"}},
		},
	}
	if issues := validateMaterialChoices(map[string]string{"INS_OPT": domain.AccessoryChoiceNone}, catalog); len(issues) != 0 {
		t.Fatalf("«Sin inserto» on an optional insert group must be accepted, got %+v", issues)
	}
	for _, group := range []string{"INS_REQ", "BISAGRA"} {
		issues := validateMaterialChoices(map[string]string{group: domain.AccessoryChoiceNone}, catalog)
		if len(issues) != 1 || issues[0].Code != "MATERIAL_CHOICE_INVALID" {
			t.Fatalf("%s: «Sin inserto» must stay invalid, got %+v", group, issues)
		}
	}
	if issues := validateMaterialChoices(map[string]string{"INS_OPT": "hw-gal"}, catalog); len(issues) != 0 {
		t.Fatalf("a real option keeps validating, got %+v", issues)
	}
}
