package domain

// #1532 — the project grip snapshot: the complete frozen copy (A7), the
// inheritance the server resolves, and the fail-closed shape validation.

import (
	"strings"
	"testing"
	"time"
)

func gripTestProfile(id, code string, topDiscount, betweenDiscount *int) *OpeningProfile {
	height, depth := 56.5, 27.2
	return &OpeningProfile{
		ID: id, Code: code, Name: "Gola " + code,
		Material:               GolaMaterialAluminum,
		Positions:              []string{GolaPositionTop, GolaPositionBetween},
		ProfileHeightMm:        &height,
		ProfileDepthMm:         &depth,
		FrontDiscountTopMm:     topDiscount,
		FrontDiscountBetweenMm: betweenDiscount,
		CompatiblePlacements:   []string{GolaPositionTop, GolaPositionBetween},
		Active:                 true,
		Version:                3,
	}
}

func TestFreezeGripSnapshotFreezesTheCompleteCopy(t *testing.T) {
	forty, thirtySix := 40, 36
	profile := gripTestProfile("p-1", "GOLA-L-8006", &forty, &thirtySix)
	profile.Positions = []string{GolaPositionTop, GolaPositionBetween}
	style := GripStyle{
		ID: "style-1", Name: "Gola taller", Offered: true, IsDefault: true,
		ByFurnitureType: map[string]GripStyleRecipe{
			"inferior": {Mode: GripModeGola, TopProfileID: "p-1", BetweenProfileID: "p-1"},
			"superior": {Mode: GripModeHandle},
			"alto":     {Mode: GripModeBottomOverhang, OverhangMm: floatPtr(20)},
		},
	}
	frozenAt := time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC)
	snapshot, err := FreezeGripSnapshot(style, func(id string) (*OpeningProfile, error) {
		if id == "p-1" {
			return profile, nil
		}
		return nil, nil
	}, frozenAt)
	if err != nil {
		t.Fatalf("freeze: %v", err)
	}
	if snapshot.StyleID != "style-1" || snapshot.StyleName != "Gola taller" || !snapshot.FrozenAt.Equal(frozenAt) {
		t.Fatalf("snapshot identity drifted: %+v", snapshot)
	}
	inferior := snapshot.Recipes["inferior"]
	if inferior.Mode != GripModeGola || inferior.TopProfile == nil || inferior.BetweenProfile == nil {
		t.Fatalf("gola recipe drifted: %+v", inferior)
	}
	if got := *inferior.TopProfile.FrontDiscountTopMm; got != 40 {
		t.Fatalf("top discount = %d, want 40", got)
	}
	if got := *inferior.BetweenProfile.FrontDiscountBetweenMm; got != 36 {
		t.Fatalf("between discount = %d, want 36", got)
	}
	if inferior.TopProfile.BOMVersion != 3 {
		t.Fatalf("frozen BOM version = %d, want 3", inferior.TopProfile.BOMVersion)
	}
	if snapshot.Recipes["alto"].OverhangMm == nil || *snapshot.Recipes["alto"].OverhangMm != 20 {
		t.Fatalf("overhang recipe drifted: %+v", snapshot.Recipes["alto"])
	}
	if snapshot.Recipes["superior"].Mode != GripModeHandle {
		t.Fatalf("handle recipe drifted: %+v", snapshot.Recipes["superior"])
	}
}

func TestFreezeGripSnapshotRefusesAnUnusableProfile(t *testing.T) {
	broken := gripTestProfile("p-1", "GOLA-L-8006", nil, nil) // no top discount
	style := GripStyle{
		Name: "Gola rota", Offered: true,
		ByFurnitureType: map[string]GripStyleRecipe{
			"inferior": {Mode: GripModeGola, TopProfileID: "p-1"},
			"superior": {Mode: GripModeHandle},
			"alto":     {Mode: GripModeHandle},
		},
	}
	NormalizeGripStyle(&style)
	_, err := FreezeGripSnapshot(style, func(id string) (*OpeningProfile, error) {
		return broken, nil
	}, time.Now())
	if err == nil {
		t.Fatal("freezing an unusable profile must fail closed")
	}
	if !strings.Contains(err.Error(), "no se puede usar") {
		t.Fatalf("the rejection must name the use rule: %v", err)
	}
}

func TestEffectiveGripSnapshotPrefersTheOverride(t *testing.T) {
	override := &GripSnapshot{StyleName: "excepción"}
	project := &GripSnapshot{StyleName: "proyecto"}
	if got := EffectiveGripSnapshot(override, project); got != override {
		t.Fatal("the override must win")
	}
	if got := EffectiveGripSnapshot(nil, project); got != project {
		t.Fatal("without an override the project governs")
	}
	if got := EffectiveGripSnapshot(nil, nil); got != nil {
		t.Fatal("no grip anywhere resolves nil")
	}
}

func TestGripRecipeForTypeUncoveredFailsClosed(t *testing.T) {
	snapshot := &GripSnapshot{Recipes: map[string]GripSnapshotRecipe{
		"inferior": {Mode: GripModeHandle},
	}}
	if _, err := snapshot.GripRecipeFor("superior"); err == nil {
		t.Fatal("an uncovered furniture type must fail closed, never fall back to another type")
	}
	if recipe, err := snapshot.GripRecipeFor("inferior"); err != nil || recipe == nil {
		t.Fatalf("the covered type resolves: %v", err)
	}
}

func TestValidateGripSnapshotShape(t *testing.T) {
	cases := []struct {
		name    string
		recipes map[string]GripSnapshotRecipe
		wantErr string
	}{
		{"gola sin perfil superior", map[string]GripSnapshotRecipe{"inferior": {Mode: GripModeGola}}, "perfil de arriba"},
		{"gola con descuento ausente", map[string]GripSnapshotRecipe{
			"inferior": {Mode: GripModeGola, TopProfile: &FrozenGripProfile{ProfileID: "p", Code: "C"}},
		}, "descuento"},
		{"rebase sin milímetros", map[string]GripSnapshotRecipe{"alto": {Mode: GripModeBottomOverhang}}, "mayores a 0"},
		{"rebase con perfil", map[string]GripSnapshotRecipe{
			"alto": {Mode: GripModeBottomOverhang, OverhangMm: floatPtr(20), TopProfile: &FrozenGripProfile{ProfileID: "p", Code: "C", FrontDiscountTopMm: intPtr(40)}},
		}, "no lleva perfiles"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateGripSnapshotShape(&GripSnapshot{Recipes: tc.recipes})
			if err == nil {
				t.Fatalf("expected the failure %q", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("got %q, want it to name %q", err.Error(), tc.wantErr)
			}
		})
	}
	// The migrated legacy bottom gola carries its marker; the shape accepts
	// it and the resolve blocks with the honest code (never a reinterpretation).
	snapshot := &GripSnapshot{Recipes: map[string]GripSnapshotRecipe{
		"inferior": {Mode: GripModeGola, LegacyBottomGola: true,
			TopProfile: &FrozenGripProfile{ProfileID: "p", Code: "C", FrontDiscountTopMm: intPtr(40)}},
	}}
	if err := ValidateGripSnapshotShape(snapshot); err != nil {
		t.Fatalf("the legacy bottom gola shape is valid: %v", err)
	}
}

func floatPtr(v float64) *float64 { return &v }
