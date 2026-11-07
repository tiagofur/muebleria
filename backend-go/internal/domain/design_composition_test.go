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

// #1555: kit accessory groups are ExplicitChoiceOnly — an override or a
// COMPATIBLE Design default passes, an incompatible default and the curated
// first-option fallback never seed an accessory the user did not choose.
func TestComposeEffectiveDefinitionMaterials_ExplicitChoiceOnlyNeverSeeds_1555(t *testing.T) {
	accessory := DefinitionRoleOptionSpec{
		Role: "LATERAL_E", OptionIDs: []string{"hw-gal-e", "hw-cap-e"}, ExplicitChoiceOnly: true,
	}

	t.Run("override passes with mode override", func(t *testing.T) {
		res := ComposeEffectiveDefinitionMaterials("MBOX", []DefinitionRoleOptionSpec{accessory},
			DesignAuthoringDefaults{}, map[string]string{"LATERAL_E": "hw-cap-e"})
		if res.MaterialChoices["LATERAL_E"] != "hw-cap-e" || res.MaterialChoiceModes["LATERAL_E"] != DesignMaterialChoiceModeOverride {
			t.Fatalf("override must pass: %v / %v", res.MaterialChoices, res.MaterialChoiceModes)
		}
	})

	t.Run("compatible design default passes", func(t *testing.T) {
		res := ComposeEffectiveDefinitionMaterials("MBOX", []DefinitionRoleOptionSpec{accessory},
			DesignAuthoringDefaults{MaterialChoices: map[string]string{"LATERAL_E": "hw-gal-e"}}, nil)
		if res.MaterialChoices["LATERAL_E"] != "hw-gal-e" || res.MaterialChoiceModes["LATERAL_E"] != DesignMaterialChoiceModeDesign {
			t.Fatalf("compatible default must pass: %v / %v", res.MaterialChoices, res.MaterialChoiceModes)
		}
	})

	t.Run("incompatible design default carries no statement (no fallback seed)", func(t *testing.T) {
		res := ComposeEffectiveDefinitionMaterials("MBOX", []DefinitionRoleOptionSpec{accessory},
			DesignAuthoringDefaults{MaterialChoices: map[string]string{"LATERAL_E": "hw-ajeno"}}, nil)
		if _, ok := res.MaterialChoices["LATERAL_E"]; ok {
			t.Fatalf("incompatible default must NOT fall back to the first accessory: %v", res.MaterialChoices)
		}
		if _, ok := res.MaterialChoiceModes["LATERAL_E"]; ok {
			t.Fatalf("parity: no mode either: %v", res.MaterialChoiceModes)
		}
	})

	t.Run("no override and no default carries no statement", func(t *testing.T) {
		res := ComposeEffectiveDefinitionMaterials("MBOX", []DefinitionRoleOptionSpec{accessory},
			DesignAuthoringDefaults{}, nil)
		if len(res.MaterialChoices) != 0 || len(res.MaterialChoiceModes) != 0 {
			t.Fatalf("an accessory nobody chose is never seeded: %v / %v", res.MaterialChoices, res.MaterialChoiceModes)
		}
	})

	t.Run("regular roles keep the curated fallback (regression guard)", func(t *testing.T) {
		regular := DefinitionRoleOptionSpec{Role: "BISAGRA", OptionIDs: []string{"hw-blum", "hw-eco"}}
		res := ComposeEffectiveDefinitionMaterials("MBOX", []DefinitionRoleOptionSpec{regular, accessory},
			DesignAuthoringDefaults{}, nil)
		if res.MaterialChoices["BISAGRA"] != "hw-blum" || res.MaterialChoiceModes["BISAGRA"] != DesignMaterialChoiceModeDefinition {
			t.Fatalf("regular role fallback must stay: %v", res.MaterialChoices)
		}
		if _, ok := res.MaterialChoices["LATERAL_E"]; ok {
			t.Fatalf("accessory must not be seeded next to it: %v", res.MaterialChoices)
		}
	})
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

// #1153: a kind=hardware option role composes exactly like a board role —
// the connected insert's override must survive the composition (and a
// missing override has no design default to fall back to: the caller fails
// closed upstream, never here).
func TestComposeEffectiveDefinitionMaterialsAcceptsHardwareRoleOverride(t *testing.T) {
	roles := []DefinitionRoleOptionSpec{
		{Role: "FRENTE", Label: "Frente", OptionIDs: []string{"mat-1"}},
		{Role: "BISAGRA", Label: "Bisagras", OptionIDs: []string{"hw-blum", "hw-eco"}},
	}
	overrides := map[string]string{"BISAGRA": "hw-eco"}

	res := ComposeEffectiveDefinitionMaterials("BASE-600", roles, DesignAuthoringDefaults{}, overrides)

	if res.MaterialChoices["BISAGRA"] != "hw-eco" {
		t.Fatalf("hardware override must survive the composition, got %+v", res.MaterialChoices)
	}
	if res.MaterialChoiceModes["BISAGRA"] != DesignMaterialChoiceModeOverride {
		t.Fatalf("an explicit pre-insert choice is an override, got %+v", res.MaterialChoiceModes)
	}
	// Untouched roles keep the existing lineage contract: the curated
	// definition fallback (first option) with mode definition.
	if res.MaterialChoices["FRENTE"] != "mat-1" || res.MaterialChoiceModes["FRENTE"] != DesignMaterialChoiceModeDefinition {
		t.Fatalf("untouched role keeps the definition fallback, got %+v", res.MaterialChoices)
	}
}
