package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// F146 / #313 (P3D-7) — contract diseño→BOM→precio compartido con TS.
// Consume el MISMO contracts/designBomPrice.json que
// packages/domain/src/designBomPriceContract.test.ts. El fixture viaja en
// camelCase (forma TS); los DTOs de abajo lo mapean a los tipos de dominio Go.
// Regla: si un motor diverge, se alinea el motor — nunca el expected.

// ── DTOs del fixture (camelCase, forma TS) ─────────────────────────────────

type fxDims struct {
	Width  int `json:"width"`
	Height int `json:"height"`
	Depth  int `json:"depth"`
}

type fxItemCustomDims struct {
	WidthMm  int `json:"widthMm"`
	HeightMm int `json:"heightMm"`
	DepthMm  int `json:"depthMm"`
}

type fxMaterial struct {
	ID           string  `json:"id"`
	Code         string  `json:"code"`
	Name         string  `json:"name"`
	WidthMm      int     `json:"widthMm"`
	LengthMm     int     `json:"lengthMm"`
	ThicknessMm  int     `json:"thicknessMm"`
	GrainDefault bool    `json:"grainDefault"`
	BoardPrice   float64 `json:"boardPrice"`
	WastePercent float64 `json:"wastePercent"`
	CostPerM2    float64 `json:"costPerM2"`
	Active       bool    `json:"active"`
}

type fxHardware struct {
	ID          string  `json:"id"`
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Unit        string  `json:"unit"`
	CostPerUnit float64 `json:"costPerUnit"`
	Active      bool    `json:"active"`
}

type fxOptionGroup struct {
	ID        string   `json:"id"`
	Code      string   `json:"code"`
	Name      string   `json:"name"`
	Kind      string   `json:"kind"`
	Required  bool     `json:"required"`
	OptionIDs []string `json:"optionIds"`
}

type fxEdge struct {
	Side    string `json:"side"`
	Enabled bool   `json:"enabled"`
}

type fxGeometry struct {
	Kind          string `json:"kind"`
	LengthMm      int    `json:"lengthMm"`
	WidthMm       int    `json:"widthMm"`
	ThicknessMm   int    `json:"thicknessMm"`
	LengthFormula string `json:"lengthFormula"`
	WidthFormula  string `json:"widthFormula"`
}

type fxComponent struct {
	ID           string     `json:"id"`
	Code         string     `json:"code"`
	Name         string     `json:"name"`
	Placement    string     `json:"placement"`
	Geometry     fxGeometry `json:"geometry"`
	DefaultEdges []fxEdge   `json:"defaultEdges"`
	OptionRoles  []string   `json:"optionRoles"`
	Active       bool       `json:"active"`
}

type fxInstance struct {
	ComponentID string `json:"componentId"`
	Quantity    int    `json:"quantity"`
}

type fxHardwareLine struct {
	ID         string `json:"id"`
	Quantity   int    `json:"quantity"`
	OptionRole string `json:"optionRole"`
}

type fxStructure struct {
	ID           string       `json:"id"`
	Code         string       `json:"code"`
	Name         string       `json:"name"`
	ExternalDims fxDims       `json:"externalDims"`
	Components   []fxInstance `json:"components"`
	Active       bool         `json:"active"`
}

type fxAgregado struct {
	ID            string           `json:"id"`
	Code          string           `json:"code"`
	Name          string           `json:"name"`
	Components    []fxInstance     `json:"components"`
	HardwareLines []fxHardwareLine `json:"hardwareLines"`
	Active        bool             `json:"active"`
}

type fxPreset struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Depth  int    `json:"depth"`
}

type fxModule struct {
	ID              string           `json:"id"`
	Code            string           `json:"code"`
	Name            string           `json:"name"`
	StructureID     string           `json:"structureId"`
	BaseMode        string           `json:"baseMode"`
	BaseClearanceMm *int             `json:"baseClearanceMm"`
	ExternalDims    fxDims           `json:"externalDims"`
	Presets         []fxPreset       `json:"presets"`
	Components      []fxInstance     `json:"components"`
	HardwareLines   []fxHardwareLine `json:"hardwareLines"`
	Active          bool             `json:"active"`
}

