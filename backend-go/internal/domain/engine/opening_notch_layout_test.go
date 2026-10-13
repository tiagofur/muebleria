package engine

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1287 / §13.3 — the DECLARED side notch (arbitrary fixture dimensions:
// 10 high × 19 deep — NOT datasheet values; the datasheet's 10/19 callouts
// dimension the SU116 support-mount machining, see opening_notch_layout.go)
// materializes as an exact local subtraction box on every side board. The fixture verifies in FURNITURE
// coordinates — derived independently from the published AABB — so the
// assertion proves the contract (hug the top-front corner, through the full
// thickness) regardless of the board's local axis assignment.
func openingNotchModifiers() []ResolvedOpeningBodyModifier {
	return []ResolvedOpeningBodyModifier{{
		Effect:        OpeningModifierEffectNotch,
		Role:          "lateral",
		ProfileID:     "profile.gola-l.8006",
		Boundary:      "top",
		NotchHeightMm: 10,
		NotchDepthMm:  19,
	}}
}

func TestOpeningNotchMaterializesOnSideBoards(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}

	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts:               openingPassFront("top", 40),
		openingBodyModifiers: openingNotchModifiers(),
	})
	if err != nil {
		t.Fatalf("resolve with declared notch: %v", err)
	}

	notched := 0
	for _, component := range layout.Components {
		if component.SlotID != "lateral_izquierdo" && component.SlotID != "lateral_derecho" {
			if len(component.Notches) != 0 {
				t.Fatalf("non-side component %s must not carry notches", component.ComponentInstanceID)
			}
			continue
		}
		notched++
		if len(component.Notches) != 1 {
			t.Fatalf("side %s must carry exactly one notch, got %d", component.ComponentInstanceID, len(component.Notches))
		}
		notch := component.Notches[0]
		if notch.ProfileID != "profile.gola-l.8006" || notch.Boundary != "top" {
			t.Fatalf("notch provenance = %+v", notch)
		}

		// The local box must remove a 10×19×thickness corner: its volume is
		// exact and it stays inside the board. The through dimension is the
		// board's thickness — the smallest AABB extent.
		vol := notch.SizeMm[0] * notch.SizeMm[1] * notch.SizeMm[2]
		thickness := component.DimensionsMm[0]
		for _, d := range component.DimensionsMm {
			if d < thickness {
				thickness = d
			}
		}
		if vol != 10*19*thickness {
			t.Fatalf("side %s notch box %v (thickness %g) is not the 10×19 through-cut",
				component.ComponentInstanceID, notch.SizeMm, thickness)
		}

		// Furniture-frame verification from the PUBLISHED transform, derived
		// independently of the local axis assignment: the notch occupies the
		// top 10 mm, the front 19 mm, and the full thickness span.
		for cornerX := 0; cornerX < 2; cornerX++ {
			for cornerY := 0; cornerY < 2; cornerY++ {
				for cornerZ := 0; cornerZ < 2; cornerZ++ {
					local := [3]float64{
						notch.StartMm[0] + notch.SizeMm[0]*float64(cornerX),
						notch.StartMm[1] + notch.SizeMm[1]*float64(cornerY),
						notch.StartMm[2] + notch.SizeMm[2]*float64(cornerZ),
					}
					world := furniturePointFromLocal(component.LocalTransform, local)
					minC := component.Transform.TranslationMm
					maxC := [3]float64{
						minC[0] + component.DimensionsMm[0],
						minC[1] + component.DimensionsMm[1],
						minC[2] + component.DimensionsMm[2],
					}
					if mathAbs(world[2]-(maxC[2]-10)) > 1e-6 && mathAbs(world[2]-maxC[2]) > 1e-6 {
						t.Fatalf("side %s notch corner %v is not on the top 10 mm band (board top %g)",
							component.ComponentInstanceID, world, maxC[2])
					}
					if mathAbs(world[1]-(maxC[1]-19)) > 1e-6 && mathAbs(world[1]-maxC[1]) > 1e-6 {
						t.Fatalf("side %s notch corner %v is not on the front 19 mm band (board front %g)",
							component.ComponentInstanceID, world, maxC[1])
					}
					if world[0] < minC[0]-1e-6 || world[0] > maxC[0]+1e-6 {
						t.Fatalf("side %s notch corner %v leaves the thickness span [%g %g]",
							component.ComponentInstanceID, world, minC[0], maxC[0])
					}
				}
			}
		}
	}
	if notched != 2 {
		t.Fatalf("both side boards must be notched, got %d", notched)
	}
}

func mathAbs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

// furniturePointFromLocal mirrors the contract's placement rule: world =
// translationMm + basis · local.
func furniturePointFromLocal(lt LayoutLocalTransform, p [3]float64) [3]float64 {
	out := [3]float64{lt.TranslationMm[0], lt.TranslationMm[1], lt.TranslationMm[2]}
	for axis, column := range [3][3]float64{lt.Basis.X, lt.Basis.Y, lt.Basis.Z} {
		for k := 0; k < 3; k++ {
			out[k] += column[k] * p[axis]
		}
	}
	return out
}

