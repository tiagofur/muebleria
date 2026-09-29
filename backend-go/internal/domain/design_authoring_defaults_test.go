package domain

import (
	"errors"
	"testing"
)

// #784 — pure contract of the inheritance domain: mode enum, defaults
// validation, wire normalization and the needsRollout composition rule.

func TestDesignMaterialChoiceModeEnum(t *testing.T) {
	if !IsValidDesignMaterialChoiceMode(DesignMaterialChoiceModeDesign) ||
		!IsValidDesignMaterialChoiceMode(DesignMaterialChoiceModeOverride) ||
		!IsValidDesignMaterialChoiceMode(DesignMaterialChoiceModeDefinition) {
		t.Fatal("design, override and definition are the known modes")
	}
	for _, unknown := range []DesignMaterialChoiceMode{"", "inherited", "default", "DESIGN"} {
		if IsValidDesignMaterialChoiceMode(unknown) {
			t.Fatalf("mode %q must be unknown (fail closed)", unknown)
		}
	}
}

func TestValidateDesignAuthoringDefaults(t *testing.T) {
	if err := ValidateDesignAuthoringDefaults(DesignAuthoringDefaults{}); err != nil {
		t.Fatalf("empty defaults are valid: %v", err)
	}
	if err := ValidateDesignAuthoringDefaults(DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-a"}}); err != nil {
		t.Fatalf("simple defaults are valid: %v", err)
	}
	if err := ValidateDesignAuthoringDefaults(DesignAuthoringDefaults{MaterialChoices: map[string]string{"": "mat-a"}}); err == nil {
		t.Fatal("empty role must reject")
	}
	if err := ValidateDesignAuthoringDefaults(DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "  "}}); err == nil {
		t.Fatal("empty material id must reject")
	}
}

func TestValidateDesignMaterialChoiceModesParity(t *testing.T) {
	choices := map[string]string{"INTERIOR": "a", "FRENTES": "b"}
	modes := map[string]DesignMaterialChoiceMode{
		"INTERIOR": DesignMaterialChoiceModeDesign,
		"FRENTES":  DesignMaterialChoiceModeOverride,
	}
	if err := ValidateDesignMaterialChoiceModes(choices, modes); err != nil {
		t.Fatalf("full parity is valid: %v", err)
	}
	if err := ValidateDesignMaterialChoiceModes(choices, map[string]DesignMaterialChoiceMode{"INTERIOR": "unknown"}); !errors.Is(err, ErrInvalidMaterialChoiceModes) {
		t.Fatalf("unknown mode err = %v", err)
	}
	if err := ValidateDesignMaterialChoiceModes(choices, map[string]DesignMaterialChoiceMode{"INTERIOR": DesignMaterialChoiceModeDesign}); !errors.Is(err, ErrInvalidMaterialChoiceModes) {
		t.Fatalf("missing mode for one choice err = %v", err)
	}
	if err := ValidateDesignMaterialChoiceModes(map[string]string{"INTERIOR": "a"}, map[string]DesignMaterialChoiceMode{"FRENTES": DesignMaterialChoiceModeDesign}); !errors.Is(err, ErrInvalidMaterialChoiceModes) {
		t.Fatalf("mode without choice err = %v", err)
	}
}

func TestValidatePresentMaterialChoiceModes(t *testing.T) {
	choices := map[string]string{"INTERIOR": "a", "FRENTES": "b"}
	full := map[string]DesignMaterialChoiceMode{
		"INTERIOR": DesignMaterialChoiceModeDesign,
		"FRENTES":  DesignMaterialChoiceModeOverride,
	}
	if err := ValidatePresentMaterialChoiceModes(choices, full); err != nil {
		t.Fatalf("full statement is valid: %v", err)
	}
	// A present-but-empty statement with choices is a partial statement.
	if err := ValidatePresentMaterialChoiceModes(choices, map[string]DesignMaterialChoiceMode{}); !errors.Is(err, ErrInvalidMaterialChoiceModes) {
		t.Fatalf("empty present statement err = %v, want rejection", err)
	}
	if err := ValidatePresentMaterialChoiceModes(choices, map[string]DesignMaterialChoiceMode{"INTERIOR": DesignMaterialChoiceModeDesign}); !errors.Is(err, ErrInvalidMaterialChoiceModes) {
		t.Fatalf("partial statement err = %v, want rejection", err)
	}
	if err := ValidatePresentMaterialChoiceModes(map[string]string{}, map[string]DesignMaterialChoiceMode{}); err != nil {
		t.Fatalf("empty/empty is valid: %v", err)
	}
}

