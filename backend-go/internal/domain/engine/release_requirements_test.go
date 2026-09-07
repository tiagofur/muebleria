package engine

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func requirementProject(module string, units int) domain.Project {
	project := domain.Project{}
	for i := 0; i < units; i++ {
		project.Items = append(project.Items, domain.ProjectItem{
			ModuleID: module, Quantity: 1,
			OptionChoices: map[string]string{"FRENTE": "mat-front", "INTERIOR": "mat-body", "ZOCLO_PERFIL": "hw-perfil"},
		})
	}
	return project
}

func TestRequirementLinesSharedContract(t *testing.T) {
	data, err := os.ReadFile("../../../../contracts/releaseRequirements.contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Name         string
			ModuleID     string `json:"moduleId"`
			Units        int
			WastePercent float64                `json:"wastePercent"`
			CustomDims   *domain.ItemCustomDims `json:"customDims"`
			Expected     []domain.MaterialRequirementLine
		}
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range fixture.Cases {
		t.Run(scenario.Name, func(t *testing.T) {
			catalog := loadPlinthFixture(t).toDomainCatalog()
			for i := range catalog.Materials {
				catalog.Materials[i].WastePercent = scenario.WastePercent
			}
			project := requirementProject(scenario.ModuleID, scenario.Units)
			for i := range project.Items {
				project.Items[i].CustomDims = scenario.CustomDims
			}
			got, err := RequirementLinesFromProject(project, catalog)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, scenario.Expected) {
				t.Fatalf("got %#v, want %#v", got, scenario.Expected)
			}
		})
	}
}

func TestRequirementLinesRejectInvalidInput(t *testing.T) {
	cases := map[string]func(*domain.Project, *domain.Catalog){
		"missing module":                func(p *domain.Project, c *domain.Catalog) { c.Modules = nil },
		"missing material":              func(p *domain.Project, c *domain.Catalog) { c.Materials = nil },
		"missing hardware":              func(p *domain.Project, c *domain.Catalog) { c.Hardware = nil },
		"invalid unit quantity":         func(p *domain.Project, c *domain.Catalog) { p.Items[0].Quantity = 0 },
		"zero sheet width":              func(p *domain.Project, c *domain.Catalog) { c.Materials[1].WidthMm = 0 },
		"infinite waste":                func(p *domain.Project, c *domain.Catalog) { c.Materials[1].WastePercent = math.Inf(1) },
		"nan waste":                     func(p *domain.Project, c *domain.Catalog) { c.Materials[1].WastePercent = math.NaN() },
		"nan package":                   func(p *domain.Project, c *domain.Catalog) { *c.Hardware[0].PackageSize = math.NaN() },
		"negative package":              func(p *domain.Project, c *domain.Catalog) { *c.Hardware[0].PackageSize = -1 },
		"infinite package":              func(p *domain.Project, c *domain.Catalog) { *c.Hardware[0].PackageSize = math.Inf(1) },
		"subnormal package":             func(p *domain.Project, c *domain.Catalog) { *c.Hardware[0].PackageSize = math.SmallestNonzeroFloat64 },
		"unrepresentable package count": func(p *domain.Project, c *domain.Catalog) { *c.Hardware[0].PackageSize = 1e-20 },
		"unsafe aggregate consumption": func(p *domain.Project, c *domain.Catalog) {
			p.Items = append(p.Items, p.Items[0])
			c.Modules[3].HardwareLines = []domain.HardwareLine{{ID: "large", HardwareID: "hw-perfil", Quantity: 5e15}}
		},
		"missing edge": func(p *domain.Project, c *domain.Catalog) {
			p.Items[0].ModuleID = "m-bajo-zoclo"
			c.Edges = nil
		},
		"unsafe metric multiplication": func(p *domain.Project, c *domain.Catalog) { p.Items[0].Quantity = 1 << 40 },
		"nan hardware quantity": func(p *domain.Project, c *domain.Catalog) {
			c.Modules[3].HardwareLines = []domain.HardwareLine{{ID: "invalid", HardwareID: "hw-perfil", Quantity: math.NaN()}}
		},
		"infinite hardware quantity": func(p *domain.Project, c *domain.Catalog) {
			c.Modules[3].HardwareLines = []domain.HardwareLine{{ID: "invalid", HardwareID: "hw-perfil", Quantity: math.Inf(1)}}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			project, catalog := requirementProject("m-bajo-perfil", 1), loadPlinthFixture(t).toDomainCatalog()
			mutate(&project, &catalog)
			lines, err := RequirementLinesFromProject(project, catalog)
			if err == nil || lines != nil {
				t.Fatalf("expected failure without partial lines, got %v, %v", lines, err)
			}
		})
	}
}