type fxCatalog struct {
	Materials    []fxMaterial    `json:"materials"`
	Hardware     []fxHardware    `json:"hardware"`
	OptionGroups []fxOptionGroup `json:"optionGroups"`
	Structures   []fxStructure   `json:"structures"`
	Components   []fxComponent   `json:"components"`
	Agregados    []fxAgregado    `json:"agregados"`
	Modules      []fxModule      `json:"modules"`
}

type fxItem struct {
	ID              string            `json:"id"`
	ModuleID        string            `json:"moduleId"`
	Quantity        int               `json:"quantity"`
	OptionChoices   map[string]string `json:"optionChoices"`
	MeasurePresetID string            `json:"measurePresetId"`
}

type fxProject struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	CustomerID     string   `json:"customerId"`
	Currency       string   `json:"currency"`
	MarginFactor   float64  `json:"marginFactor"`
	LaborFixedCost float64  `json:"laborFixedCost"`
	Status         string   `json:"status"`
	Items          []fxItem `json:"items"`
}

type fxExpectedPart struct {
	Description string `json:"description"`
	LengthMm    int    `json:"lengthMm"`
	WidthMm     int    `json:"widthMm"`
	MaterialID  string `json:"materialId"`
	Count       int    `json:"count"`
}

type fxExpected struct {
	Parts          []fxExpectedPart `json:"parts"`
	HardwareTotals map[string]int   `json:"hardwareTotals"`
	MaterialsCost  float64          `json:"materialsCost"`
	HardwareTotal  float64          `json:"hardwareTotal"`
	DirectCost     float64          `json:"directCost"`
	SalePrice      float64          `json:"salePrice"`
}

type fxScenario struct {
	ID                    string            `json:"id"`
	Description           string            `json:"description"`
	ModuleID              string            `json:"moduleId"`
	AgregadoQty           int               `json:"agregadoQty"`
	CustomDims            *fxItemCustomDims `json:"customDims"`
	OptionChoicesOverride map[string]string `json:"optionChoicesOverride"`
	Expected              fxExpected        `json:"expected"`
}

type fixture struct {
	AmbientMaterialIDs []string     `json:"ambientMaterialIds"`
	Catalog            fxCatalog    `json:"catalog"`
	Project            fxProject    `json:"project"`
	Scenarios          []fxScenario `json:"scenarios"`
	StaleFingerprint   struct {
		Description string           `json:"description"`
		CustomDims  fxItemCustomDims `json:"customDims"`
	} `json:"staleFingerprint"`
}

// ── conversión DTO → dominio Go ────────────────────────────────────────────

func toEdges(in []fxEdge) []domain.EdgeAssignment {
	out := make([]domain.EdgeAssignment, 0, len(in))
	for _, e := range in {
		out = append(out, domain.EdgeAssignment{Side: e.Side, Enabled: e.Enabled})
	}
	return out
}

func toInstances(in []fxInstance) []domain.ComponentInstance {
	out := make([]domain.ComponentInstance, 0, len(in))
	for _, i := range in {
		out = append(out, domain.ComponentInstance{ComponentID: i.ComponentID, Quantity: i.Quantity})
	}
	return out
}

func toHardwareLines(in []fxHardwareLine) []domain.HardwareLine {
	out := make([]domain.HardwareLine, 0, len(in))
	for _, l := range in {
		out = append(out, domain.HardwareLine{ID: l.ID, Quantity: l.Quantity, OptionRole: l.OptionRole})
	}
	return out
}

