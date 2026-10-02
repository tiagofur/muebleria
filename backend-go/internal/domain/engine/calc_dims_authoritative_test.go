package engine

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #974: the design commercial projection prices the placed physical truth.
// The SketchUp working copy carries explicit dims and no preset field, so a
// preset-bearing module must estimate from those dims instead of failing the
// commercial preset gate — while quotation keeps demanding a preset.

func TestCalcProjectBreakdownDimsAuthoritativeSkipsPresetGate(t *testing.T) {
	catalog := customDimsTestCatalog()
	project := domain.Project{
		ID: "prj", Name: "p", CustomerID: "c", Currency: "UYU",
		MarginFactor: 1.5, Status: domain.StatusDraft,
		Items: []domain.ProjectItem{{
			ID: "i1", ModuleID: "m1", Quantity: 1,
			OptionChoices:     map[string]string{"INTERIOR": "mat"},
			CustomDims:        &domain.ItemCustomDims{WidthMm: 900, HeightMm: 800, DepthMm: 500},
			DimsAuthoritative: true,
		}},
	}

	bd, err := CalcProjectBreakdown(project, catalog)
	if err != nil {
		t.Fatalf("dims-authoritative breakdown: %v", err)
	}
	// Same math as the preset+override case: 0.9×0.8 m² × 100 = 72.
	if want := 72.0; abs64(bd.MaterialsCost-want) > 0.01 {
		t.Errorf("materials = %v, want %v (placed dims must drive the estimate)", bd.MaterialsCost, want)
	}
}

func TestCalcProjectBreakdownPresetGateIntactForQuotation(t *testing.T) {
	catalog := customDimsTestCatalog()
	project := domain.Project{
		ID: "prj", Name: "p", CustomerID: "c", Currency: "UYU",
		MarginFactor: 1.5, Status: domain.StatusDraft,
		Items: []domain.ProjectItem{{
			ID: "i1", ModuleID: "m1", Quantity: 1,
			OptionChoices: map[string]string{"INTERIOR": "mat"},
			CustomDims:    &domain.ItemCustomDims{WidthMm: 900, HeightMm: 800, DepthMm: 500},
		}},
	}

	_, err := CalcProjectBreakdown(project, catalog)
	if err == nil || !strings.Contains(err.Error(), "elegí un preset de medida") {
		t.Fatalf("quotation preset gate must stay intact, got %v", err)
	}
}

func TestCalcProjectBreakdownDimsAuthoritativeRequiresExplicitDims(t *testing.T) {
	catalog := customDimsTestCatalog()
	project := domain.Project{
		ID: "prj", Name: "p", CustomerID: "c", Currency: "UYU",
		MarginFactor: 1.5, Status: domain.StatusDraft,
		Items: []domain.ProjectItem{{
			ID: "i1", ModuleID: "m1", Quantity: 1,
			OptionChoices:     map[string]string{"INTERIOR": "mat"},
			DimsAuthoritative: true,
		}},
	}

	_, err := CalcProjectBreakdown(project, catalog)
	if err == nil || !strings.Contains(err.Error(), "requiere dimensiones explícitas") {
		t.Fatalf("structured module without dims must fail closed, got %v", err)
	}
}

func TestCalcProjectBreakdownDimsAuthoritativeNonPresetModuleKeepsDims(t *testing.T) {
	catalog := customDimsTestCatalog()
	project := domain.Project{
		ID: "prj", Name: "p", CustomerID: "c", Currency: "UYU",
		MarginFactor: 1.5, Status: domain.StatusDraft,
		Items: []domain.ProjectItem{{
			ID: "i1", ModuleID: "m1", Quantity: 1,
			OptionChoices:     map[string]string{"INTERIOR": "mat"},
			CustomDims:        &domain.ItemCustomDims{WidthMm: 900, HeightMm: 800, DepthMm: 500},
			DimsAuthoritative: true,
			MeasurePresetID:   "", // module presets are ignored under the flag
		}},
	}
	// Strip the presets: same module shape without a commercial size menu.
	module := catalog.Modules[0]
	module.Presets = nil
	catalog.Modules = []domain.Module{module}

	bd, err := CalcProjectBreakdown(project, catalog)
	if err != nil {
		t.Fatalf("non-preset dims-authoritative breakdown: %v", err)
	}
	if want := 72.0; abs64(bd.MaterialsCost-want) > 0.01 {
		t.Errorf("materials = %v, want %v (placed dims, not module base size)", bd.MaterialsCost, want)
	}
}