func resolvedRequirementFixture() ([]ResolvedRequirementInput, domain.Catalog) {
	packageSize := 2.0
	catalog := domain.Catalog{
		Materials: []domain.MaterialBoard{{ID: "a", Active: true, WidthMm: 1000, LengthMm: 2000}},
		Edges:     []domain.EdgeBand{{ID: "edge", Active: true}},
		Hardware:  []domain.Hardware{{ID: "hardware", Active: true, PackageSize: &packageSize}},
	}
	inputs := make([]ResolvedRequirementInput, 2)
	for i := range inputs {
		inputs[i] = ResolvedRequirementInput{PhysicalQuantity: 1, BOM: domain.ResolvedBom{
			BoardParts: []domain.ResolvedBoardPart{{ID: "part", MaterialID: "a", Quantity: 1,
				LengthMm: 500, WidthMm: 1000, EdgeBandID: "edge",
				Edges: []domain.EdgeAssignment{{Side: "L1", Enabled: true}}}},
			HardwareLines: []domain.ResolvedHardwareLine{{ID: "line", HardwareID: "hardware", Quantity: 0.75}},
		}}
	}
	return inputs, catalog
}

func TestRequirementLinesResolvedCollection(t *testing.T) {
	inputs, catalog := resolvedRequirementFixture()
	inputs[1].PhysicalQuantity = 3
	other := catalog.Materials[0]
	other.ID = "z"
	catalog.Materials = append(catalog.Materials, other)
	inputs[0].BOM.BoardParts = append(inputs[0].BOM.BoardParts, domain.ResolvedBoardPart{
		ID: "other", MaterialID: "z", Quantity: 1, LengthMm: 500, WidthMm: 1000,
	})
	before, _ := json.Marshal([]any{inputs, catalog})
	want := []domain.MaterialRequirementLine{
		{Kind: "cintillas", MaterialID: "edge", Quantity: 2},
		{Kind: "herrajes", MaterialID: "hardware", Quantity: 4},
		{Kind: "tableros", MaterialID: "a", Quantity: 1},
		{Kind: "tableros", MaterialID: "z", Quantity: 1},
	}
	got, err := RequirementLinesFromResolvedBOMs(inputs, catalog)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, %v; want %v", got, err, want)
	}
	after, _ := json.Marshal([]any{inputs, catalog})
	if string(before) != string(after) {
		t.Fatal("aggregation mutated resolved inputs or catalog")
	}
	inputs[0], inputs[1] = inputs[1], inputs[0]
	got, err = RequirementLinesFromResolvedBOMs(inputs, catalog)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("reordered collection changed requirements: %v, %v", got, err)
	}
}

func TestRequirementLinesResolvedTypedUnits(t *testing.T) {
	item, catalog := releaseUnitFixture(t)
	catalog.Components[0].DefaultEdges = nil
	catalog.Modules[0].HardwareLines = []domain.HardwareLine{{ID: "rail", HardwareID: "hw-perfil", Quantity: 0.5}}
	*catalog.Hardware[0].PackageSize = 2
	for i := range catalog.Materials {
		catalog.Materials[i].WidthMm, catalog.Materials[i].LengthMm = 1000, 3000
		catalog.Materials[i].WastePercent = 0
	}
	var inputs []ResolvedRequirementInput
	for i, shelves := range []float64{2, 5} {
		item.FurnitureInstanceID = []string{"first", "second"}[i]
		item.Parameters["shelves"] = shelves
		unit, err := ResolveReleaseUnit(item, catalog)
		if err != nil {
			t.Fatal(err)
		}
		if len(unit.BOM.BoardParts) != int(shelves) {
			t.Fatal("typed quantity was not resolved per physical unit")
		}
		inputs = append(inputs, ResolvedRequirementInput{BOM: unit.BOM, PhysicalQuantity: 1})
	}
	// Removing authoring sources proves aggregation cannot rerun either module.
	catalog.Modules, catalog.Structures, catalog.Components = nil, nil, nil
	got, err := RequirementLinesFromResolvedBOMs(inputs, catalog)
	want := []domain.MaterialRequirementLine{
		{Kind: "herrajes", MaterialID: "hw-perfil", Quantity: 2},
		{Kind: "tableros", MaterialID: "mat-body", Quantity: 1},
	}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, %v; want %v", got, err, want)
	}
}

