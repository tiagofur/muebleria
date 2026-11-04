package engine_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1493: kit comercial por variante. Una altura Blum MERIVOBOX N/M/K/E es un
// kit distinto (la E cacerolera lleva galería), así que la variante puede
// declarar su propio commercialKitHardwareId y el resolve lo usa en el BOM.

// buildHeightKitFixture construye un agregado con variant set de ALTURA
// N/M/K/E donde cada variante declara su kit. La trasera usa la regla
// selected_variant − 25 (60.5/83/121/184 mm reales del catálogo Blum).
func buildHeightKitFixture(agregadoKitID *string, variantKits map[float64]string) domain.Agregado {
	nominals := []float64{85.5, 108.0, 146.0, 209.0}
	codes := map[float64]string{85.5: "N", 108.0: "M", 146.0: "K", 209.0: "E"}
	variants := make([]domain.ProductVariant, 0, len(nominals))
	for _, n := range nominals {
		v := domain.ProductVariant{NominalDimensionMm: n, HardwareID: "hw-mbox-" + strings.ToLower(codes[n])}
		if kit, ok := variantKits[n]; ok {
			v.CommercialKitHardwareID = kit
		}
		variants = append(variants, v)
	}

	return domain.Agregado{
		ID:                      "agr-merivobox-alturas",
		Code:                    "MERIVOBOX-ALTURAS",
		Name:                    "MERIVOBOX por altura",
		CommercialKitHardwareID: agregadoKitID,
		VariantSets: []domain.AgregadoVariantSet{
			{ID: "height-variants", Dimension: "height", Variants: variants},
		},
		RigidMembers: []domain.AgregadoRigidMember{
			{
				MemberID: "side-left",
				Role:     "drawer_side_left",
				Source: domain.RigidMemberSource{
					Kind:    domain.RigidMemberSourceVariant,
					Variant: &domain.VariantHardwareSource{VariantSetID: "height-variants"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				},
				BOMRole: domain.BOMRoleIncludedInKit,
			},
			{
				MemberID: "side-right",
				Role:     "drawer_side_right",
				Source: domain.RigidMemberSource{
					Kind:    domain.RigidMemberSourceVariant,
					Variant: &domain.VariantHardwareSource{VariantSetID: "height-variants"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMax},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				},
				BOMRole: domain.BOMRoleIncludedInKit,
			},
		},
		Components: []domain.ComponentInstance{
			{
				ComponentID: "comp-back",
				Quantity:    1,
				Overrides: &domain.ComponentInstanceOverrides{
					WidthRule: &domain.AssemblyDimensionRule{
						Source:   domain.DimRuleAssemblyWidth,
						OffsetMm: -58.0,
					},
					LengthRule: &domain.AssemblyDimensionRule{
						Source:       domain.DimRuleSelectedVariant,
						VariantSetID: "height-variants",
						OffsetMm:     -25.0, // KH mín − 25 = altura de trasera Blum
					},
					PlacementRule: &domain.AssemblyAnchorRule{
						X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 29.0},
						Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMax, OffsetMm: -16.0},
						Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 32.0},
					},
				},
			},
		},
	}
}

func kitPtr(s string) *string { return &s }