func (f *fixture) catalogWithModule(mod domain.Module) domain.Catalog {
	c := domain.Catalog{}
	for _, m := range f.Catalog.Materials {
		c.Materials = append(c.Materials, domain.MaterialBoard{
			ID: m.ID, Code: m.Code, Name: m.Name,
			WidthMm: m.WidthMm, LengthMm: m.LengthMm, ThicknessMm: m.ThicknessMm,
			GrainDefault: m.GrainDefault, BoardPrice: m.BoardPrice,
			WastePercent: m.WastePercent, CostPerM2: m.CostPerM2, Active: m.Active,
		})
	}
	for _, h := range f.Catalog.Hardware {
		c.Hardware = append(c.Hardware, domain.Hardware{
			ID: h.ID, Code: h.Code, Name: h.Name,
			Unit: domain.HardwareUnit(h.Unit), CostPerUnit: h.CostPerUnit, Active: h.Active,
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
			Components: toInstances(s.Components),
		})
	}
	for _, comp := range f.Catalog.Components {
		c.Components = append(c.Components, domain.Component{
			ID: comp.ID, Code: comp.Code, Name: comp.Name,
			Placement:    domain.ComponentPlacement(comp.Placement),
			GeometryKind: comp.Geometry.Kind,
			LengthMm:     comp.Geometry.LengthMm, WidthMm: comp.Geometry.WidthMm,
			ThicknessMm:  comp.Geometry.ThicknessMm,
			DefaultEdges: toEdges(comp.DefaultEdges),
			OptionRoles:  comp.OptionRoles, Active: comp.Active,
			LengthFormula: comp.Geometry.LengthFormula,
			WidthFormula:  comp.Geometry.WidthFormula,
		})
	}
	for _, a := range f.Catalog.Agregados {
		c.Agregados = append(c.Agregados, domain.Agregado{
			ID: a.ID, Code: a.Code, Name: a.Name, Active: a.Active,
			Components: toInstances(a.Components),
		})
		// Hardware del agregado se inyecta al expandir (Go lo multiplica por qty).
		agg := &c.Agregados[len(c.Agregados)-1]
		agg.HardwareLines = toHardwareLines(a.HardwareLines)
	}
	c.Modules = []domain.Module{mod}
	return c
}

func (f *fixture) moduleForScenario(sc fxScenario) domain.Module {
	m := f.Catalog.Modules[0]
	if sc.ModuleID != "" {
		found := false
		for _, cand := range f.Catalog.Modules {
			if cand.ID == sc.ModuleID {
				m = cand
				found = true
				break
			}
		}
		if !found {
			// El escenario nombra un módulo inexistente: fallar acá es mejor
			// que resolver silenciosamente contra el primero.
			panic(fmt.Sprintf("scenario %s: module %q not in fixture", sc.ID, sc.ModuleID))
		}
	}
	mod := domain.Module{
		ID: m.ID, Code: m.Code, Name: m.Name,
		StructureID:     m.StructureID,
		BaseMode:        m.BaseMode,
		BaseClearanceMm: m.BaseClearanceMm,
		WidthMm:         m.ExternalDims.Width, HeightMm: m.ExternalDims.Height, DepthMm: m.ExternalDims.Depth,
		Components:    toInstances(m.Components),
		HardwareLines: toHardwareLines(m.HardwareLines),
	}
	for _, p := range m.Presets {
		mod.Presets = append(mod.Presets, domain.DimensionPreset{
			ID: p.ID, Name: p.Name, WidthMm: p.Width, HeightMm: p.Height, DepthMm: p.Depth,
		})
	}
	if sc.AgregadoQty > 0 {
		mod.Agregados = []domain.ModuleAgregadoInstance{{AgregadoID: "agr-cajon", Quantity: sc.AgregadoQty}}
	}
	return mod
}

func loadFixture(t *testing.T) *fixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "designBomPrice.json"))
	if err != nil {
		t.Fatalf("read contracts/designBomPrice.json: %v", err)
	}
	var f fixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	if len(f.Scenarios) == 0 {
		t.Fatal("fixture sin escenarios")
	}
	return &f
}

func partKey(description string, length, width int, materialID string) string {
	return fmt.Sprintf("%s|%d|%d|%s", description, length, width, materialID)
}

func almostEqual(a, b float64) bool {
	return math.Abs(a-b) <= 0.01
}

