package engine_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1493: alturas Blum MERIVOBOX N/M/K/E. Autoridad numérica única: la sección
// `heights` de contracts/fixtures/merivobox-pilot-canonical.json — Go, TS y la
// UI resuelven contra ESTOS valores. Nominal de variante = KH mín (clearance
// 0); trasera = selected_variant − 25. La altura E lleva su propio kit con
// galería; el sync de partes del kit corre POR BAHÍA en el layout, así que la
// galería sólo aparece en la unidad que resolvió E.

type heightsNominal struct {
	Code              string   `json:"code"`
	KhMinMm           float64  `json:"khMinMm"`
	HardwareID        string   `json:"hardwareId"`
	KitHardwareID     string   `json:"kitHardwareId"`
	BackMm            float64  `json:"backMm"`
	KitExtraPartCodes []string `json:"kitExtraPartCodes"`
}

type heightsContract struct {
	VariantSetID string           `json:"variantSetId"`
	ClearanceMm  float64          `json:"clearanceMm"`
	BackOffsetMm float64          `json:"backOffsetMm"`
	Nominals     []heightsNominal `json:"nominals"`
	Boundaries   []struct {
		SpaceMm  float64 `json:"spaceMm"`
		Expected string  `json:"expected"`
	} `json:"boundaries"`
	ModuleThreeDrawers struct {
		ModuleHeightMm         float64   `json:"moduleHeightMm"`
		ExpectedByBay          []string  `json:"expectedByBay"`
		ExpectedKitByBay       []string  `json:"expectedKitByBay"`
		ExpectedBackByBay      []float64 `json:"expectedBackByBay"`
		GaleriaMemberOnlyInBay int       `json:"galeriaMemberOnlyInBay"`
	} `json:"moduleThreeDrawers"`
}

func loadHeightsContract(t *testing.T) heightsContract {
	t.Helper()
	raw, err := os.ReadFile(canonicalFixturePath)
	if err != nil {
		t.Fatalf("read canonical fixture: %v", err)
	}
	var full struct {
		Heights heightsContract `json:"heights"`
	}
	if err := json.Unmarshal(raw, &full); err != nil {
		t.Fatalf("unmarshal canonical fixture: %v", err)
	}
	if len(full.Heights.Nominals) != 4 {
		t.Fatalf("expected 4 height nominals (N/M/K/E), got %d", len(full.Heights.Nominals))
	}
	return full.Heights
}

// buildHeightsAgregadoFromContract construye la receta desde el JSON — ningún
// número de altura vive duplicado en el test.
func buildHeightsAgregadoFromContract(c heightsContract) domain.Agregado {
	variants := make([]domain.ProductVariant, 0, len(c.Nominals))
	for _, n := range c.Nominals {
		variants = append(variants, domain.ProductVariant{
			NominalDimensionMm:      n.KhMinMm,
			HardwareID:              n.HardwareID,
			CommercialKitHardwareID: n.KitHardwareID,
		})
	}
	member := func(id, role string, xRef domain.AssemblyAxisRef) domain.AgregadoRigidMember {
		return domain.AgregadoRigidMember{
			MemberID: id,
			Role:     role,
			Source: domain.RigidMemberSource{
				Kind:    domain.RigidMemberSourceVariant,
				Variant: &domain.VariantHardwareSource{VariantSetID: c.VariantSetID},
			},
			Placement: domain.AssemblyAnchorRule{
				X: domain.AssemblyAxisPlacement{Ref: xRef},
				Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			},
			BOMRole: domain.BOMRoleIncludedInKit,
		}
	}
	return domain.Agregado{
		ID:   "agr-merivobox-alturas",
		Code: "MERIVOBOX-ALTURAS",
		Name: "MERIVOBOX por altura (#1493)",
		VariantSets: []domain.AgregadoVariantSet{
			{ID: c.VariantSetID, Dimension: "height", Variants: variants},
		},
		CompatibilityRules: []domain.AssemblyCompatibilityRule{
			{VariantSetID: c.VariantSetID, ClearanceMm: c.ClearanceMm, SelectionStrategy: "max_fitting"},
		},
		RigidMembers: []domain.AgregadoRigidMember{
			member("side-left", "drawer_side_left", domain.AxisRefMin),
			member("side-right", "drawer_side_right", domain.AxisRefMax),
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
						VariantSetID: c.VariantSetID,
						OffsetMm:     c.BackOffsetMm,
					},
				},
			},
		},
	}
}

