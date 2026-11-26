package engine

// #1726 — a dual-position profile (GOLA-ITALIANO: positions {top,between},
// one shared body-modifier set per the #1530 row shape) serving BOTH recipe
// boundaries must not fail the whole resolve because its top-scoped
// depth_reduction reaches the between copy. §14.6: the gola-L body effect
// exists only at the top; between fronts the strip is board + notch + bevel.
// The exact vivo failure: OPENING_BODY_MODIFIER_INVALID — «la reducción de
// profundidad no aplica en la frontera between».

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// sharedSetItalianRecipe freezes the workshop's real row: the SAME italian
// profile at top and between, modifiers notch top_front + depth_reduction +
// door bevel top_front, strip BOM member.
func sharedSetItalianRecipe() *domain.GripSnapshotRecipe {
	frozen := &domain.FrozenGripProfile{
		ProfileID: "profile.gola-italiano.tira", Code: "GOLA-ITALIANO", Name: "Gola italiano (tira de melamina)",
		ProfileHeightMm:        floatPtr60(70),
		ProfileDepthMm:         floatPtr60(15),
		FrontDiscountTopMm:     intPtr60(35),
		FrontDiscountBetweenMm: intPtr60(36),
		CompatiblePlacements:   []string{"top", "between"},
		BOMMembers: map[string]domain.OpeningBOMMember{
			"strip": {ComponentID: "b0000004-0000-0000-0000-000013270001", HeightMm: floatPtr60(70)},
		},
		BodyModifiers: []domain.OpeningBodyModifier{
			{Role: "lateral", Effect: "notch", NotchAt: "top_front", NotchDepthMm: floatPtr60(15), NotchHeightMm: floatPtr60(70)},
			{Role: "horizontal", Effect: "depth_reduction"},
			{Role: "door", Effect: "bevel", BevelAt: "top_front", BevelSizeMm: floatPtr60(13), BevelAngleDeg: floatPtr60(45)},
		},
	}
	return &domain.GripSnapshotRecipe{
		Mode:           domain.GripModeGola,
		TopProfile:     frozen,
		BetweenProfile: frozen,
	}
}

// The whole recipe's modifier set resolves: 3 effects at top (notch,
// depth_reduction, bevel) and 2 at between (notch + bevel) — the shared
// set's depth_reduction never reaches between, nothing else is dropped.
func TestProjectGripSharedSetSkipsDepthReductionOnlyBetween(t *testing.T) {
	modifiers, modErr := ResolveProjectGripModifiers(sharedSetItalianRecipe())
	if modErr != nil {
		t.Fatalf("the dual-position profile must resolve, got %s (%s)", modErr.Code, modErr.Message)
	}
	atTop, atBetween := map[string]int{}, map[string]int{}
	for _, m := range modifiers {
		switch m.Boundary {
		case "top":
			atTop[m.Effect]++
		case "between":
			atBetween[m.Effect]++
		default:
			t.Fatalf("unexpected boundary %q", m.Boundary)
		}
	}
	if atTop["depth_reduction"] != 1 || atTop["notch"] != 1 || atTop["bevel"] != 1 {
		t.Fatalf("top must keep notch+depth_reduction+bevel, got %v", atTop)
	}
	if atBetween["depth_reduction"] != 0 {
		t.Fatalf("between must never carry depth_reduction, got %v", atBetween)
	}
	if atBetween["notch"] != 1 || atBetween["bevel"] != 1 {
		t.Fatalf("between must keep notch+bevel, got %v", atBetween)
	}
}

