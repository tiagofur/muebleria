package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1496 — contract de paridad TS/Go del tipo de mueble panel (eje del
// espesor derivado del material FRENTE). Consume el MISMO
// contracts/panelThicknessParity.contract.json que
// packages/domain/src/panelThicknessParity.contract.test.ts. El fixture
// viaja en camelCase (forma TS); los DTOs pt* lo mapean a dominio Go.
// Regla: si un motor diverge, se alinea el motor — nunca el expected.

type ptDims struct {
	Width  int `json:"width"`
	Height int `json:"height"`
	Depth  int `json:"depth"`
}

type ptMaterial struct {
	ID                string  `json:"id"`
	Code              string  `json:"code"`
	Name              string  `json:"name"`
	WidthMm           int     `json:"widthMm"`
	LengthMm          int     `json:"lengthMm"`
	ThicknessMm       int     `json:"thicknessMm"`
	GrainDefault      bool    `json:"grainDefault"`
	BoardPrice        float64 `json:"boardPrice"`
	WastePercent      float64 `json:"wastePercent"`
	CostPerM2         float64 `json:"costPerM2"`
	DefaultEdgeBandID string  `json:"defaultEdgeBandId"`
	Active            bool    `json:"active"`
}

type ptEdgeBand struct {
	ID        string  `json:"id"`
	Code      string  `json:"code"`
	Name      string  `json:"name"`
	CostPerMl float64 `json:"costPerMl"`
	Active    bool    `json:"active"`
}

type ptOptionGroup struct {
	ID        string   `json:"id"`
	Code      string   `json:"code"`
	Name      string   `json:"name"`
	Kind      string   `json:"kind"`
	Required  bool     `json:"required"`
	OptionIDs []string `json:"optionIds"`
}

type ptEdge struct {
	Side    string `json:"side"`
	Enabled bool   `json:"enabled"`
}

type ptGeometry struct {
	Kind          string `json:"kind"`
	LengthMm      int    `json:"lengthMm"`
	WidthMm       int    `json:"widthMm"`
	ThicknessMm   int    `json:"thicknessMm"`
	LengthFormula string `json:"lengthFormula"`
	WidthFormula  string `json:"widthFormula"`
}

type ptComponent struct {
	ID           string     `json:"id"`
	Code         string     `json:"code"`
	Name         string     `json:"name"`
	Placement    string     `json:"placement"`
	Geometry     ptGeometry `json:"geometry"`
	DefaultEdges []ptEdge   `json:"defaultEdges"`
	OptionRoles  []string   `json:"optionRoles"`
	Active       bool       `json:"active"`
}

type ptInstance struct {
	ComponentID string `json:"componentId"`
	Quantity    int    `json:"quantity"`
}

type ptStructure struct {
	ID           string       `json:"id"`
	Code         string       `json:"code"`
	Name         string       `json:"name"`
	ExternalDims ptDims       `json:"externalDims"`
	Components   []ptInstance `json:"components"`
	Active       bool         `json:"active"`
}

type ptModule struct {
	ID                string       `json:"id"`
	Code              string       `json:"code"`
	Name              string       `json:"name"`
	StructureID       string       `json:"structureId"`
	FurnitureType     string       `json:"furnitureType"`
	PanelThicknessDim string       `json:"panelThicknessDim"`
	BaseMode          string       `json:"baseMode"`
	ExternalDims      ptDims       `json:"externalDims"`
	Components        []ptInstance `json:"components"`
	Active            bool         `json:"active"`
}

type ptCatalog struct {
	Materials    []ptMaterial    `json:"materials"`
	Edges        []ptEdgeBand    `json:"edges"`
	OptionGroups []ptOptionGroup `json:"optionGroups"`
	Structures   []ptStructure   `json:"structures"`
	Components   []ptComponent   `json:"components"`
	Modules      []ptModule      `json:"modules"`
}

type ptExpectedPart struct {
	Description string   `json:"description"`
	LengthMm    float64  `json:"lengthMm"`
	WidthMm     float64  `json:"widthMm"`
	Quantity    int      `json:"quantity"`
	OptionRole  string   `json:"optionRole"`
	Edges       []string `json:"edges"`
	MaterialID  string   `json:"materialId"`
}

type ptScenario struct {
	ID                    string            `json:"id"`
	Description           string            `json:"description"`
	ModuleID              string            `json:"moduleId"`
	OptionChoicesOverride map[string]string `json:"optionChoicesOverride"`
	Expected              struct {
		Parts    []ptExpectedPart `json:"parts"`
		Hardware []struct{}       `json:"hardware"`
	} `json:"expected"`
}

type panelFixture struct {
	Catalog   ptCatalog    `json:"catalog"`
	Scenarios []ptScenario `json:"scenarios"`
}

func (f *panelFixture) toDomainCatalog() domain.Catalog {
	c := domain.Catalog{}
	for _, m := range f.Catalog.Materials {
		c.Materials = append(c.Materials, domain.MaterialBoard{
			ID: m.ID, Code: m.Code, Name: m.Name,
			WidthMm: m.WidthMm, LengthMm: m.LengthMm, ThicknessMm: m.ThicknessMm,
			GrainDefault: m.GrainDefault, BoardPrice: m.BoardPrice,
			WastePercent: m.WastePercent, CostPerM2: m.CostPerM2,
			DefaultEdgeBandID: m.DefaultEdgeBandID, Active: m.Active,
		})
	}
	for _, e := range f.Catalog.Edges {
		c.Edges = append(c.Edges, domain.EdgeBand{
			ID: e.ID, Code: e.Code, Name: e.Name, CostPerMl: e.CostPerMl, Active: e.Active,
		})
	}
	for _, g := range f.Catalog.OptionGroups {
		c.OptionGroups = append(c.OptionGroups, domain.OptionGroup{
			ID: g.ID, Code: g.Code, Name: g.Name, Kind: g.Kind,
			Required: g.Required, OptionIDs: g.OptionIDs,
		})
	}
	for _, s := range f.Catalog.Structures {
		c.Structures = append(c.Structures, domain.Structure{
			ID: s.ID, Code: s.Code, Name: s.Name, Active: s.Active,
			WidthMm: s.ExternalDims.Width, HeightMm: s.ExternalDims.Height, DepthMm: s.ExternalDims.Depth,
		})
		for _, i := range s.Components {
			c.Structures[len(c.Structures)-1].Components = append(
				c.Structures[len(c.Structures)-1].Components,
				domain.ComponentInstance{ComponentID: i.ComponentID, Quantity: i.Quantity},
			)
		}
	}
	for _, comp := range f.Catalog.Components {
		edges := make([]domain.EdgeAssignment, 0, len(comp.DefaultEdges))
		for _, e := range comp.DefaultEdges {
			edges = append(edges, domain.EdgeAssignment{Side: e.Side, Enabled: e.Enabled})
		}
		c.Components = append(c.Components, domain.Component{
			ID: comp.ID, Code: comp.Code, Name: comp.Name,
			Placement:    domain.ComponentPlacement(comp.Placement),
			GeometryKind: comp.Geometry.Kind,
			LengthMm:     comp.Geometry.LengthMm, WidthMm: comp.Geometry.WidthMm,
			ThicknessMm:  comp.Geometry.ThicknessMm,
			DefaultEdges: edges,
			OptionRoles:  comp.OptionRoles, Active: comp.Active,
			LengthFormula: comp.Geometry.LengthFormula,
			WidthFormula:  comp.Geometry.WidthFormula,
		})
	}
	for _, m := range f.Catalog.Modules {
		mod := domain.Module{
			ID: m.ID, Code: m.Code, Name: m.Name,
			StructureID:       m.StructureID,
			FurnitureType:     m.FurnitureType,
			PanelThicknessDim: m.PanelThicknessDim,
			BaseMode:          m.BaseMode,
			WidthMm:           m.ExternalDims.Width, HeightMm: m.ExternalDims.Height, DepthMm: m.ExternalDims.Depth,
		}
		for _, i := range m.Components {
			mod.Components = append(mod.Components, domain.ComponentInstance{ComponentID: i.ComponentID, Quantity: i.Quantity})
		}
		c.Modules = append(c.Modules, mod)
	}
	return c
}

func loadPanelFixture(t *testing.T) *panelFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "panelThicknessParity.contract.json"))
	if err != nil {
		t.Fatalf("reading panelThicknessParity contract: %v", err)
	}
	var fx panelFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatalf("parsing panelThicknessParity contract: %v", err)
	}
	if len(fx.Scenarios) < 4 {
		t.Fatalf("panelThicknessParity contract must carry its scenarios (got %d)", len(fx.Scenarios))
	}
	return &fx
}

