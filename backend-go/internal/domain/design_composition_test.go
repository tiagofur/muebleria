package domain

import (
	"reflect"
	"testing"
)

func TestComposeEffectiveDefinitionMaterials_FullInheritance(t *testing.T) {
	roles := []DefinitionRoleOptionSpec{
		{Role: "BODY", OptionIDs: []string{"mat-white", "mat-oak"}},
		{Role: "FRONT", OptionIDs: []string{"mat-oak", "mat-black"}},
	}
	defaults := DesignAuthoringDefaults{
		MaterialChoices: map[string]string{
			"BODY":  "mat-white",
			"FRONT": "mat-oak",
		},
	}

	res := ComposeEffectiveDefinitionMaterials("BASE-750", roles, defaults, nil)

	if res.FurnitureDefinitionID != "BASE-750" {
		t.Fatalf("expected definition ID BASE-750, got %s", res.FurnitureDefinitionID)
	}

	wantChoices := map[string]string{
		"BODY":  "mat-white",
		"FRONT": "mat-oak",
	}
	wantModes := map[string]DesignMaterialChoiceMode{
		"BODY":  DesignMaterialChoiceModeDesign,
		"FRONT": DesignMaterialChoiceModeDesign,
	}

	if !reflect.DeepEqual(res.MaterialChoices, wantChoices) {
		t.Errorf("MaterialChoices = %v, want %v", res.MaterialChoices, wantChoices)
	}
	if !reflect.DeepEqual(res.MaterialChoiceModes, wantModes) {
		t.Errorf("MaterialChoiceModes = %v, want %v", res.MaterialChoiceModes, wantModes)
	}
}

func TestComposeEffectiveDefinitionMaterials_IncompatibleDefaultFallsBackToOverride(t *testing.T) {
	roles := []DefinitionRoleOptionSpec{
		{Role: "FRONT", OptionIDs: []string{"mat-oak", "mat-black"}},
	}
	defaults := DesignAuthoringDefaults{
		MaterialChoices: map[string]string{
			"FRONT": "mat-forbidden", // not in allowed OptionIDs
		},
	}

	res := ComposeEffectiveDefinitionMaterials("BASE-750", roles, defaults, nil)

	wantChoices := map[string]string{
		"FRONT": "mat-oak", // first allowed option
	}
	wantModes := map[string]DesignMaterialChoiceMode{
		"FRONT": DesignMaterialChoiceModeOverride, // marked override because it diverged from Design default
	}

	if !reflect.DeepEqual(res.MaterialChoices, wantChoices) {
		t.Errorf("MaterialChoices = %v, want %v", res.MaterialChoices, wantChoices)
	}
	if !reflect.DeepEqual(res.MaterialChoiceModes, wantModes) {
		t.Errorf("MaterialChoiceModes = %v, want %v", res.MaterialChoiceModes, wantModes)
	}
}

func TestComposeEffectiveDefinitionMaterials_ExplicitOverrideWins(t *testing.T) {
	roles := []DefinitionRoleOptionSpec{
		{Role: "BODY", OptionIDs: []string{"mat-white", "mat-oak"}},
		{Role: "FRONT", OptionIDs: []string{"mat-oak", "mat-black"}},
	}
	defaults := DesignAuthoringDefaults{
		MaterialChoices: map[string]string{
			"BODY":  "mat-white",
			"FRONT": "mat-oak",
		},
	}
	overrides := map[string]string{
		"FRONT": "mat-black",
	}

	res := ComposeEffectiveDefinitionMaterials("BASE-750", roles, defaults, overrides)

	wantChoices := map[string]string{
		"BODY":  "mat-white",
		"FRONT": "mat-black",
	}
	wantModes := map[string]DesignMaterialChoiceMode{
		"BODY":  DesignMaterialChoiceModeDesign,
		"FRONT": DesignMaterialChoiceModeOverride,
	}

	if !reflect.DeepEqual(res.MaterialChoices, wantChoices) {
		t.Errorf("MaterialChoices = %v, want %v", res.MaterialChoices, wantChoices)
	}
	if !reflect.DeepEqual(res.MaterialChoiceModes, wantModes) {
		t.Errorf("MaterialChoiceModes = %v, want %v", res.MaterialChoiceModes, wantModes)
	}
}

func TestComposeEffectiveDefinitionMaterials_RoleWithoutDefault(t *testing.T) {
	roles := []DefinitionRoleOptionSpec{
		{Role: "BACK", OptionIDs: []string{"mat-hdf-white"}},
	}
	defaults := DesignAuthoringDefaults{
		MaterialChoices: map[string]string{
			"BODY": "mat-white", // no BACK default
		},
	}

	res := ComposeEffectiveDefinitionMaterials("BASE-750", roles, defaults, nil)

	wantChoices := map[string]string{
		"BACK": "mat-hdf-white",
	}
	wantModes := map[string]DesignMaterialChoiceMode{
		"BACK": DesignMaterialChoiceModeOverride,
	}

	if !reflect.DeepEqual(res.MaterialChoices, wantChoices) {
		t.Errorf("MaterialChoices = %v, want %v", res.MaterialChoices, wantChoices)
	}
	if !reflect.DeepEqual(res.MaterialChoiceModes, wantModes) {
		t.Errorf("MaterialChoiceModes = %v, want %v", res.MaterialChoiceModes, wantModes)
	}
}

func TestComposeEffectiveDefinitionMaterials_UnrestrictedOptionIDsInherits(t *testing.T) {
	roles := []DefinitionRoleOptionSpec{
		{Role: "SPECIAL", OptionIDs: []string{}}, // empty OptionIDs means unrestricted active materials
	}
	defaults := DesignAuthoringDefaults{
		MaterialChoices: map[string]string{
			"SPECIAL": "mat-any",
		},
	}

	res := ComposeEffectiveDefinitionMaterials("CUSTOM-1", roles, defaults, nil)

	wantChoices := map[string]string{
		"SPECIAL": "mat-any",
	}
	wantModes := map[string]DesignMaterialChoiceMode{
		"SPECIAL": DesignMaterialChoiceModeDesign,
	}

	if !reflect.DeepEqual(res.MaterialChoices, wantChoices) {
		t.Errorf("MaterialChoices = %v, want %v", res.MaterialChoices, wantChoices)
	}
	if !reflect.DeepEqual(res.MaterialChoiceModes, wantModes) {
		t.Errorf("MaterialChoiceModes = %v, want %v", res.MaterialChoiceModes, wantModes)
	}
}
