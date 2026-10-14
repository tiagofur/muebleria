package engine

import (
	"strings"
	"testing"
)

// #1327 slice 3 — the DECLARED door bevel (italian gola's 45° grip cut,
// arbitrary fixture size 9 mm — the door is 18 thick, so the wedge legs must stay strictly under it) materializes as an exact local wedge on the
// door/drawer-front boards. The fixture verifies in FURNITURE coordinates —
// derived independently from the published AABB — so the assertion proves
// the contract (hug the boundary edge's front corner, equal legs on the
// vertical and front axes, full width through) regardless of the board's
// local axis assignment.
func openingBevelModifiers(boundary string) []ResolvedOpeningBodyModifier {
	return []ResolvedOpeningBodyModifier{{
		Effect:        OpeningModifierEffectBevel,
		Role:          "door",
		ProfileID:     "profile.gola-italiano",
		Boundary:      boundary,
		BevelAngleDeg: 45,
		BevelSizeMm:   9,
	}}
}

func TestOpeningBevelMaterializesOnDoorBoards(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}

	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts:               openingPassFront("top", 40),
		openingBodyModifiers: openingBevelModifiers("top"),
	})
	if err != nil {
		t.Fatalf("resolve with declared bevel: %v", err)
	}

	beveled := 0
	for _, component := range layout.Components {
		if component.SlotID != "puerta" {
			if len(component.Bevels) != 0 {
				t.Fatalf("non-door component %s must not carry bevels", component.ComponentInstanceID)
			}
			continue
		}
		beveled++
		if len(component.Bevels) != 1 {
			t.Fatalf("door %s must carry exactly one bevel, got %d", component.ComponentInstanceID, len(component.Bevels))
		}
		bevel := component.Bevels[0]
		if bevel.ProfileID != "profile.gola-italiano" || bevel.Boundary != "top" {
			t.Fatalf("bevel provenance = %+v", bevel)
		}
		if bevel.AngleDeg != 45 || bevel.Edge != "top_front" {
			t.Fatalf("bevel geometry = %+v, want the 45° top_front wedge", bevel)
		}

		// The bounding prism is exact: two 9 mm legs (vertical + front) through
		// the door's full 596 mm width (the fixture's PW−4). The removed
		// material is the wedge inside it, never the full box.
		legs, through := 0, 0.0
		for _, d := range bevel.SizeMm {
			if d == 9 {
				legs++
			} else {
				through = d
			}
		}
		if legs != 2 || through != 596 {
			t.Fatalf("door %s bevel prism %v is not the 9×9 through wedge over the 596 mm width",
				component.ComponentInstanceID, bevel.SizeMm)
		}

		// Furniture-frame verification from the PUBLISHED transform: the
		// wedge lives in the door's top 9 mm and front 9 mm, through the
		// full width.
		for cornerX := 0; cornerX < 2; cornerX++ {
			for cornerY := 0; cornerY < 2; cornerY++ {
				for cornerZ := 0; cornerZ < 2; cornerZ++ {
					local := [3]float64{
						bevel.StartMm[0] + bevel.SizeMm[0]*float64(cornerX),
						bevel.StartMm[1] + bevel.SizeMm[1]*float64(cornerY),
						bevel.StartMm[2] + bevel.SizeMm[2]*float64(cornerZ),
					}
					world := furniturePointFromLocal(component.LocalTransform, local)
					minC := component.Transform.TranslationMm
					maxC := [3]float64{
						minC[0] + component.DimensionsMm[0],
						minC[1] + component.DimensionsMm[1],
						minC[2] + component.DimensionsMm[2],
					}
					if mathAbs(world[2]-(maxC[2]-9)) > 1e-6 && mathAbs(world[2]-maxC[2]) > 1e-6 {
						t.Fatalf("door %s bevel corner %v is not on the top 9 mm band (door top %g)",
							component.ComponentInstanceID, world, maxC[2])
					}
					if mathAbs(world[1]-(maxC[1]-9)) > 1e-6 && mathAbs(world[1]-maxC[1]) > 1e-6 {
						t.Fatalf("door %s bevel corner %v is not on the front 9 mm band (door front %g)",
							component.ComponentInstanceID, world, maxC[1])
					}
					if world[0] < minC[0]-1e-6 || world[0] > maxC[0]+1e-6 {
						t.Fatalf("door %s bevel corner %v leaves the width span [%g %g]",
							component.ComponentInstanceID, world, minC[0], maxC[0])
					}
				}
			}
		}
	}
	if beveled != 1 {
		t.Fatalf("the door board must be beveled, got %d", beveled)
	}
}

