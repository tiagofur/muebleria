package engine_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1493: paridad TS↔Go de las reglas de dimensión por variante sobre los
// componentes del agregado (BOM + tableros del layout). Autoridad única:
// contracts/fixtures/componentVariantRuleParity.contract.json — ambos lados
// CONSTRUYEN catálogo y receta desde el JSON. El espejo TS vive en
// packages/domain/src/componentVariantRuleParity.contract.test.ts.

type variantRuleFixture struct {
	Agregado struct {
		ID           string `json:"id"`
		Code         string `json:"code"`
		VariantSetID string `json:"variantSetId"`
	} `json:"agregado"`
	Variants []struct {
		HardwareID         string  `json:"hardwareId"`
		NominalDimensionMm float64 `json:"nominalDimensionMm"`
	} `json:"variants"`
	Components []struct {
		ID            string `json:"id"`
		Code          string `json:"code"`
		Name          string `json:"name"`
		LengthFormula string `json:"lengthFormula"`
		WidthFormula  string `json:"widthFormula"`
		InstanceOverrides *struct {
			WidthRule *struct {
				Source       string   `json:"source"`
				VariantSetID string   `json:"variantSetId"`
				Multiplier   *float64 `json:"multiplier"`
				OffsetMm     float64  `json:"offsetMm"`
			} `json:"widthRule"`
		} `json:"instanceOverrides"`
	} `json:"components"`
	Module struct {
		WidthMm  int `json:"widthMm"`
		HeightMm int `json:"heightMm"`
		DepthMm  int `json:"depthMm"`
	} `json:"module"`
	Bays []struct {
		ID            string `json:"id"`
		HeightFormula string `json:"heightFormula"`
	} `json:"bays"`
	ExpectedBoards map[string]map[string]struct {
		LengthMm float64 `json:"lengthMm"`
		WidthMm  float64 `json:"widthMm"`
	} `json:"expectedBoards"`
}

func loadVariantRuleFixture(t *testing.T) variantRuleFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "fixtures", "componentVariantRuleParity.contract.json"))
	if err != nil {
		t.Fatalf("failed reading shared contract: %v", err)
	}
	var f variantRuleFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("failed unmarshaling shared contract: %v", err)
	}
	return f
}