func TestVariantKit_KitComercialPorVariante_1493(t *testing.T) {
	variantKits := map[float64]string{
		85.5:  "kit-mbox-n",
		108.0: "kit-mbox-m",
		146.0: "kit-mbox-k",
		209.0: "kit-mbox-e",
	}
	fixture := buildHeightKitFixture(nil, variantKits)

	resolve := func(heightMm float64) (domain.ResolvedAssembly, error) {
		return engine.ResolveAgregadoAssembly(fixture, engine.AssemblyResolutionParams{
			WidthMm: 570.0, DepthMm: 530.0, HeightMm: heightMm,
		})
	}

	t.Run("la variante seleccionada aporta el kit del BOM", func(t *testing.T) {
		cases := []struct {
			spaceMm  float64
			wantKit  string
			wantBack float64
		}{
			{85.5, "kit-mbox-n", 60.5},
			{108.0, "kit-mbox-m", 83.0},
			{146.0, "kit-mbox-k", 121.0},
			{209.0, "kit-mbox-e", 184.0},
		}
		for _, tc := range cases {
			res, err := resolve(tc.spaceMm)
			if err != nil {
				t.Fatalf("space %g: unexpected error: %v", tc.spaceMm, err)
			}
			if res.CommercialKitHardwareID == nil || *res.CommercialKitHardwareID != tc.wantKit {
				t.Errorf("space %g: expected kit %s, got %v", tc.spaceMm, tc.wantKit, res.CommercialKitHardwareID)
			}
			kitRows := 0
			for _, item := range res.BOMItems {
				if item.Role == "commercial_kit" {
					kitRows++
					if item.HardwareID != tc.wantKit {
						t.Errorf("space %g: BOM kit row = %s, want %s", tc.spaceMm, item.HardwareID, tc.wantKit)
					}
				}
			}
			if kitRows != 1 {
				t.Errorf("space %g: expected exactly 1 commercial_kit row, got %d", tc.spaceMm, kitRows)
			}
			// Trasera Blum real: KH mín − 25.
			var back domain.ResolvedFabricatedComponent
			for _, c := range res.FabricatedComponents {
				if c.ComponentID == "comp-back" {
					back = c
				}
			}
			if back.LengthMm != tc.wantBack {
				t.Errorf("space %g: back length = %g, want %g (KH mín − 25)", tc.spaceMm, back.LengthMm, tc.wantBack)
			}
		}
	})

	t.Run("max_fitting elige la altura más alta que cabe", func(t *testing.T) {
		// Bahía de 200mm alcanza K (146) pero no E (209).
		res, err := resolve(200.0)
		if err != nil {
			t.Fatal(err)
		}
		if res.SelectedVariants[0].NominalDimensionMm != 146.0 {
			t.Errorf("expected K (146.0) in a 200mm bay, got %v", res.SelectedVariants)
		}
		// Bahía insuficiente incluso para N → fail-closed.
		_, err = resolve(85.0)
		var variantErr *domain.ErrAssemblyVariantNotFound
		if !errors.As(err, &variantErr) {
			t.Errorf("expected *domain.ErrAssemblyVariantNotFound at 85.0mm, got %v", err)
		}
	})

	t.Run("fallback al kit del agregado cuando la variante no declara (legacy idéntico)", func(t *testing.T) {
		legacy := buildHeightKitFixture(kitPtr("kit-mbox-m"), map[float64]string{})
		res, err := engine.ResolveAgregadoAssembly(legacy, engine.AssemblyResolutionParams{
			WidthMm: 570.0, DepthMm: 530.0, HeightMm: 300.0,
		})
		if err != nil {
			t.Fatal(err)
		}
		if res.CommercialKitHardwareID == nil || *res.CommercialKitHardwareID != "kit-mbox-m" {
			t.Errorf("expected agregado-level kit fallback kit-mbox-m, got %v", res.CommercialKitHardwareID)
		}
		for _, item := range res.BOMItems {
			if item.Role == "commercial_kit" && item.HardwareID != "kit-mbox-m" {
				t.Errorf("BOM kit row = %s, want kit-mbox-m", item.HardwareID)
			}
		}
	})

	t.Run("dos kits declarados entre las variantes seleccionadas es ambiguo y falla cerrado", func(t *testing.T) {
		// Todas las variantes de altura declaran kit-mbox-agr y la variante de
		// ancho seleccionada declara kit-mbox-otro: dos kits DECLARADOS entre
		// las variantes seleccionadas → ambigüedad (el fallback del agregado
		// no es una declaración y no participa).
		allHeights := map[float64]string{85.5: "kit-mbox-agr", 108.0: "kit-mbox-agr", 146.0: "kit-mbox-agr", 209.0: "kit-mbox-agr"}
		ambiguous := buildHeightKitFixture(nil, allHeights)
		ambiguous.VariantSets = append(ambiguous.VariantSets, domain.AgregadoVariantSet{
			ID:        "width-variants",
			Dimension: "width",
			Variants: []domain.ProductVariant{
				{NominalDimensionMm: 500.0, HardwareID: "hw-mbox-w500", CommercialKitHardwareID: "kit-mbox-otro"},
			},
		})
		_, err := engine.ResolveAgregadoAssembly(ambiguous, engine.AssemblyResolutionParams{
			WidthMm: 570.0, DepthMm: 530.0, HeightMm: 300.0,
		})
		if err == nil {
			t.Fatal("expected ambiguous-kit error, got nil")
		}
		if !strings.Contains(err.Error(), "ambiguous commercial kit") ||
			!strings.Contains(err.Error(), "kit-mbox-agr") || !strings.Contains(err.Error(), "kit-mbox-otro") {
			t.Errorf("ambiguity error must name both kits, got: %v", err)
		}
	})

	t.Run("included_in_kit sin kit efectivo falla cerrado en resolve", func(t *testing.T) {
		// La variante N declara kit pero la seleccionada (M) no; el agregado
		// tampoco. La definición valida (alguna variante declara kit), pero el
		// resolve de M no tiene kit efectivo → error, nunca BOM mudo.
		partial := buildHeightKitFixture(nil, map[float64]string{85.5: "kit-mbox-n"})
		_, err := engine.ResolveAgregadoAssembly(partial, engine.AssemblyResolutionParams{
			WidthMm: 570.0, DepthMm: 530.0, HeightMm: 300.0,
		})
		if err == nil {
			t.Fatal("expected included_in_kit-without-effective-kit error, got nil")
		}
		if !strings.Contains(err.Error(), "no effective commercial kit") {
			t.Errorf("unexpected error: %v", err)
		}
	})
}

