package engine

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #442 — contract de paridad TS/Go del tratamiento de base (zócalo/patas).
// Consume el MISMO contracts/plinthBaseParity.contract.json que
// packages/domain/src/plinthBaseParity.contract.test.ts. El fixture viaja en
// camelCase (forma TS); los DTOs de abajo lo mapean a los tipos de dominio Go.
// Regla: si un motor diverge, se alinea el motor — nunca el expected.

// ── DTOs del fixture (camelCase, forma TS) ─────────────────────────────────

type pbDims struct {
	Width  int `json:"width"`
	Height int `json:"height"`
	Depth  int `json:"depth"`
}

type pbMaterial struct {
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

type pbEdgeBand struct {
	ID         string  `json:"id"`
	Code       string  `json:"code"`
	Name       string  `json:"name"`
	CostPerMl  float64 `json:"costPerMl"`
	Active     bool    `json:"active"`
}

type pbHardware struct {
	ID          string   `json:"id"`
	Code        string   `json:"code"`
	Name        string   `json:"name"`
	Unit        string   `json:"unit"`
	CostPerUnit float64  `json:"costPerUnit"`
	PackageSize *float64 `json:"packageSize"`
	Active      bool     `json:"active"`
}

type pbOptionGroup struct {
	ID        string   `json:"id"`
	Code      string   `json:"code"`
	Name      string   `json:"name"`
	Kind      string   `json:"kind"`
	Required  bool     `json:"required"`
	OptionIDs []string `json:"optionIds"`
}

type pbEdge struct {
	Side    string `json:"side"`
	Enabled bool   `json:"enabled"`
}

type pbGeometry struct {
	Kind          string `json:"kind"`
	LengthMm      int    `json:"lengthMm"`
	WidthMm       int    `json:"widthMm"`
	ThicknessMm   int    `json:"thicknessMm"`
	LengthFormula string `json:"lengthFormula"`
	WidthFormula  string `json:"widthFormula"`
}

type pbComponent struct {
	ID           string     `json:"id"`
	Code         string     `json:"code"`
	Name         string     `json:"name"`
	Placement    string     `json:"placement"`
	Geometry     pbGeometry `json:"geometry"`
	DefaultEdges []pbEdge   `json:"defaultEdges"`
	OptionRoles  []string   `json:"optionRoles"`
	Active       bool       `json:"active"`
}

type pbInstance struct {
	ComponentID string `json:"componentId"`
	Quantity    int    `json:"quantity"`
}

type pbHardwareLine struct {
	ID         string  `json:"id"`
	Quantity   float64 `json:"quantity"`
	OptionRole string  `json:"optionRole"`
}

type pbStructure struct {
	ID           string       `json:"id"`
	Code         string       `json:"code"`
	Name         string       `json:"name"`
	ExternalDims pbDims       `json:"externalDims"`
	Components   []pbInstance `json:"components"`
	Active       bool         `json:"active"`
}

type pbModule struct {
	ID              string           `json:"id"`
	Code            string           `json:"code"`
	Name            string           `json:"name"`
	StructureID     string           `json:"structureId"`
	BaseMode        string           `json:"baseMode"`
	BaseClearanceMm *int             `json:"baseClearanceMm"`
	ExternalDims    pbDims           `json:"externalDims"`
	Presets         []pbPreset       `json:"presets"`
	Components      []pbInstance     `json:"components"`
	HardwareLines   []pbHardwareLine `json:"hardwareLines"`
	Active          bool             `json:"active"`
}

type pbPreset struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Depth  int    `json:"depth"`
}

type pbCatalog struct {
	Materials    []pbMaterial    `json:"materials"`
	Edges        []pbEdgeBand    `json:"edges"`
	Hardware     []pbHardware    `json:"hardware"`
	OptionGroups []pbOptionGroup `json:"optionGroups"`
	Structures   []pbStructure   `json:"structures"`
	Components   []pbComponent   `json:"components"`
	Modules      []pbModule      `json:"modules"`
}

type pbExpectedPart struct {
	ID          string   `json:"id"`
	Code        string   `json:"code"`
	Description string   `json:"description"`
	LengthMm    int      `json:"lengthMm"`
	WidthMm     int      `json:"widthMm"`
	Quantity    int      `json:"quantity"`
	OptionRole  string   `json:"optionRole"`
	Edges       []string `json:"edges"`
	MaterialID  string   `json:"materialId"`
}

