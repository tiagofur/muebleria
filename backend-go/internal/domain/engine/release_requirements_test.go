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
		"missing module":        func(p *domain.Project, c *domain.Catalog) { c.Modules = nil },
		"missing material":      func(p *domain.Project, c *domain.Catalog) { c.Materials = nil },
		"missing hardware":      func(p *domain.Project, c *domain.Catalog) { c.Hardware = nil },
		"invalid unit quantity": func(p *domain.Project, c *domain.Catalog) { p.Items[0].Quantity = 0 },
		"zero sheet width":      func(p *domain.Project, c *domain.Catalog) { c.Materials[1].WidthMm = 0 },
		"infinite waste":        func(p *domain.Project, c *domain.Catalog) { c.Materials[1].WastePercent = math.Inf(1) },
		"nan waste":             func(p *domain.Project, c *domain.Catalog) { c.Materials[1].WastePercent = math.NaN() },
		"nan package":           func(p *domain.Project, c *domain.Catalog) { *c.Hardware[0].PackageSize = math.NaN() },
		"negative package":      func(p *domain.Project, c *domain.Catalog) { *c.Hardware[0].PackageSize = -1 },
		"infinite package":      func(p *domain.Project, c *domain.Catalog) { *c.Hardware[0].PackageSize = math.Inf(1) },
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