func TestMerivoboxHeightsCanonicalContract_1493(t *testing.T) {
	c := loadHeightsContract(t)
	agg := buildHeightsAgregadoFromContract(c)
	codeByKh := map[float64]string{}
	backByKh := map[float64]float64{}
	for _, n := range c.Nominals {
		codeByKh[n.KhMinMm] = n.Code
		backByKh[n.KhMinMm] = n.BackMm
	}

	t.Run("boundaries: máxima que cabe, fail-closed bajo N, trasera KH−25", func(t *testing.T) {
		for _, b := range c.Boundaries {
			res, err := engine.ResolveAgregadoAssembly(agg, engine.AssemblyResolutionParams{
				WidthMm: 570.0, DepthMm: 530.0, HeightMm: b.SpaceMm,
			})
			if b.Expected == "rejected" {
				if err == nil {
					t.Fatalf("space %g: expected rejection, got selection %v", b.SpaceMm, res.SelectedVariants)
				}
				continue
			}
			if err != nil {
				t.Fatalf("space %g: unexpected error: %v", b.SpaceMm, err)
			}
			got := res.SelectedVariants[0].NominalDimensionMm
			wantKh, ok := codeByKhInverse(c, b.Expected)
			if !ok {
				t.Fatalf("boundary %s: código desconocido", b.Expected)
			}
			if got != wantKh {
				t.Errorf("space %g: expected %s (KH %g), got nominal %g", b.SpaceMm, b.Expected, wantKh, got)
			}
			// Trasera Blum real: KH mín − 25, contra el backMm del contrato.
			var back domain.ResolvedFabricatedComponent
			for _, fc := range res.FabricatedComponents {
				if fc.ComponentID == "comp-back" {
					back = fc
				}
			}
			if back.LengthMm != backByKh[wantKh] {
				t.Errorf("space %g (%s): back = %g, want %g", b.SpaceMm, b.Expected, back.LengthMm, backByKh[wantKh])
			}
			// El kit del BOM es el de la variante.
			if res.CommercialKitHardwareID == nil || *res.CommercialKitHardwareID != kitByCode(c, b.Expected) {
				t.Errorf("space %g: kit = %v, want %s", b.SpaceMm, res.CommercialKitHardwareID, kitByCode(c, b.Expected))
			}
		}
	})
}

func codeByKhInverse(c heightsContract, code string) (float64, bool) {
	for _, n := range c.Nominals {
		if n.Code == code {
			return n.KhMinMm, true
		}
	}
	return 0, false
}

func kitByCode(c heightsContract, code string) string {
	for _, n := range c.Nominals {
		if n.Code == code {
			return n.KitHardwareID
		}
	}
	return ""
}