// A bottom-boundary bevel (rebase italian gola) hugs the door's bottom front
// corner — the mirror of the top wedge.
func TestOpeningBevelBottomBoundaryHugsBottomFront(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}

	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts:               openingPassFront("bottom", 40),
		openingBodyModifiers: openingBevelModifiers("bottom"),
	})
	if err != nil {
		t.Fatalf("resolve with bottom bevel: %v", err)
	}
	for _, component := range layout.Components {
		if component.SlotID != "puerta" {
			continue
		}
		if len(component.Bevels) != 1 {
			t.Fatalf("door %s must carry exactly one bevel, got %d", component.ComponentInstanceID, len(component.Bevels))
		}
		bevel := component.Bevels[0]
		if bevel.Edge != "bottom_front" {
			t.Fatalf("bevel edge = %q, want bottom_front", bevel.Edge)
		}
		world := furniturePointFromLocal(component.LocalTransform, bevel.StartMm)
		minC := component.Transform.TranslationMm
		if mathAbs(world[2]-minC[2]) > 1e-6 {
			t.Fatalf("bottom bevel start %v does not hug the door bottom %g", world, minC[2])
		}
		return
	}
	t.Fatalf("the resolve published no door component")
}

// Fail-closed: a role without a geometry consumer, a bevel that does not fit
// the door's height or thickness, a between boundary — the resolve never
// clips or guesses.
func TestOpeningBevelFailsClosed(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}

	wrongRole := []ResolvedOpeningBodyModifier{{
		Effect: OpeningModifierEffectBevel, Role: "lateral", ProfileID: "p", Boundary: "top",
		BevelAngleDeg: 45, BevelSizeMm: 18,
	}}
	if _, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts: openingPassFront("top", 40), openingBodyModifiers: wrongRole,
	}); err == nil || !strings.Contains(err.Error(), `"door"`) {
		t.Fatalf("a non-door bevel role must fail closed, got %v", err)
	}

	tooTall := []ResolvedOpeningBodyModifier{{
		Effect: OpeningModifierEffectBevel, Role: "door", ProfileID: "p", Boundary: "top",
		BevelAngleDeg: 45, BevelSizeMm: 5000,
	}}
	if _, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts: openingPassFront("top", 40), openingBodyModifiers: tooTall,
	}); err == nil || !strings.Contains(err.Error(), "no cabe en la dimensión vertical") {
		t.Fatalf("an oversized bevel must fail closed, got %v", err)
	}

	// The door's front extent is its 18 mm thickness: an 18 mm leg cannot fit
	// (the fit check is strict — a wedge eating the whole face is nonsense).
	fullThickness := []ResolvedOpeningBodyModifier{{
		Effect: OpeningModifierEffectBevel, Role: "door", ProfileID: "p", Boundary: "top",
		BevelAngleDeg: 45, BevelSizeMm: 18,
	}}
	if _, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts: openingPassFront("top", 40), openingBodyModifiers: fullThickness,
	}); err == nil || !strings.Contains(err.Error(), "no cabe en la dimensión de frente") {
		t.Fatalf("a bevel deeper than the door thickness must fail closed, got %v", err)
	}

	betweenBoundary := []ResolvedOpeningBodyModifier{{
		Effect: OpeningModifierEffectBevel, Role: "door", ProfileID: "p", Boundary: "between:z1:z2",
		BevelAngleDeg: 45, BevelSizeMm: 10,
	}}
	if _, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts: openingPassFront("top", 40), openingBodyModifiers: betweenBoundary,
	}); err == nil || !strings.Contains(err.Error(), "no tiene consumidor") {
		t.Fatalf("a between-boundary bevel must fail closed in v1, got %v", err)
	}
}

// Without declared modifiers nothing is cut — the historical layout stays
// byte-identical.
func TestOpeningBevelAbsentSliceCutsNothing(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}

	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{})
	if err != nil {
		t.Fatalf("resolve without modifiers: %v", err)
	}
	for _, component := range layout.Components {
		if len(component.Bevels) != 0 {
			t.Fatalf("no modifier declared: %s must not carry bevels", component.ComponentInstanceID)
		}
	}
}
