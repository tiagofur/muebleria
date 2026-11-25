package engine

// #1721 — the hinge count-rule pattern follows the opening grip's FINAL door
// geometry: the A3 front pass shortens the door board after the pattern
// froze mm positions, so the pattern re-distributes over the trimmed length
// (extremes keep their offsets from the REAL edges; the count stays the
// bought demand). Without grips or without a surviving pattern nothing
// moves — the historical layout stays byte-identical.

import (
	"sort"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func patternHingeFaceYs(res *AuthoringResolveResult, hardwareID string) []float64 {
	var ys []float64
	for _, hw := range res.Layout.Hardware {
		if hw.HardwareID == hardwareID && len(hw.OffsetMm) == 2 {
			ys = append(ys, hw.OffsetMm[1])
		}
	}
	sort.Float64s(ys)
	return ys
}

func patternHingeIntentYs(res *AuthoringResolveResult, hardwareID string) []float64 {
	var ys []float64
	for _, p := range res.Normalized.HardwarePlacements {
		if p.CatalogHardwareID == hardwareID {
			ys = append(ys, p.OffsetMm[1])
		}
	}
	sort.Float64s(ys)
	return ys
}

func ysEqual(ys []float64, want ...float64) bool {
	if len(ys) != len(want) {
		return false
	}
	for i := range ys {
		if ys[i] != want[i] {
			return false
		}
	}
	return true
}

func TestOpeningGripMovesCountRuleHingesWithTheTrimmedDoor(t *testing.T) {
	mod, catalog := countRuleDoorCatalog(720, domain.HingeDemandRole)
	choices := map[string]string{
		"INTERIOR": "mat-1", "FRENTES": "mat-1",
		domain.HingeDemandRole: "hw-standard",
	}
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}

	// Baseline (no grip): extremes at 90 from the authored edges.
	base, err := ResolveAuthoringLayout(AuthoringResolveInput{Module: mod, Catalog: catalog, Dims: dims, OptionChoices: choices})
	if err != nil {
		t.Fatalf("baseline resolve: %v", err)
	}
	baseDoor := findComponentByID(base.Layout.Components, "puerta")
	if baseDoor == nil {
		t.Fatalf("baseline has no door component")
	}
	if baseDoor.LengthMm != 714 {
		t.Fatalf("baseline door drifted: L=%v, want 714", baseDoor.LengthMm)
	}
	if ys := patternHingeFaceYs(base, "hw-standard"); !ysEqual(ys, 90, 624) {
		t.Fatalf("baseline hinge ys = %v, want [90 624]", ys)
	}

	// Gola top 70: the door measures 650 and the top cup drops the same 70 —
	// 90 from the door's REAL top edge (650−90 = 560), not 26.
	res, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: mod, Catalog: catalog, Dims: dims, OptionChoices: choices,
		Fronts: openingPassFront("top", 70),
	})
	if err != nil {
		t.Fatalf("gola resolve: %v", err)
	}
	door := findComponentByID(res.Layout.Components, "puerta")
	if door == nil || door.LengthMm != 650 {
		t.Fatalf("gola door = L %v, want 650", door.LengthMm)
	}
	if ys := patternHingeFaceYs(res, "hw-standard"); !ysEqual(ys, 90, 560) {
		t.Fatalf("gola hinge ys = %v, want [90 560]", ys)
	}
	// The intents the plugin consumes (and the drilling derives from) carry
	// the same corrected positions.
	if ys := patternHingeIntentYs(res, "hw-standard"); !ysEqual(ys, 90, 560) {
		t.Fatalf("gola intent ys = %v, want [90 560]", ys)
	}
}