// TestMerivoboxHeightsPerBayKitSync_1493: cajonera 3 cajones (½ abajo, 2×¼
// arriba) — cada bahía resuelve SU altura y SU kit; la galería del kit-E sólo
// se materializa como miembro en la bahía que resolvió E.
func TestMerivoboxHeightsPerBayKitSync_1493(t *testing.T) {
	c := loadHeightsContract(t)
	agg := buildHeightsAgregadoFromContract(c)

	catalog := domain.Catalog{}
	catalog.Agregados = append(catalog.Agregados, agg)

	// Partes de kit por altura: el kit-E lleva su galería (#1493).
	for _, n := range c.Nominals {
		partCodes := append([]string{"KIT-MBX-" + n.Code + "-PARTE"}, n.KitExtraPartCodes...)
		for _, code := range partCodes {
			catalog.Hardware = append(catalog.Hardware, domain.Hardware{
				ID:            "hw-" + code,
				Code:          code,
				Name:          code,
				Active:        true,
				KitHardwareID: strPtr(n.KitHardwareID),
			})
		}
	}

	edges := []domain.EdgeAssignment{{Side: "L1"}, {Side: "L2"}, {Side: "W1"}, {Side: "W2"}}
	module := domain.Module{
		ID: "mod-cajonera-3", Code: "CAJONERA-3", Name: "Cajonera 3 cajones MERIVOBOX",
		WidthMm: 600, HeightMm: int(c.ModuleThreeDrawers.ModuleHeightMm), DepthMm: 500,
		BoardParts: []domain.BoardPart{
			{ID: "p-lat-izq", Description: "Lateral Izq", Quantity: 1, LengthMm: 542, WidthMm: 500, OptionRole: "LATERAL", Edges: edges},
			{ID: "p-lat-der", Description: "Lateral Der", Quantity: 1, LengthMm: 542, WidthMm: 500, OptionRole: "LATERAL", Edges: edges},
		},
		Agregados: []domain.ModuleAgregadoInstance{
			{
				ID: "agr-inst-bajo", AgregadoID: agg.ID, Quantity: 1,
				Dimensions: &domain.AgregadoDimensions{HeightFormula: "PH * 0.5"},
			},
			{
				ID: "agr-inst-alto", AgregadoID: agg.ID, Quantity: 2, LayoutDirection: "vertical",
				Position:   &domain.AgregadoPosition{ZFormula: "PH * 0.5"},
				Dimensions: &domain.AgregadoDimensions{HeightFormula: "PH * 0.5"},
			},
		},
	}

	layout, err := engine.ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}

	if len(layout.Assemblies) != 3 {
		t.Fatalf("expected 3 bay assemblies, got %d", len(layout.Assemblies))
	}

	// Orden de bahías por traslación Z del placement (bajo→alto).
	ordered := append([]engine.LayoutAssembly{}, layout.Assemblies...)
	for i := 1; i < len(ordered); i++ {
		for j := i; j > 0 && ordered[j].Placement["translation"].([]float64)[2] < ordered[j-1].Placement["translation"].([]float64)[2]; j-- {
			ordered[j], ordered[j-1] = ordered[j-1], ordered[j]
		}
	}

	galeriaBay := c.ModuleThreeDrawers.GaleriaMemberOnlyInBay
	for bay, asy := range ordered {
		wantCode := c.ModuleThreeDrawers.ExpectedByBay[bay]
		wantHw := ""
		for _, n := range c.Nominals {
			if n.Code == wantCode {
				wantHw = n.HardwareID
			}
		}
		memberHws := map[string]int{}
		for _, rm := range asy.RigidMembers {
			memberHws[rm.HardwareID]++
		}
		if memberHws[wantHw] != 2 {
			t.Errorf("bay %d (z=%g): expected 2 members of %s (%s), got %v",
				bay, ordered[bay].Placement["translation"].([]float64)[2], wantHw, wantCode, memberHws)
		}
		// Kit-part de la altura resuelta presente; partes de OTRO kit ausentes.
		for _, n := range c.Nominals {
			partHw := "hw-KIT-MBX-" + n.Code + "-PARTE"
			inThisBay := n.Code == wantCode
			if got := memberHws[partHw] > 0; got != inThisBay {
				t.Errorf("bay %d (%s): kit part %s present=%v, want %v", bay, wantCode, partHw, got, inThisBay)
			}
		}
		// La galería del kit-E sólo en su bahía.
		for _, n := range c.Nominals {
			for _, extra := range n.KitExtraPartCodes {
				extraHw := "hw-" + extra
				_, present := memberHws[extraHw]
				if bay == galeriaBay && !present {
					t.Errorf("bay %d: expected galería %s in the E bay", bay, extraHw)
				}
			if bay != galeriaBay && present {
				t.Errorf("bay %d (%s): galería %s must not appear outside the E bay", bay, wantCode, extraHw)
			}
		}
	}
}

}

func strPtr(s string) *string { return &s }