func TestRequirementLinesResolvedEmptyAndSingleKind(t *testing.T) {
	for _, kind := range []string{"empty", "board", "hardware"} {
		t.Run(kind, func(t *testing.T) {
			inputs, catalog := resolvedRequirementFixture()
			for i := range inputs {
				inputs[i].BOM.BoardParts[0].Edges = nil
				if kind != "board" {
					inputs[i].BOM.BoardParts = nil
				}
				if kind != "hardware" {
					inputs[i].BOM.HardwareLines = nil
				}
			}
			want := []domain.MaterialRequirementLine{}
			if kind == "board" {
				want = append(want, domain.MaterialRequirementLine{Kind: "tableros", MaterialID: "a", Quantity: 1})
			} else if kind == "hardware" {
				want = append(want, domain.MaterialRequirementLine{Kind: "herrajes", MaterialID: "hardware", Quantity: 2})
			}
			got, err := RequirementLinesFromResolvedBOMs(inputs, catalog)
			if err != nil || !reflect.DeepEqual(got, want) {
				t.Fatalf("got %v, %v; want %v", got, err, want)
			}
		})
	}
	got, err := RequirementLinesFromProject(domain.Project{}, domain.Catalog{})
	if err != nil || got == nil || len(got) != 0 {
		t.Fatalf("empty project semantics changed: %v, %v", got, err)
	}
}

func TestRequirementLinesResolvedRejectsInvalidTotals(t *testing.T) {
	cases := map[string]func([]ResolvedRequirementInput, *domain.Catalog){
		"later unit invalid": func(in []ResolvedRequirementInput, c *domain.Catalog) { in[1].PhysicalQuantity = 0 },
		"inactive hardware":  func(in []ResolvedRequirementInput, c *domain.Catalog) { c.Hardware[0].Active = false },
		"inactive material":  func(in []ResolvedRequirementInput, c *domain.Catalog) { c.Materials[0].Active = false },
		"inactive edge":      func(in []ResolvedRequirementInput, c *domain.Catalog) { c.Edges[0].Active = false },
		"missing material":   func(in []ResolvedRequirementInput, c *domain.Catalog) { c.Materials = nil },
		"missing edge":       func(in []ResolvedRequirementInput, c *domain.Catalog) { c.Edges = nil },
		"missing hardware":   func(in []ResolvedRequirementInput, c *domain.Catalog) { c.Hardware = nil },
		"nonfinite product": func(in []ResolvedRequirementInput, c *domain.Catalog) {
			in[1].PhysicalQuantity = 2
			in[1].BOM.HardwareLines[0].Quantity = math.MaxFloat64
		},
		"addition swallowed by float rounding": func(in []ResolvedRequirementInput, c *domain.Catalog) {
			in[0].BOM.HardwareLines[0].Quantity = maxExactRequirementQuantity
			in[1].BOM.HardwareLines[0].Quantity = 0.25
		},
		"unsafe area total": func(in []ResolvedRequirementInput, c *domain.Catalog) {
			for i := range in {
				in[i].BOM.BoardParts[0].LengthMm, in[i].BOM.BoardParts[0].WidthMm = 50000000, 100000000
			}
		},
		"unsafe edge total": func(in []ResolvedRequirementInput, c *domain.Catalog) {
			for i := range in {
				part := &in[i].BOM.BoardParts[0]
				part.LengthMm, part.WidthMm = (i+2)*1000000000000000, 1
				part.Edges = []domain.EdgeAssignment{{Side: "L1", Enabled: true}, {Side: "L2", Enabled: true}}
			}
		},
		"unsafe waste": func(in []ResolvedRequirementInput, c *domain.Catalog) { c.Materials[0].WastePercent = math.MaxFloat64 },
		"unsafe purchase quantity": func(in []ResolvedRequirementInput, c *domain.Catalog) {
			*c.Hardware[0].PackageSize = maxExactRequirementQuantity + 1
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			inputs, catalog := resolvedRequirementFixture()
			mutate(inputs, &catalog)
			got, err := RequirementLinesFromResolvedBOMs(inputs, catalog)
			if err == nil || got != nil {
				t.Fatalf("expected failure without partial lines, got %v, %v", got, err)
			}
		})
	}
}

func TestRequirementLinesResolvedExactAreaBoundary(t *testing.T) {
	inputs, catalog := resolvedRequirementFixture()
	inputs[0].BOM = domain.ResolvedBom{BoardParts: []domain.ResolvedBoardPart{{
		ID: "at-limit", MaterialID: "a", Quantity: 1, LengthMm: 6361, WidthMm: maxExactRequirementQuantity / 6361,
	}}}
	inputs[1].BOM = domain.ResolvedBom{}
	if got, err := RequirementLinesFromResolvedBOMs(inputs, catalog); err != nil || len(got) != 1 {
		t.Fatalf("exact area bound should succeed: %v, %v", got, err)
	}
	inputs[1].BOM.BoardParts = []domain.ResolvedBoardPart{{ID: "one-more", MaterialID: "a", Quantity: 1, LengthMm: 1, WidthMm: 1}}
	if got, err := RequirementLinesFromResolvedBOMs(inputs, catalog); err == nil || got != nil {
		t.Fatalf("one mm2 above exact aggregate bound must fail: %v, %v", got, err)
	}
}