func TestComponentVariantRulePerBaySharedContract_1493(t *testing.T) {
	f := loadVariantRuleFixture(t)

	variants := make([]domain.ProductVariant, 0, len(f.Variants))
	for _, v := range f.Variants {
		variants = append(variants, domain.ProductVariant{
			HardwareID:         v.HardwareID,
			NominalDimensionMm: v.NominalDimensionMm,
		})
	}

	components := []domain.Component{}
	instances := []domain.ComponentInstance{}
	for _, c := range f.Components {
		components = append(components, domain.Component{
			ID: c.ID, Code: c.Code, Name: c.Name,
			Placement:    domain.PlacementInterno,
			GeometryKind: "rectangular_board",
			LengthMm:     500, WidthMm: 500, ThicknessMm: 15,
			LengthFormula: c.LengthFormula,
			WidthFormula:  c.WidthFormula,
			OptionRoles:  []string{"LATERAL"},
			Active:        true,
		})
		inst := domain.ComponentInstance{ComponentID: c.ID, Quantity: 1}
		if c.InstanceOverrides != nil && c.InstanceOverrides.WidthRule != nil {
			rule := c.InstanceOverrides.WidthRule
			inst.Overrides = &domain.ComponentInstanceOverrides{
				WidthRule: &domain.AssemblyDimensionRule{
					Source:       domain.DimensionRuleSource(rule.Source),
					VariantSetID: rule.VariantSetID,
					Multiplier:   rule.Multiplier,
					OffsetMm:     rule.OffsetMm,
				},
			}
		}
		instances = append(instances, inst)
	}

	agr := domain.Agregado{
		ID: f.Agregado.ID, Code: f.Agregado.Code, Name: f.Agregado.Code, Active: true,
		VariantSets: []domain.AgregadoVariantSet{
			{ID: f.Agregado.VariantSetID, Dimension: "height", Variants: variants},
		},
		Components: instances,
	}

	bayInstances := make([]domain.ModuleAgregadoInstance, 0, len(f.Bays))
	for _, bay := range f.Bays {
		bayInstances = append(bayInstances, domain.ModuleAgregadoInstance{
			ID: bay.ID, AgregadoID: agr.ID, Quantity: 1,
			Dimensions: &domain.AgregadoDimensions{HeightFormula: bay.HeightFormula},
		})
	}

	structure := domain.Structure{ID: "st-base", Code: "ST-BASE", Name: "Cuerpo", Active: true}
	mod := domain.Module{
		ID: "mod-cajonera", Code: "CAJONERA", Name: "Cajonera",
		StructureID: structure.ID,
		WidthMm:     f.Module.WidthMm, HeightMm: f.Module.HeightMm, DepthMm: f.Module.DepthMm,
		Agregados: bayInstances,
	}
	catalog := domain.Catalog{
		Structures: []domain.Structure{structure},
		Agregados:  []domain.Agregado{agr},
		Components: components,
		Materials: []domain.MaterialBoard{{
			ID: "mat-caja", Code: "MAT-CAJA", Name: "Caja cajón",
			WidthMm: 1830, LengthMm: 2440, ThicknessMm: 15,
			GrainDefault: true, BoardPrice: 100, WastePercent: 0, CostPerM2: 100,
			Active: true,
		}},
		OptionGroups: []domain.OptionGroup{
			{ID: "og-lateral", Code: "LATERAL", Name: "Lateral", Kind: "board", Required: true, OptionIDs: []string{"mat-caja"}},
		},
	}
	choices := map[string]string{"LATERAL": "mat-caja"}

	// --- BOM: la regla de la instancia MANDA sobre la fórmula constante, por bahía.
	bom, err := engine.ResolveBomWithContext(mod, choices, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("ResolveBomWithContext unexpected error: %v", err)
	}
	// Cada bahía es una INSTANCIA propia del agregado (quantity 1) — el id de
	// pieza lleva `instance-<bayID>-` (dos instancias del mismo agregado).
	bayOfID := func(id string) string {
		for _, bay := range f.Bays {
			if strings.Contains(id, "instance-"+bay.ID+"-") {
				return bay.ID
			}
		}
		return ""
	}
	gotBOM := map[string]map[string][2]float64{} // bay -> compID -> {length, width}
	for _, part := range bom.BoardParts {
		bay := bayOfID(part.ID)
		if bay == "" {
			continue
		}
		for _, c := range f.Components {
			if strings.Contains(part.ID, c.ID+"-copy-") {
				if gotBOM[bay] == nil {
					gotBOM[bay] = map[string][2]float64{}
				}
				gotBOM[bay][c.ID] = [2]float64{part.LengthMm, part.WidthMm}
			}
		}
	}
	for bay, comps := range f.ExpectedBoards {
		for compID, want := range comps {
			got, ok := gotBOM[bay][compID]
			if !ok {
				t.Fatalf("BOM: falta %s de la bahía %s (visto %v)", compID, bay, gotBOM)
			}
			if got[0] != want.LengthMm || got[1] != want.WidthMm {
				t.Errorf("BOM %s/%s = %gx%g, want %gx%g — la regla por variante debe mandar sobre la fórmula", bay, compID, got[0], got[1], want.LengthMm, want.WidthMm)
			}
		}
	}

	// --- Layout: los tableros dibujados por bahía también siguen la regla.
	layout, err := engine.ResolveFurnitureLayout(mod, catalog, nil, choices)
	if err != nil {
		t.Fatalf("ResolveFurnitureLayout unexpected error: %v", err)
	}
	seen := map[string]bool{}
	for _, c := range layout.Components {
		bay := bayOfID(c.ComponentInstanceID)
		if bay == "" {
			continue
		}
		for compID, want := range f.ExpectedBoards[bay] {
			if strings.Contains(c.ComponentInstanceID, compID) &&
				hasDim(c.DimensionsMm, want.WidthMm) && hasDim(c.DimensionsMm, want.LengthMm) {
				seen[bay+"/"+compID] = true
			}
		}
	}
	for bay, comps := range f.ExpectedBoards {
		for compID := range comps {
			if !seen[bay+"/"+compID] {
				t.Errorf("layout: la bahía %s no dibuja %s con las dims esperadas (visto %v)", bay, compID, seen)
			}
		}
	}
}

func hasDim(dims [3]float64, want float64) bool {
	for _, d := range dims {
		if float64(d) == want {
			return true
		}
	}
	return false
}