// A notch that does not fit the board fails closed — never a clipped cut.
func TestOpeningNotchFailsClosedWhenItDoesNotFit(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}

	tooTall := []ResolvedOpeningBodyModifier{{
		Effect: OpeningModifierEffectNotch, Role: "lateral", ProfileID: "p", Boundary: "top",
		NotchHeightMm: 5000, NotchDepthMm: 19,
	}}
	if _, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts: openingPassFront("top", 40), openingBodyModifiers: tooTall,
	}); err == nil || !strings.Contains(err.Error(), "no cabe") {
		t.Fatalf("an oversized notch must fail closed, got %v", err)
	}

	tooDeep := []ResolvedOpeningBodyModifier{{
		Effect: OpeningModifierEffectNotch, Role: "lateral", ProfileID: "p", Boundary: "top",
		NotchHeightMm: 10, NotchDepthMm: 5000,
	}}
	if _, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts: openingPassFront("top", 40), openingBodyModifiers: tooDeep,
	}); err == nil || !strings.Contains(err.Error(), "no cabe") {
		t.Fatalf("a too-deep notch must fail closed, got %v", err)
	}

	wrongRole := []ResolvedOpeningBodyModifier{{
		Effect: OpeningModifierEffectNotch, Role: "shelf", ProfileID: "p", Boundary: "top",
		NotchHeightMm: 10, NotchDepthMm: 19,
	}}
	if _, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts: openingPassFront("top", 40), openingBodyModifiers: wrongRole,
	}); err == nil || !strings.Contains(err.Error(), "lateral") {
		t.Fatalf("a non-lateral notch role must fail closed, got %v", err)
	}

	betweenBoundary := []ResolvedOpeningBodyModifier{{
		Effect: OpeningModifierEffectNotch, Role: "lateral", ProfileID: "p", Boundary: "between:z1:z2",
		NotchHeightMm: 10, NotchDepthMm: 19,
	}}
	if _, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts: openingPassFront("top", 40), openingBodyModifiers: betweenBoundary,
	}); err == nil || !strings.Contains(err.Error(), "no tiene consumidor") {
		t.Fatalf("a between-boundary notch must fail closed in v1, got %v", err)
	}

	offset := []ResolvedOpeningBodyModifier{{
		Effect: OpeningModifierEffectNotch, Role: "lateral", ProfileID: "p", Boundary: "top",
		NotchHeightMm: 10, NotchDepthMm: 19, NotchOffsetMm: 120,
	}}
	if _, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts: openingPassFront("top", 40), openingBodyModifiers: offset,
	}); err == nil || !strings.Contains(err.Error(), "offset") {
		t.Fatalf("a non-corner notch must fail closed in v1, got %v", err)
	}
}

// Without declared modifiers nothing is cut — the historical layout stays
// byte-identical (and a depth-reduction effect never cuts).
func TestOpeningNotchAbsentSliceCutsNothing(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}

	depthReduction := []ResolvedOpeningBodyModifier{{
		Effect: OpeningModifierEffectDepthReduction, Role: "horizontal", ProfileID: "p", Boundary: "top",
		DepthReductionMm: 27,
	}}
	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts:               openingPassFront("top", 40),
		openingBodyModifiers: depthReduction,
	})
	if err != nil {
		t.Fatalf("resolve with depth-reduction only: %v", err)
	}
	for _, component := range layout.Components {
		if len(component.Notches) != 0 {
			t.Fatalf("no notch modifier declared: %s must not carry notches", component.ComponentInstanceID)
		}
	}
}

// The full live path: ResolveDesignOpening resolves the pin's frozen
// modifiers and the response carries them for the layout pass.
func TestResolveDesignOpeningCarriesDeclaredBodyModifiers(t *testing.T) {
	height, width := 720, 400
	selection := &domain.DesignOpeningSelection{
		System:    "gola",
		ProfileID: "profile.gola-l.8006",
		ProfilePin: &domain.DesignOpeningProfilePin{
			ProfileCode:          "GOLA-L-8006",
			FrontReductionMm:     40,
			DatasheetStatus:      "verified",
			CompatiblePlacements: []string{"top"},
			BodyModifiers: []domain.OpeningBodyModifier{{
				Role: "lateral", NotchHeightMm: fPtr(56.5), NotchDepthMm: fPtr(27.2), NotchAt: "top_front",
			}},
		},
	}
	profiles := []OpeningProfileData{{
		ProfileID:            "profile.gola-l.8006",
		DatasheetStatus:      "verified",
		FrontReductionMm:     40,
		CompatiblePlacements: []string{"top"},
		BodyModifiers: []OpeningContractBodyModifier{{
			Role: "lateral", NotchHeightMm: fPtr(56.5), NotchDepthMm: fPtr(27.2), NotchAt: "top_front",
		}},
	}}
	resolution, resErr := ResolveDesignOpening(width, height, selection, profiles, nil, nil)
	if resErr != nil {
		t.Fatalf("resolve: %v", resErr)
	}
	if resolution == nil || resolution.State != DesignOpeningStateResolved {
		t.Fatalf("resolution = %+v, want resolved", resolution)
	}
	if len(resolution.BodyModifiers) != 1 {
		t.Fatalf("bodyModifiers = %+v, want the declared notch", resolution.BodyModifiers)
	}
	mod := resolution.BodyModifiers[0]
	if mod.Effect != OpeningModifierEffectNotch || mod.Role != "lateral" ||
		mod.NotchHeightMm != 56.5 || mod.NotchDepthMm != 27.2 {
		t.Fatalf("resolved notch = %+v", mod)
	}
}

func fPtr(v float64) *float64 { return &v }