type pbExpectedHardware struct {
	ID                  string  `json:"id"`
	OptionRole          string  `json:"optionRole"`
	Quantity            float64 `json:"quantity"`
	HardwareID          string  `json:"hardwareId"`
	DescriptionOverride string  `json:"descriptionOverride"`
}

type pbScenario struct {
	ID                    string          `json:"id"`
	Description           string          `json:"description"`
	ModuleID              string          `json:"moduleId"`
	ItemBaseMode          string          `json:"itemBaseMode"`
	Layout                json.RawMessage `json:"layout"`
	OptionChoicesOverride map[string]string `json:"optionChoicesOverride"`
	Expected              struct {
		Parts    []pbExpectedPart    `json:"parts"`
		Hardware []pbExpectedHardware `json:"hardware"`
	} `json:"expected"`
}

type plinthFixture struct {
	Catalog   pbCatalog    `json:"catalog"`
	Scenarios []pbScenario `json:"scenarios"`
}

// ── conversión DTO → dominio Go ────────────────────────────────────────────

func pbToEdges(in []pbEdge) []domain.EdgeAssignment {
	out := make([]domain.EdgeAssignment, 0, len(in))
	for _, e := range in {
		out = append(out, domain.EdgeAssignment{Side: e.Side, Enabled: e.Enabled})
	}
	return out
}

func pbToInstances(in []pbInstance) []domain.ComponentInstance {
	out := make([]domain.ComponentInstance, 0, len(in))
	for _, i := range in {
		out = append(out, domain.ComponentInstance{ComponentID: i.ComponentID, Quantity: i.Quantity})
	}
	return out
}

func pbToHardwareLines(in []pbHardwareLine) []domain.HardwareLine {
	out := make([]domain.HardwareLine, 0, len(in))
	for _, l := range in {
		out = append(out, domain.HardwareLine{ID: l.ID, Quantity: l.Quantity, OptionRole: l.OptionRole})
	}
	return out
}

func (f *plinthFixture) toDomainCatalog() domain.Catalog {
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
	for _, h := range f.Catalog.Hardware {
		c.Hardware = append(c.Hardware, domain.Hardware{
			ID: h.ID, Code: h.Code, Name: h.Name,
			Unit: domain.HardwareUnit(h.Unit), CostPerUnit: h.CostPerUnit,
			PackageSize: h.PackageSize, Active: h.Active,
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
			Components: pbToInstances(s.Components),
		})
	}
	for _, comp := range f.Catalog.Components {
		c.Components = append(c.Components, domain.Component{
			ID: comp.ID, Code: comp.Code, Name: comp.Name,
			Placement:    domain.ComponentPlacement(comp.Placement),
			GeometryKind: comp.Geometry.Kind,
			LengthMm:     comp.Geometry.LengthMm, WidthMm: comp.Geometry.WidthMm,
			ThicknessMm:  comp.Geometry.ThicknessMm,
			DefaultEdges: pbToEdges(comp.DefaultEdges),
			OptionRoles:  comp.OptionRoles, Active: comp.Active,
			LengthFormula: comp.Geometry.LengthFormula,
			WidthFormula:  comp.Geometry.WidthFormula,
		})
	}
	for _, m := range f.Catalog.Modules {
		mod := domain.Module{
			ID: m.ID, Code: m.Code, Name: m.Name,
			StructureID:     m.StructureID,
			BaseMode:        m.BaseMode,
			BaseClearanceMm: m.BaseClearanceMm,
			WidthMm:         m.ExternalDims.Width, HeightMm: m.ExternalDims.Height, DepthMm: m.ExternalDims.Depth,
			Components:    pbToInstances(m.Components),
			HardwareLines: pbToHardwareLines(m.HardwareLines),
		}
		for _, p := range m.Presets {
			mod.Presets = append(mod.Presets, domain.DimensionPreset{
				ID: p.ID, Name: p.Name, WidthMm: p.Width, HeightMm: p.Height, DepthMm: p.Depth,
			})
		}
		c.Modules = append(c.Modules, mod)
	}
	return c
}

func loadPlinthFixture(t *testing.T) *plinthFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "plinthBaseParity.contract.json"))
	if err != nil {
		t.Fatalf("reading plinthBaseParity contract: %v", err)
	}
	var fx plinthFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatalf("parsing plinthBaseParity contract: %v", err)
	}
	if len(fx.Scenarios) < 13 {
		t.Fatalf("plinthBaseParity contract must carry its scenarios (got %d)", len(fx.Scenarios))
	}
	return &fx
}

// ── assertions (espejo del matcher TS: multiset con consumo) ───────────────

