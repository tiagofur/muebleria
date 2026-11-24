package engine

// #1685 — a between profile over a furniture WITHOUT stacked fronts is
// truthful absence: the boundary does not exist here, so the between members
// mount nothing and the between modifiers cut nothing — the resolve keeps the
// boundaries that do exist (the top run). The stacked twin keeps everything
// the engine already draws. This is the exact authoring the vivo hit: a
// type-level style (L top + C between, C declaring a lateral notch) applied
// to a one-door cabinet.

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// gripBetweenAbsenceRecipe freezes the workshop's real shape: L 8006 top
// (profile + supports BOM) and C 8007 between (profile BOM + lateral notch).
func gripBetweenAbsenceRecipe() *domain.GripSnapshotRecipe {
	return &domain.GripSnapshotRecipe{
		Mode: domain.GripModeGola,
		TopProfile: &domain.FrozenGripProfile{
			ProfileID: "profile.gola-l.8006", Code: "GOLA-L-8006", Name: "Gola L Cymisa 8006",
			ProfileHeightMm: floatPtr60(56.5), ProfileDepthMm: floatPtr60(27.2),
			FrontDiscountTopMm: intPtr60(30),
			BOMMembers: map[string]domain.OpeningBOMMember{
				"profile":  {HardwareID: "80000000-0000-4000-8000-000000000801"},
				"supports": {HardwareID: "80000000-0000-4000-8000-000000000802", SpacingMm: intPtr60(400)},
			},
		},
		BetweenProfile: &domain.FrozenGripProfile{
			ProfileID: "profile.gola-c-8007", Code: "GOLA-C-8007", Name: "Gola C Cymisa 8007",
			ProfileHeightMm: floatPtr60(73), ProfileDepthMm: floatPtr60(27.2),
			FrontDiscountBetweenMm: intPtr60(38),
			CompatiblePlacements:   []string{"between"},
			BOMMembers: map[string]domain.OpeningBOMMember{
				"profile": {HardwareID: "80000000-0000-4000-8000-000000000801"},
			},
			BodyModifiers: []domain.OpeningBodyModifier{{
				Role: "lateral", Effect: "notch", NotchAt: "front_boundary",
				NotchDepthMm: floatPtr60(27.2), NotchHeightMm: floatPtr60(73),
			}},
		},
	}
}

func floatPtr60(v float64) *float64 { return &v }
func intPtr60(v int) *int           { return &v }

// The acceptance: a one-door cabinet under a top+between gola style resolves
// — the top run mounts, nothing between mounts or cuts — instead of the
// pre-#1685 whole-resolve failure («la muesca entre frentes … no tiene
// frentes apilados»).
func TestProjectGripBetweenProfileOnSingleFrontIsTruthfulAbsence(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	catalog.Hardware = append(catalog.Hardware,
		domain.Hardware{ID: "80000000-0000-4000-8000-000000000801", Code: "8006", Name: "Perfil GOLA L", Unit: domain.UnitPiece, Active: true},
		domain.Hardware{ID: "80000000-0000-4000-8000-000000000802", Code: "SU116", Name: "Soporte GOLA", Unit: domain.UnitPiece, Active: true},
	)
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}
	recipe := gripBetweenAbsenceRecipe()

	fronts, frontsErr := ProjectGripFronts(recipe)
	if frontsErr != nil || len(fronts) == 0 {
		t.Fatalf("fronts: %v %+v", frontsErr, fronts)
	}
	members := ProjectGripMembers(recipe.TopProfile)
	betweenStrips := ProjectGripBetweenStrips(recipe.BetweenProfile)
	betweenHWID, betweenHWHeight, betweenHWDepth := ProjectGripBetweenHardware(recipe.BetweenProfile)
	if members == nil {
		members = &OpeningMembers{}
	}
	members.BetweenComponentMembers = betweenStrips
	members.BetweenProfileHardwareID, members.BetweenProfileHeightMm, members.BetweenProfileDepthMm =
		betweenHWID, betweenHWHeight, betweenHWDepth
	modifiers, modErr := ResolveProjectGripModifiers(recipe)
	if modErr != nil {
		t.Fatalf("modifiers: %s", modErr.Message)
	}

	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts: fronts, openingMembers: members, openingBodyModifiers: modifiers,
	})
	if err != nil {
		t.Fatalf("single front + between profile must resolve (truthful absence), got %v", err)
	}
	topRuns, betweenRuns, betweenCuts := 0, 0, 0
	for _, hw := range layout.Hardware {
		if strings.HasPrefix(hw.PlacementID, "opening-profile-") && !strings.Contains(hw.PlacementID, "between") {
			topRuns++
		}
		if strings.HasPrefix(hw.PlacementID, "opening-profile-between") {
			betweenRuns++
		}
	}
	for _, component := range layout.Components {
		for _, notch := range component.Notches {
			if notch.Boundary != "" && strings.Contains(notch.Boundary, "between") {
				betweenCuts++
			}
		}
	}
	if topRuns == 0 {
		t.Fatalf("the top run must still mount, hardware: %+v", layout.Hardware)
	}
	if betweenRuns != 0 || betweenCuts != 0 {
		t.Fatalf("no between edges → nothing between mounts or cuts: runs=%d cuts=%d", betweenRuns, betweenCuts)
	}
}

// The stacked twin keeps the engine's full between content: over a 3-drawer
// column the same recipe still mounts the between run.
func TestProjectGripBetweenProfileOnStackedFrontsStillMounts(t *testing.T) {
	module, catalog := drawerColumnCatalog()
	catalog.Hardware = append(catalog.Hardware,
		domain.Hardware{ID: "80000000-0000-4000-8000-000000000801", Code: "8006", Name: "Perfil GOLA L", Unit: domain.UnitPiece, Active: true},
		domain.Hardware{ID: "80000000-0000-4000-8000-000000000802", Code: "SU116", Name: "Soporte GOLA", Unit: domain.UnitPiece, Active: true},
	)
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}
	recipe := gripBetweenAbsenceRecipe()

	fronts, _ := ProjectGripFronts(recipe)
	members := ProjectGripMembers(recipe.TopProfile)
	betweenStrips := ProjectGripBetweenStrips(recipe.BetweenProfile)
	betweenHWID, betweenHWHeight, betweenHWDepth := ProjectGripBetweenHardware(recipe.BetweenProfile)
	if members == nil {
		members = &OpeningMembers{}
	}
	members.BetweenComponentMembers = betweenStrips
	members.BetweenProfileHardwareID, members.BetweenProfileHeightMm, members.BetweenProfileDepthMm =
		betweenHWID, betweenHWHeight, betweenHWDepth
	modifiers, modErr := ResolveProjectGripModifiers(recipe)
	if modErr != nil {
		t.Fatalf("modifiers: %s", modErr.Message)
	}

	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts: fronts, openingMembers: members, openingBodyModifiers: modifiers,
	})
	if err != nil {
		t.Fatalf("stacked fronts + between profile must resolve, got %v", err)
	}
	betweenRuns := 0
	for _, hw := range layout.Hardware {
		if strings.HasPrefix(hw.PlacementID, "opening-profile-between") {
			betweenRuns++
		}
	}
	// #1706: 3 rows → 1 gripped edge (below the middle front) → 1 between
	// run, and the top run still mounts (the top front opens with the L).
	if betweenRuns != 1 {
		t.Fatalf("3 rows must mount 1 between run, got %d (hardware %+v)", betweenRuns, layout.Hardware)
	}
}
