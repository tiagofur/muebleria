package engine

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1327 slice 2 — the opening's component members (panels — the italian
// gola strip) materialize as REAL boards in the gola band: full furniture
// width at the top front, declared depth (furniture Y) and height
// (vertical), the door's material role (FRENTE → color de puerta). The BOM
// mirrors the exact board as a cut part. A declared component missing from
// the catalog fails closed.

func componentMemberMods() *OpeningMembers {
	return &OpeningMembers{
		ComponentMembers: []OpeningComponentMember{{
			Key: "tira", ComponentID: "comp-tira-gola-it", DepthMm: 40, HeightMm: 18,
		}},
	}
}

func golaItalianoCatalog(catalog domain.Catalog) domain.Catalog {
	tira := domain.Component{
		ID: "comp-tira-gola-it", Code: "TIRA-GOLA-IT", Name: "Tira gola italiano",
		Placement:    domain.PlacementSuperior,
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		OptionRoles: []string{"FRENTE"}, Active: true,
	}
	catalog.Components = append(catalog.Components, tira)
	catalog.Materials = append(catalog.Materials, domain.MaterialBoard{
		ID: "mat-frente", Code: "MEL-BLANCO", Name: "Melamina Blanca",
		WidthMm: 2750, LengthMm: 1850, ThicknessMm: 18, Active: true,
	})
	return catalog
}

func TestOpeningComponentMemberPlacesBoardInGolaBand(t *testing.T) {
	module, catalog := depthReductionGolaModule()
	catalog = golaItalianoCatalog(catalog)
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 580}

	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, map[string]string{"FRENTE": "mat-frente"}, resolveOptions{
		openingMembers: componentMemberMods(),
	})
	if err != nil {
		t.Fatalf("resolve with component member: %v", err)
	}

	var strip *LayoutComponent
	for i := range layout.Components {
		if layout.Components[i].ComponentInstanceID == "opening-strip-tira" {
			strip = &layout.Components[i]
		}
	}
	if strip == nil {
		t.Fatalf("the strip board must publish as a component, got %d components", len(layout.Components))
	}
	// The gola band: full width [0, 600], front depth [580−40, 580], top [720−18, 720].
	if strip.Transform.TranslationMm != [3]float64{0, 540, 702} || strip.DimensionsMm != [3]float64{600, 40, 18} {
		t.Fatalf("strip board = min %v size %v, want [0 540 702] × [600 40 18]",
			strip.Transform.TranslationMm, strip.DimensionsMm)
	}
	// The door's material (FRENTE role) — color de puerta automático.
	if strip.MaterialID != "mat-frente" {
		t.Fatalf("strip must carry the FRENTE material (color de puerta), got %q", strip.MaterialID)
	}
}

func TestOpeningComponentMemberFailsClosedWhenComponentMissing(t *testing.T) {
	module, catalog := depthReductionGolaModule()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 580}
	_, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		openingMembers: componentMemberMods(),
	})
	if err == nil || !strings.Contains(err.Error(), "no existe o está inactivo") {
		t.Fatalf("a declared component missing from the catalog must fail closed, got %v", err)
	}
}

// The BOM mirror: the same board as a cut part — full width × declared
// depth, the FRENTE material role, untouched by the door depth reduction.
func TestOpeningComponentMemberJoinsBOMAsBoardPart(t *testing.T) {
	module, catalog := depthReductionGolaModule()
	catalog = golaItalianoCatalog(catalog)
	catalog.Modules = append(catalog.Modules, module)

	item := domain.DesignRevisionItem{
		DesignRevisionID:      "revision-strip",
		FurnitureInstanceID:   "unit-strip",
		FurnitureDefinitionID: module.ID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 580.0},
		MaterialChoices:       map[string]string{"LATERAL": "mat-frente", "INTERIOR": "mat-frente", "FRENTE": "mat-frente"},
	}
	resolution := ReleaseUnitOpening{
		Fronts: openingPassFront("top", 30),
		Modifiers: []ResolvedOpeningBodyModifier{{
			Effect: OpeningModifierEffectDepthReduction, Role: "horizontal",
			ProfileID: "profile.gola-it", Boundary: "top",
			DepthReductionMm: 30, ProfileHeightMm: 18,
		}},
		Members: &OpeningMembers{
			ComponentMembers: []OpeningComponentMember{{
				Key: "tira", ComponentID: "comp-tira-gola-it", DepthMm: 40, HeightMm: 18,
			}},
		},
	}
	dims := &domain.ItemCustomDims{WidthMm: 600, HeightMm: 720, DepthMm: 580}
	bom, err := ResolveBomForReleaseWithOpening(module, item.MaterialChoices, catalog, dims, nil, resolution.Fronts, resolution.Modifiers, resolution.Members)
	if err != nil {
		t.Fatalf("release BOM with strip member: %v", err)
	}

	var strip *domain.ResolvedBoardPart
	for i := range bom.BoardParts {
		if bom.BoardParts[i].ID == "opening-strip-tira" {
			strip = &bom.BoardParts[i]
		}
	}
	if strip == nil {
		t.Fatalf("the strip must join the cut list as a board part")
	}
	if strip.LengthMm != 600 || strip.WidthMm != 40 {
		t.Fatalf("strip cut = %g × %g, want 600 × 40 (full width × declared depth, no door-discount trim)", strip.LengthMm, strip.WidthMm)
	}
	if strip.OptionRole != "FRENTE" || strip.MaterialID != "mat-frente" {
		t.Fatalf("strip must resolve the FRENTE material (color de puerta), got %+v", strip)
	}
}