func TestDesignBomPriceContract(t *testing.T) {
	f := loadFixture(t)
	baseItem := f.Project.Items[0]

	for _, sc := range f.Scenarios {
		sc := sc
		t.Run(sc.ID, func(t *testing.T) {
			mod := f.moduleForScenario(sc)
			catalog := f.catalogWithModule(mod)

			choices := map[string]string{}
			for k, v := range baseItem.OptionChoices {
				choices[k] = v
			}
			for k, v := range sc.OptionChoicesOverride {
				choices[k] = v
			}
			item := domain.ProjectItem{
				ID: baseItem.ID, ModuleID: mod.ID,
				Quantity: baseItem.Quantity, OptionChoices: choices,
				MeasurePresetID: baseItem.MeasurePresetID,
				CustomDims:      sc.CustomDims.toDomain(),
			}
			project := domain.Project{
				ID: f.Project.ID, Name: f.Project.Name, CustomerID: f.Project.CustomerID,
				Currency: f.Project.Currency, MarginFactor: f.Project.MarginFactor,
				LaborFixedCost: f.Project.LaborFixedCost,
				Status:         domain.ProjectStatus(f.Project.Status),
				Items:          []domain.ProjectItem{item},
			}

			// 1) BOM: piezas por firma (description+dims+material) y multiplicidad.
			bom, err := ResolveBomWithDims(mod, choices, catalog, item.MeasurePresetID, nil, item.CustomDims)
			if err != nil {
				t.Fatalf("ResolveBomWithDims: %v", err)
			}
			got := map[string]int{}
			for _, part := range bom.BoardParts {
				got[partKey(part.Description, part.LengthMm, part.WidthMm, part.MaterialID)] += part.Quantity
			}
			want := map[string]int{}
			for _, p := range sc.Expected.Parts {
				want[partKey(p.Description, p.LengthMm, p.WidthMm, p.MaterialID)] += p.Count
			}
			if len(got) != len(want) {
				t.Fatalf("part signatures divergen:\n got: %v\nwant: %v", got, want)
			}
			for k, n := range want {
				if got[k] != n {
					t.Errorf("parte %q: got %d, want %d (got all: %v)", k, got[k], n, got)
				}
			}

			// Anti-leak ambiental: ningún id ambiental en el BOM.
			ambient := map[string]bool{}
			for _, id := range f.AmbientMaterialIDs {
				ambient[id] = true
			}
			for _, part := range bom.BoardParts {
				if ambient[part.MaterialID] {
					t.Errorf("material ambiental %q leakó al BOM", part.MaterialID)
				}
			}

			// 2) Hardware: agregado por hardwareId resuelto.
			hwTotals := map[string]int{}
			for _, line := range bom.HardwareLines {
				hwTotals[line.HardwareID] += line.Quantity
			}
			if len(hwTotals) != len(sc.Expected.HardwareTotals) {
				t.Fatalf("hardware totals divergen: got %v, want %v", hwTotals, sc.Expected.HardwareTotals)
			}
			for id, n := range sc.Expected.HardwareTotals {
				if hwTotals[id] != n {
					t.Errorf("hardware %q: got %d, want %d (got all: %v)", id, hwTotals[id], n, hwTotals)
				}
			}

			// 3) Precio: mismo policy de no redondeo intermedio que TS (tol 0.01).
			bd, err := CalcProjectBreakdown(project, catalog)
			if err != nil {
				t.Fatalf("CalcProjectBreakdown: %v", err)
			}
			if !almostEqual(bd.MaterialsCost, sc.Expected.MaterialsCost) {
				t.Errorf("materialsCost = %v, want %v", bd.MaterialsCost, sc.Expected.MaterialsCost)
			}
			if !almostEqual(bd.HardwareTotal, sc.Expected.HardwareTotal) {
				t.Errorf("hardwareTotal = %v, want %v", bd.HardwareTotal, sc.Expected.HardwareTotal)
			}
			if !almostEqual(bd.DirectCost, sc.Expected.DirectCost) {
				t.Errorf("directCost = %v, want %v", bd.DirectCost, sc.Expected.DirectCost)
			}
			if !almostEqual(bd.SalePrice, sc.Expected.SalePrice) {
				t.Errorf("salePrice = %v, want %v", bd.SalePrice, sc.Expected.SalePrice)
			}
		})
	}
}

// El fingerprint de producción vive hoy sólo en TS (computeProductionDesignFingerprint);
// cuando O1/#300 lo espeje en Go, este test lo consume del mismo fixture.
func TestDesignBomPriceContractStaleDocumented(t *testing.T) {
	f := loadFixture(t)
	if strings.TrimSpace(f.StaleFingerprint.Description) == "" {
		t.Fatal("fixture debe documentar la dependencia stale/release (O1/#300)")
	}
}

func (d *fxItemCustomDims) toDomain() *domain.ItemCustomDims {
	if d == nil {
		return nil
	}
	return &domain.ItemCustomDims{WidthMm: d.WidthMm, HeightMm: d.HeightMm, DepthMm: d.DepthMm}
}