func TestOpeningGripRedistributesTallDoorIntermediates(t *testing.T) {
	mod, catalog := countRuleDoorCatalog(2100, domain.HingeDemandRole)
	choices := map[string]string{
		"INTERIOR": "mat-1", "FRENTES": "mat-1",
		domain.HingeDemandRole: "hw-standard",
	}
	res, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module:        mod,
		Catalog:       catalog,
		Dims:          &LayoutDims{WidthMm: 600, HeightMm: 2100, DepthMm: 560},
		OptionChoices: choices,
		Fronts:        openingPassFront("top", 70),
	})
	if err != nil {
		t.Fatalf("gola resolve: %v", err)
	}
	door := findComponentByID(res.Layout.Components, "puerta")
	if door == nil || door.LengthMm != 2030 {
		t.Fatalf("gola door = L %v, want 2030", door.LengthMm)
	}
	// 5 hinges over the trimmed 2030: extremes 90/90 from the real edges,
	// intermediates spread evenly (steps of 462.5).
	if ys := patternHingeFaceYs(res, "hw-standard"); !ysEqual(ys, 90, 552.5, 1015, 1477.5, 1940) {
		t.Fatalf("gola hinge ys = %v, want [90 552.5 1015 1477.5 1940]", ys)
	}
}

func TestOpeningRebaseMovesCountRuleHingesWithTheLiftedDoor(t *testing.T) {
	mod, catalog := countRuleDoorCatalog(720, domain.HingeDemandRole)
	choices := map[string]string{
		"INTERIOR": "mat-1", "FRENTES": "mat-1",
		domain.HingeDemandRole: "hw-standard",
	}
	res, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module:        mod,
		Catalog:       catalog,
		Dims:          &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560},
		OptionChoices: choices,
		Fronts:        openingPassFront("bottom", -20),
	})
	if err != nil {
		t.Fatalf("rebase resolve: %v", err)
	}
	door := findComponentByID(res.Layout.Components, "puerta")
	if door == nil || door.LengthMm != 736 || door.Transform.TranslationMm[2] != -20 {
		t.Fatalf("rebase door = L %v @ z %v, want 736 @ -20", door.LengthMm, door.Transform.TranslationMm[2])
	}
	// The lifted door measures 736: extremes at 90 from its real edges.
	if ys := patternHingeFaceYs(res, "hw-standard"); !ysEqual(ys, 90, 646) {
		t.Fatalf("rebase hinge ys = %v, want [90 646]", ys)
	}
}

func TestOpeningStackedPatternDoorsFollowTheirOwnRows(t *testing.T) {
	mod, catalog := countRuleDoorCatalog(720, domain.HingeDemandRole)
	inst := &mod.Agregados[0]
	inst.Quantity = 2
	inst.LayoutDirection = "vertical"
	choices := map[string]string{
		"INTERIOR": "mat-1", "FRENTES": "mat-1",
		domain.HingeDemandRole: "hw-standard",
	}
	res, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module:        mod,
		Catalog:       catalog,
		Dims:          &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560},
		OptionChoices: choices,
		Fronts:        openingPassFront("top", 70),
	})
	if err != nil {
		t.Fatalf("stacked resolve: %v", err)
	}
	// Two rows: each door board re-distributes its own pattern over its own
	// final length — per row, 2 hinges at 90 from each REAL edge.
	var doors []*LayoutComponent
	for i := range res.Layout.Components {
		if res.Layout.Components[i].SlotID == "puerta" {
			doors = append(doors, &res.Layout.Components[i])
		}
	}
	if len(doors) != 2 {
		t.Fatalf("stacked doors = %d, want 2", len(doors))
	}
	total := 0
	for _, door := range doors {
		zBottom := door.Transform.TranslationMm[2]
		zTop := zBottom + door.LengthMm
		var ys []float64
		for _, hw := range res.Layout.Hardware {
			if hw.HardwareID != "hw-standard" {
				continue
			}
			hz := hw.LocalTransform.TranslationMm[2]
			if hz < zBottom-0.01 || hz > zTop+0.01 {
				continue
			}
			ys = append(ys, hz-zBottom)
		}
		sort.Float64s(ys)
		if !ysEqual(ys, 90, float64(door.LengthMm)-90) {
			t.Fatalf("row door L=%v hinges at %v, want [90 %v]", door.LengthMm, ys, float64(door.LengthMm)-90)
		}
		total += len(ys)
	}
	if total != 4 {
		t.Fatalf("stacked rows drew %d hinges, want 4", total)
	}
}