func ptEnabledEdges(edges []domain.EdgeAssignment) string {
	keys := make([]string, 0, len(edges))
	for _, e := range edges {
		if e.Enabled {
			keys = append(keys, e.Side)
		}
	}
	sortStrings := append([]string(nil), keys...)
	for i := 0; i < len(sortStrings); i++ {
		for j := i + 1; j < len(sortStrings); j++ {
			if sortStrings[j] < sortStrings[i] {
				sortStrings[i], sortStrings[j] = sortStrings[j], sortStrings[i]
			}
		}
	}
	return strings.Join(sortStrings, ",")
}

func ptPartMatches(part domain.ResolvedBoardPart, exp ptExpectedPart) bool {
	return part.Description == exp.Description &&
		part.LengthMm == exp.LengthMm &&
		part.WidthMm == exp.WidthMm &&
		part.OptionRole == exp.OptionRole &&
		ptEnabledEdges(part.Edges) == strings.Join(sortedCopy(exp.Edges), ",") &&
		part.MaterialID == exp.MaterialID
}

func sortedCopy(in []string) []string {
	out := append([]string(nil), in...)
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j] < out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

func TestPanelThicknessParity_SharedContract(t *testing.T) {
	fx := loadPanelFixture(t)
	catalog := fx.toDomainCatalog()

	for _, sc := range fx.Scenarios {
		sc := sc
		t.Run(sc.ID, func(t *testing.T) {
			var module domain.Module
			foundModule := false
			for _, m := range catalog.Modules {
				if m.ID == sc.ModuleID {
					module = m
					foundModule = true
					break
				}
			}
			if !foundModule {
				t.Fatalf("scenario %s: module %q not in fixture", sc.ID, sc.ModuleID)
			}

			// optionChoicesOverride ES la elección completa del ítem (el
			// fixture no mezcla defaults: cada scenario declara lo que
			// quiere probar, incluida la ausencia de FRENTE).
			choices := map[string]string{}
			for k, v := range sc.OptionChoicesOverride {
				choices[k] = v
			}

			bom, err := ResolveBom(module, choices, catalog)
			if err != nil {
				t.Fatalf("%s: resolve: %v", sc.ID, err)
			}

			actualParts := append([]domain.ResolvedBoardPart(nil), bom.BoardParts...)
			for _, exp := range sc.Expected.Parts {
				exp := exp
				for i := 0; i < exp.Quantity; i++ {
					matched := false
					for idx, p := range actualParts {
						if ptPartMatches(p, exp) {
							actualParts = append(actualParts[:idx], actualParts[idx+1:]...)
							matched = true
							break
						}
					}
					if !matched {
						t.Fatalf("%s: parte expected %s %v×%v no encontrada (restante: %+v)",
							sc.ID, exp.Description, exp.LengthMm, exp.WidthMm, actualParts)
					}
				}
			}
			if len(actualParts) != 0 {
				t.Fatalf("%s: partes no esperadas en el BOM: %+v", sc.ID, actualParts)
			}
			if len(bom.HardwareLines) != 0 {
				t.Fatalf("%s: herrajes no esperados en el BOM: %+v", sc.ID, bom.HardwareLines)
			}
		})
	}
}
