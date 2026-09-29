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

func TestComposeEffectiveDefinitionMaterials_IncompatibleDefaultFallsBackToDefinition(t *testing.T) {
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
		"FRONT": DesignMaterialChoiceModeDefinition, // curated fallback lineage, not a user exception
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
		"BACK": DesignMaterialChoiceModeDefinition,
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

func TestComposeEffectiveDefinitionMaterials_UnrestrictedRoleWithoutDefaultCarriesNoStatement(t *testing.T) {
	roles := []DefinitionRoleOptionSpec{
		{Role: "SPECIAL", OptionIDs: []string{}}, // unrestricted, no Design default
		{Role: "BODY", OptionIDs: []string{"  "}}, // curated list holding only a blank id
	}
	res := ComposeEffectiveDefinitionMaterials("BASE-750", roles, DesignAuthoringDefaults{}, nil)

	// Parity holds through absence: neither map carries a statement for a
	// role with no curated candidates and no Design default.
	if len(res.MaterialChoices) != 0 || len(res.MaterialChoiceModes) != 0 {
		t.Errorf("expected no statements, got choices=%v modes=%v", res.MaterialChoices, res.MaterialChoiceModes)
	}
}

func TestComposeEffectiveDefinitionMaterials_DefinitionFallbackDoesNotInflateOverrideCounts(t *testing.T) {
	entries := []DesignRoleInheritance{
		{Role: "FRENTES", Mode: DesignMaterialChoiceModeDefinition, AppliedChoice: "mat-oak", DesignDefault: "mat-glass"},
		{Role: "FRENTES", Mode: DesignMaterialChoiceModeDesign, AppliedChoice: "mat-oak", DesignDefault: "mat-oak"},
		{Role: "FRENTES", Mode: DesignMaterialChoiceModeOverride, AppliedChoice: "mat-walnut", DesignDefault: "mat-oak"},
	}
	counts := SummarizeDesignInheritance(entries)
	if len(counts) != 1 {
		t.Fatalf("expected one role count, got %d", len(counts))
	}
	c := counts[0]
	if c.Items != 3 || c.DefinitionBacked != 1 || c.DesignBacked != 1 || c.Overridden != 1 {
		t.Errorf("items=%d definition=%d design=%d overridden=%d; want 3/1/1/1", c.Items, c.DefinitionBacked, c.DesignBacked, c.Overridden)
	}
	if c.NeedsRollout != 0 || c.DesignCurrent != 1 {
		t.Errorf("needsRollout=%d designCurrent=%d; want 0/1", c.NeedsRollout, c.DesignCurrent)
	}
}