// The full furniture resolves end to end: the 3-drawer column under the
// italian style mounts the top strip and the gripped between strip, with the
// side notches cut at both boundaries (the pre-#1726 whole-resolve reject).
func TestProjectGripSharedSetItalianResolvesEndToEnd(t *testing.T) {
	module, catalog := drawerColumnCatalog()
	catalog.Components = append(catalog.Components, domain.Component{
		ID: "b0000004-0000-0000-0000-000013270001", Name: "Tira gola italiano (melamina)",
		Placement: domain.PlacementSuperior, Active: true,
	})
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}
	recipe := sharedSetItalianRecipe()

	fronts, frontsErr := ProjectGripFronts(recipe)
	if frontsErr != nil || len(fronts) == 0 {
		t.Fatalf("fronts: %v %+v", frontsErr, fronts)
	}
	members := ProjectGripMembers(recipe.TopProfile)
	if members == nil {
		members = &OpeningMembers{}
	}
	members.BetweenComponentMembers = ProjectGripBetweenStrips(recipe.BetweenProfile)
	modifiers, modErr := ResolveProjectGripModifiers(recipe)
	if modErr != nil {
		t.Fatalf("modifiers: %s (%s)", modErr.Code, modErr.Message)
	}

	layout, boards, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts: fronts, openingMembers: members, openingBodyModifiers: modifiers,
	})
	if err != nil {
		t.Fatalf("the italian top+between style must resolve the drawer column, got %v", err)
	}
	topStrips, betweenStrips := 0, 0
	for _, b := range boards {
		if strings.HasPrefix(b.id, "opening-strip-") && !strings.Contains(b.id, "between") {
			topStrips++
		}
		if strings.HasPrefix(b.id, "opening-strip-between-") {
			betweenStrips++
		}
	}
	// #1706: 3 rows → the bottom boundary grips → 1 between strip; the top
	// strip mounts once.
	if topStrips != 1 || betweenStrips != 1 {
		t.Fatalf("top strip ×1 + between strip ×1 expected, got top=%d between=%d (layout %+v)", topStrips, betweenStrips, layout.DimensionsMm)
	}
}

// #1726 review: the exception skips ONLY the clean depth_reduction shape.
// A between copy declaring depth_reduction MIXED with bevel fields is a
// contradiction — the shared set must not swallow it; the resolver rejects
// it fail-closed, exactly like the pin path does.
func TestProjectGripBetweenCopyMixedDeclarationStillFailsClosed(t *testing.T) {
	recipe := sharedSetItalianRecipe()
	recipe.BetweenProfile = &domain.FrozenGripProfile{
		ProfileID: "profile.gola-mixta", Code: "GOLA-MIXTA", Name: "Perfil contradictorio",
		ProfileHeightMm: floatPtr60(70), ProfileDepthMm: floatPtr60(15),
		FrontDiscountBetweenMm: intPtr60(36),
		CompatiblePlacements:   []string{"between"},
		BodyModifiers: []domain.OpeningBodyModifier{
			// depth-reduction channel (the value) + bevel fields: the
			// resolver's depth-reduction branch answers a contradiction.
			{Role: "horizontal", DepthReductionMm: intPtr60(10),
				BevelAt: "front_boundary", BevelSizeMm: floatPtr60(13), BevelAngleDeg: floatPtr60(45)},
		},
	}
	_, modErr := ResolveProjectGripModifiers(recipe)
	if modErr == nil {
		t.Fatalf("a mixed depth_reduction+bevel declaration must keep failing closed at between")
	}
	if modErr.Code != OpeningErrBodyModifierInvalid {
		t.Fatalf("expected %s, got %s (%s)", OpeningErrBodyModifierInvalid, modErr.Code, modErr.Message)
	}
}

// The clean valueless depth_reduction (#1317) on a between-ONLY profile
// (no top mount to consume it) still skips: the effect has no consumer at
// between by definition, whatever serves the top boundary.
func TestProjectGripBetweenOnlyCleanDepthReductionSkips(t *testing.T) {
	recipe := sharedSetItalianRecipe()
	recipe.BetweenProfile = &domain.FrozenGripProfile{
		ProfileID: "profile.gola-solo-between", Code: "GOLA-SOLO", Name: "Sólo between",
		ProfileHeightMm: floatPtr60(70), ProfileDepthMm: floatPtr60(15),
		FrontDiscountBetweenMm: intPtr60(36),
		CompatiblePlacements:   []string{"between"},
		BodyModifiers: []domain.OpeningBodyModifier{
			{Role: "horizontal", Effect: "depth_reduction"},
		},
	}
	modifiers, modErr := ResolveProjectGripModifiers(recipe)
	if modErr != nil {
		t.Fatalf("clean valueless depth_reduction on the between copy must skip, got %s (%s)", modErr.Code, modErr.Message)
	}
	for _, m := range modifiers {
		if m.Boundary == "between" && m.Effect == "depth_reduction" {
			t.Fatalf("between must never carry depth_reduction")
		}
	}
}