func TestMergeLegacyMaterialChoiceModes(t *testing.T) {
	persistedChoices := map[string]string{"INTERIOR": "blanco", "FRENTES": "negro"}
	persistedModes := map[string]DesignMaterialChoiceMode{
		"INTERIOR": DesignMaterialChoiceModeDesign,
		"FRENTES":  DesignMaterialChoiceModeOverride,
	}

	// Unrelated legacy PUT (same values): lineage survives untouched.
	merged := MergeLegacyMaterialChoiceModes(persistedChoices, persistedChoices, persistedModes)
	if merged["INTERIOR"] != DesignMaterialChoiceModeDesign || merged["FRENTES"] != DesignMaterialChoiceModeOverride {
		t.Fatalf("unchanged legacy PUT must preserve lineage: %+v", merged)
	}

	// Legacy PUT changing a value — even to a value equal to some default —
	// is an explicit exception: override. Equality never grants design.
	changed := map[string]string{"INTERIOR": "roble", "FRENTES": "negro"}
	merged = MergeLegacyMaterialChoiceModes(changed, persistedChoices, persistedModes)
	if merged["INTERIOR"] != DesignMaterialChoiceModeOverride {
		t.Fatalf("changed value must become override, got %q", merged["INTERIOR"])
	}
	if merged["FRENTES"] != DesignMaterialChoiceModeOverride {
		t.Fatalf("unchanged FRENTES must stay override, got %q", merged["FRENTES"])
	}

	// New role → override; removed role → its mode drops (parity).
	added := map[string]string{"INTERIOR": "blanco", "FONDO": "blanco6"}
	merged = MergeLegacyMaterialChoiceModes(added, persistedChoices, persistedModes)
	if merged["INTERIOR"] != DesignMaterialChoiceModeDesign {
		t.Fatalf("unchanged INTERIOR must stay design, got %q", merged["INTERIOR"])
	}
	if merged["FONDO"] != DesignMaterialChoiceModeOverride {
		t.Fatalf("new role must be override, got %q", merged["FONDO"])
	}
	if _, ok := merged["FRENTES"]; ok {
		t.Fatal("removed role must drop its mode")
	}

	// Brand-new item (no persisted state): every role → override.
	fresh := MergeLegacyMaterialChoiceModes(map[string]string{"INTERIOR": "a"}, nil, nil)
	if fresh["INTERIOR"] != DesignMaterialChoiceModeOverride {
		t.Fatalf("new legacy item must be override, got %q", fresh["INTERIOR"])
	}
}

func TestEvaluateDesignRoleInheritance(t *testing.T) {
	cases := []struct {
		name          string
		mode          DesignMaterialChoiceMode
		applied       string
		designDefault string
		needsRollout  bool
	}{
		{"design current", DesignMaterialChoiceModeDesign, "mat-a", "mat-a", false},
		{"design stale", DesignMaterialChoiceModeDesign, "mat-blanco", "mat-roble", true},
		{"design without default", DesignMaterialChoiceModeDesign, "mat-a", "", false},
		{"override equal to default", DesignMaterialChoiceModeOverride, "mat-a", "mat-a", false},
		{"override different", DesignMaterialChoiceModeOverride, "mat-b", "mat-a", false},
	}
	for _, tc := range cases {
		out := EvaluateDesignRoleInheritance("INTERIOR", tc.mode, tc.applied, tc.designDefault)
		if out.NeedsRollout != tc.needsRollout {
			t.Fatalf("%s: needsRollout = %v, want %v (%+v)", tc.name, out.NeedsRollout, tc.needsRollout, out)
		}
		if out.Role != "INTERIOR" || out.AppliedChoice != tc.applied || out.DesignDefault != tc.designDefault {
			t.Fatalf("%s: projection fields wrong: %+v", tc.name, out)
		}
	}
}

func TestSummarizeDesignInheritance(t *testing.T) {
	entries := []DesignRoleInheritance{
		{Role: "INTERIOR", Mode: DesignMaterialChoiceModeDesign, NeedsRollout: true},
		{Role: "INTERIOR", Mode: DesignMaterialChoiceModeDesign},
		{Role: "INTERIOR", Mode: DesignMaterialChoiceModeOverride},
		{Role: "FRENTES", Mode: DesignMaterialChoiceModeOverride},
	}
	summary := SummarizeDesignInheritance(entries)
	if len(summary) != 2 {
		t.Fatalf("roles = %d, want 2", len(summary))
	}
	// Sorted deterministically.
	if summary[0].Role != "FRENTES" || summary[1].Role != "INTERIOR" {
		t.Fatalf("role order = %s,%s", summary[0].Role, summary[1].Role)
	}
	interior := summary[1]
	if interior.Items != 3 || interior.DesignBacked != 2 || interior.NeedsRollout != 1 || interior.DesignCurrent != 1 || interior.Overridden != 1 {
		t.Fatalf("INTERIOR summary = %+v", interior)
	}
	frentes := summary[0]
	if frentes.Items != 1 || frentes.Overridden != 1 || frentes.DesignBacked != 0 {
		t.Fatalf("FRENTES summary = %+v", frentes)
	}
}