func pbEnabledEdges(edges []domain.EdgeAssignment) string {
	var enabled []string
	for _, e := range edges {
		if e.Enabled {
			enabled = append(enabled, e.Side)
		}
	}
	sortStrings(enabled)
	return strings.Join(enabled, ",")
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

func pbExpectedEdgesKey(edges []string) string {
	sorted := append([]string(nil), edges...)
	sortStrings(sorted)
	return strings.Join(sorted, ",")
}

func pbPartMatches(part domain.ResolvedBoardPart, exp pbExpectedPart) bool {
	if exp.ID != "" && part.ID != exp.ID {
		return false
	}
	if exp.Code != "" && part.Code != exp.Code {
		return false
	}
	return part.Description == exp.Description &&
		part.LengthMm == exp.LengthMm &&
		part.WidthMm == exp.WidthMm &&
		part.OptionRole == exp.OptionRole &&
		pbEnabledEdges(part.Edges) == pbExpectedEdgesKey(exp.Edges) &&
		part.MaterialID == exp.MaterialID
}

func pbHardwareMatches(line domain.ResolvedHardwareLine, exp pbExpectedHardware) bool {
	if exp.ID != "" && line.ID != exp.ID {
		return false
	}
	if exp.DescriptionOverride != "" && line.DescriptionOverride != exp.DescriptionOverride {
		return false
	}
	return line.OptionRole == exp.OptionRole &&
		line.Quantity == exp.Quantity &&
		line.HardwareID == exp.HardwareID
}

func pbConsume[T any](t *testing.T, pool *[]T, matches func(T) bool, scenarioID, what string) {
	t.Helper()
	for i, item := range *pool {
		if matches(item) {
			*pool = append((*pool)[:i], (*pool)[i+1:]...)
			return
		}
	}
	t.Fatalf("%s: %s no encontrado en el output (restante: %+v)", scenarioID, what, *pool)
}

// ── test ────────────────────────────────────────────────────────────────────

func TestPlinthBaseParity_SharedContract(t *testing.T) {
	fx := loadPlinthFixture(t)
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

			choices := map[string]string{"FRENTE": "mat-front", "INTERIOR": "mat-body"}
			for k, v := range sc.OptionChoicesOverride {
				choices[k] = v
			}

			item := domain.ProjectItem{
				ID:            "item-1",
				ModuleID:      sc.ModuleID,
				Quantity:      1,
				OptionChoices: choices,
				BaseMode:      sc.ItemBaseMode,
			}
			project := domain.Project{
				ID:         "p-contract",
				Items:      []domain.ProjectItem{item},
				KitchenLayout: sc.Layout,
			}

			baseContext, err := ResolveBaseContextForItem(project, item, &catalog)
			if err != nil {
				t.Fatalf("%s: base context: %v", sc.ID, err)
			}
			bom, err := ResolveBomWithContext(module, choices, catalog, baseContext, "", nil, nil)
			if err != nil {
				t.Fatalf("%s: resolve: %v", sc.ID, err)
			}

			// Parts: cada expected entry consume `quantity` partes idénticas; al
			// final no debe sobrar ninguna (ni fantasma ni faltante).
			actualParts := append([]domain.ResolvedBoardPart(nil), bom.BoardParts...)
			for _, exp := range sc.Expected.Parts {
				exp := exp
				for i := 0; i < exp.Quantity; i++ {
					pbConsume(t, &actualParts, func(p domain.ResolvedBoardPart) bool { return pbPartMatches(p, exp) },
						sc.ID, fmt.Sprintf("parte expected %s %d×%d", exp.Description, exp.LengthMm, exp.WidthMm))
				}
			}
			if len(actualParts) != 0 {
				t.Fatalf("%s: partes no esperadas en el BOM: %+v", sc.ID, actualParts)
			}

			// Hardware: match exacto (ml fraccional incluido).
			actualHardware := append([]domain.ResolvedHardwareLine(nil), bom.HardwareLines...)
			for _, exp := range sc.Expected.Hardware {
				exp := exp
				pbConsume(t, &actualHardware, func(l domain.ResolvedHardwareLine) bool { return pbHardwareMatches(l, exp) },
					sc.ID, fmt.Sprintf("herraje expected %s ×%v", exp.OptionRole, exp.Quantity))
			}
			if len(actualHardware) != 0 {
				t.Fatalf("%s: herraje no esperado en el BOM: %+v", sc.ID, actualHardware)
			}
		})
	}
}