func TestVariantKit_ValidacionDefinicion_1493(t *testing.T) {
	t.Run("included_in_kit es válido con kits de variante aunque el agregado no declare", func(t *testing.T) {
		agg := buildHeightKitFixture(nil, map[float64]string{85.5: "kit-mbox-n"})
		if err := domain.ValidateAgregadoAssemblyDefinition(agg); err != nil {
			t.Fatalf("variant-declared kit must satisfy included_in_kit members: %v", err)
		}
	})

	t.Run("sin kit en ningún nivel la definición sigue rechazando included_in_kit", func(t *testing.T) {
		agg := buildHeightKitFixture(nil, map[float64]string{})
		if err := domain.ValidateAgregadoAssemblyDefinition(agg); err == nil {
			t.Fatal("expected included_in_kit validation error with no kit anywhere")
		}
	})

	t.Run("commercialKitHardwareId de variante whitespace-only se rechaza", func(t *testing.T) {
		agg := buildHeightKitFixture(kitPtr("kit-mbox-m"), map[float64]string{85.5: "   "})
		err := domain.ValidateAgregadoAssemblyDefinition(agg)
		if err == nil || !strings.Contains(err.Error(), "commercialKitHardwareId cannot be whitespace") {
			t.Errorf("expected whitespace kit rejection, got %v", err)
		}
	})
}

func TestEffectiveKitHardwareID_1493(t *testing.T) {
	agg := buildHeightKitFixture(kitPtr("kit-mbox-agr"), map[float64]string{
		85.5:  "kit-mbox-n",
		209.0: "kit-mbox-e",
	})

	t.Run("kit declarado en la variante seleccionada gana", func(t *testing.T) {
		kit, err := engine.EffectiveKitHardwareID(agg, []domain.SelectedAssemblyVariant{
			{VariantSetID: "height-variants", HardwareID: "hw-mbox-n", NominalDimensionMm: 85.5},
		})
		if err != nil || kit != "kit-mbox-n" {
			t.Errorf("expected kit-mbox-n, got %q err %v", kit, err)
		}
	})

	t.Run("variante seleccionada sin declaración cae al kit del agregado", func(t *testing.T) {
		kit, err := engine.EffectiveKitHardwareID(agg, []domain.SelectedAssemblyVariant{
			{VariantSetID: "height-variants", HardwareID: "hw-mbox-k", NominalDimensionMm: 146.0},
		})
		if err != nil || kit != "kit-mbox-agr" {
			t.Errorf("expected fallback kit-mbox-agr, got %q err %v", kit, err)
		}
	})

	t.Run("kit de variante NO seleccionada se ignora", func(t *testing.T) {
		kit, err := engine.EffectiveKitHardwareID(agg, []domain.SelectedAssemblyVariant{
			{VariantSetID: "height-variants", HardwareID: "hw-mbox-m", NominalDimensionMm: 108.0},
		})
		if err != nil || kit != "kit-mbox-agr" {
			t.Errorf("unselected variant kit must be ignored, got %q err %v", kit, err)
		}
	})
}
