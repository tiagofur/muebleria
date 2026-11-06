package domain

import "testing"

func handleOnlyStyle(name string, isDefault bool) GripStyle {
	return GripStyle{Name: name, Offered: true, IsDefault: isDefault, ByFurnitureType: map[string]GripStyleRecipe{
		"inferior": {Mode: GripModeHandle}, "superior": {Mode: GripModeHandle}, "alto": {Mode: GripModeHandle},
	}}
}

// #1531 — handle-only styles (the seed) are no opening decision: the
// projection is nil and the library ladder governs, as before the blobs
// were retired; a gola style curates its profiles and the L standard.
func TestOpeningCapabilitiesFromGripStyles(t *testing.T) {
	if caps := OpeningCapabilitiesFromGripStyles([]GripStyle{handleOnlyStyle("Jaladera", true)}, nil); caps != nil {
		t.Fatalf("handle-only styles must not restrict new authoring: %+v", caps)
	}
	gola := handleOnlyStyle("Gola", true)
	gola.ByFurnitureType["inferior"] = GripStyleRecipe{Mode: GripModeGola, TopProfileID: "p-l", BetweenProfileID: "p-c"}
	profiles := []OpeningProfile{{ID: "p-l", CrossSectionShape: "L"}, {ID: "p-c", CrossSectionShape: "C"}}
	caps := OpeningCapabilitiesFromGripStyles([]GripStyle{handleOnlyStyle("Jaladera", false), gola}, profiles)
	if caps == nil || !caps.Grips[GripModeGola].Enabled || !caps.Grips[GripModeHandle].Enabled {
		t.Fatalf("gola and handle offered: %+v", caps)
	}
	if got := caps.Grips[GripModeGola].StandardProfiles; got["L"] != "p-l" || got["C"] != "p-c" {
		t.Fatalf("standards from the default style: %+v", got)
	}
	if !caps.Grips[GripModeGola].Default || caps.Grips[GripModeHandle].Default {
		t.Fatalf("the default style's base-cabinet mode is the default: %+v", caps.Grips)
	}
	if placements := caps.ByFurnitureType["inferior"].Grips[GripModeGola].Placements; len(placements) != 2 {
		t.Fatalf("top + between placements for inferior: %+v", placements)
	}

	// The overhang rule: default style first, then any offered, then 20.
	if rule := OpeningOverhangRuleFromGripStyles([]GripStyle{handleOnlyStyle("Jaladera", true)}); rule.OverhangMm != DefaultGripOverhangMm {
		t.Fatalf("20 by default: %+v", rule)
	}
	ten := 10.0
	rebase := handleOnlyStyle("Rebase", false)
	rebase.ByFurnitureType["superior"] = GripStyleRecipe{Mode: GripModeBottomOverhang, OverhangMm: &ten}
	if rule := OpeningOverhangRuleFromGripStyles([]GripStyle{handleOnlyStyle("Jaladera", true), rebase}); rule.OverhangMm != 10 {
		t.Fatalf("an offered style's overhang: %+v", rule)
	}
}