func TestOpeningGripKeepsSuppressedPatternAndFixedPlacement(t *testing.T) {
	mod, catalog := countRuleDoorCatalog(720, domain.HingeDemandRole)
	// A FIXED hinge of the same hardware wins: the pattern stays out.
	agr := &catalog.Agregados[0]
	comp := &agr.Components[0]
	comp.Overrides.HardwarePlacements = append(comp.Overrides.HardwarePlacements, domain.HardwarePlacement{
		HardwareID:       "hw-standard",
		AnchorFace:       "back",
		RelativePosition: domain.HardwareRelPosition{XMm: 20.5, YMm: 300},
	})
	choices := map[string]string{
		"INTERIOR": "mat-1", "FRENTES": "mat-1",
		domain.HingeDemandRole: "hw-standard",
	}
	res, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module:        mod,
		Catalog:       catalog,
		Dims:          &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560},
		OptionChoices: choices,
		Fronts:        openingPassFront("top", 70),
	})
	if err != nil {
		t.Fatalf("suppressed resolve: %v", err)
	}
	// Exactly the authored fixed placement at its authored offset — the grip
	// never re-writes the author's intent.
	if ys := patternHingeFaceYs(res, "hw-standard"); !ysEqual(ys, 300) {
		t.Fatalf("fixed hinge ys = %v, want [300] (pattern suppressed, fixed untouched)", ys)
	}
}

func TestOpeningGripReexpandsTwoDistinctPatterns(t *testing.T) {
	// The 2P recipe shape: ONE door board carrying TWO distinct count-rule
	// patterns (one per leaf half, distinct X). Each pattern re-expands to N
	// positions over the trimmed length — the dedup must not collapse them
	// into one, nor multiply the already-expanded copies.
	mod, catalog := countRuleDoorCatalog(720, domain.HingeDemandRole)
	agr := &catalog.Agregados[0]
	comp := &agr.Components[0]
	comp.Overrides.HardwarePlacements[0].RelativePosition = domain.HardwareRelPosition{XMm: 20.5, YMm: 90}
	comp.Overrides.HardwarePlacements[0].CountRule = &domain.HingeCountRule{Kind: "hingeDemand", EndOffsetBottomMm: 90, EndOffsetTopMm: 90}
	patternB := domain.HardwarePlacement{
		OptionRole: domain.HingeDemandRole, AnchorFace: "back",
		CountRule:        &domain.HingeCountRule{Kind: "hingeDemand", EndOffsetBottomMm: 90, EndOffsetTopMm: 90},
		RelativePosition: domain.HardwareRelPosition{XMm: 100, YMm: 90, XFormula: "PW-20.5"},
	}
	comp.Overrides.HardwarePlacements = append(comp.Overrides.HardwarePlacements, patternB)
	choices := map[string]string{
		"INTERIOR": "mat-1", "FRENTES": "mat-1",
		domain.HingeDemandRole: "hw-standard",
	}
	res, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module:        mod,
		Catalog:       catalog,
		Dims:          &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560},
		OptionChoices: choices,
		Fronts:        openingPassFront("top", 70),
	})
	if err != nil {
		t.Fatalf("two-pattern resolve: %v", err)
	}
	// 2 distinct patterns × 2 hinges over the trimmed 650: four placements,
	// each pattern's pair at 90 from the REAL edges. Group by the observed
	// mount X (the two patterns differ in X; the B formula evaluates with the
	// engine's integer semantics) — each group must carry the full Y set.
	door := findComponentByID(res.Layout.Components, "puerta")
	if door == nil || door.LengthMm != 650 {
		t.Fatalf("two-pattern door = L %v, want 650", door.LengthMm)
	}
	type row struct{ x, y float64 }
	var rows []row
	for _, hw := range res.Layout.Hardware {
		if hw.HardwareID != "hw-standard" || len(hw.OffsetMm) != 2 {
			continue
		}
		rows = append(rows, row{hw.OffsetMm[0], hw.OffsetMm[1]})
	}
	if len(rows) != 4 {
		t.Fatalf("two-pattern hinge count = %d, want 4 (2 patterns × 2 ys)", len(rows))
	}
	xs := map[float64][]float64{}
	for _, r := range rows {
		xs[r.x] = append(xs[r.x], r.y)
	}
	if len(xs) != 2 {
		t.Fatalf("two-pattern mount Xs = %v, want 2 distinct columns", xs)
	}
	for x, ys := range xs {
		sort.Float64s(ys)
		if !ysEqual(ys, 90, 560) {
			t.Fatalf("pattern at x=%v hinge ys = %v, want [90 560]", x, ys)
		}
	}
}
