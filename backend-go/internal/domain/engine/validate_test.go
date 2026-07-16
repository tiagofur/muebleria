package engine

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func validEdges() []domain.EdgeAssignment {
	return []domain.EdgeAssignment{
		{Side: "L1", Enabled: false},
		{Side: "L2", Enabled: false},
		{Side: "W1", Enabled: false},
		{Side: "W2", Enabled: false},
	}
}

func validPart(overrides ...func(*domain.BoardPart)) domain.BoardPart {
	p := domain.BoardPart{
		ID:          "part-1",
		Code:        "P-1",
		Description: "Costado",
		Quantity:    1,
		LengthMm:    800,
		WidthMm:     600,
		Edges:       validEdges(),
		OptionRole:  "INTERIOR",
	}
	for _, o := range overrides {
		o(&p)
	}
	return p
}

func validModule(overrides ...func(*domain.Module)) domain.Module {
	m := domain.Module{
		ID:            "mod-1",
		Code:          "MOD-TEST",
		Name:          "Test",
		BaseLaborCost: 0,
		BoardParts:    []domain.BoardPart{validPart()},
		HardwareLines: []domain.HardwareLine{
			{ID: "hwline-1", Quantity: 1, OptionRole: "BISAGRA"},
		},
	}
	for _, o := range overrides {
		o(&m)
	}
	return m
}

func TestValidateBoardPart_OK(t *testing.T) {
	if err := ValidateBoardPart(validPart(), "MOD"); err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
}

func TestValidateBoardPart_Dimensions(t *testing.T) {
	err := ValidateBoardPart(validPart(func(p *domain.BoardPart) { p.LengthMm = 0 }), "MOD")
	if err == nil || !strings.Contains(err.Error(), "dimensions must be > 0") {
		t.Fatalf("expected dimensions error, got %v", err)
	}
	err = ValidateBoardPart(validPart(func(p *domain.BoardPart) { p.WidthMm = -1 }), "MOD")
	if err == nil || !strings.Contains(err.Error(), "dimensions must be > 0") {
		t.Fatalf("expected dimensions error, got %v", err)
	}
}

func TestValidateBoardPart_Quantity(t *testing.T) {
	err := ValidateBoardPart(validPart(func(p *domain.BoardPart) { p.Quantity = 0 }), "MOD")
	if err == nil || !strings.Contains(err.Error(), "quantity must be > 0") {
		t.Fatalf("expected quantity error, got %v", err)
	}
}

func TestValidateBoardPart_EdgesCount(t *testing.T) {
	err := ValidateBoardPart(validPart(func(p *domain.BoardPart) {
		p.Edges = p.Edges[:3]
	}), "MOD")
	if err == nil || !strings.Contains(err.Error(), "exactly 4 edge") {
		t.Fatalf("expected 4-edges error, got %v", err)
	}
}

func TestValidateBoardPart_MissingSide(t *testing.T) {
	err := ValidateBoardPart(validPart(func(p *domain.BoardPart) {
		p.Edges = []domain.EdgeAssignment{
			{Side: "L1", Enabled: true},
			{Side: "L2", Enabled: true},
			{Side: "W1", Enabled: true},
			{Side: "L1", Enabled: false}, // duplicate L1, missing W2
		}
	}), "MOD")
	if err == nil {
		t.Fatal("expected error for missing/duplicate sides")
	}
}

func TestValidateBoardPart_UnknownSide(t *testing.T) {
	err := ValidateBoardPart(validPart(func(p *domain.BoardPart) {
		p.Edges = []domain.EdgeAssignment{
			{Side: "L1", Enabled: true},
			{Side: "L2", Enabled: true},
			{Side: "W1", Enabled: true},
			{Side: "L3", Enabled: true}, // typo — must not silently contribute 0
		}
	}), "MOD")
	if err == nil || !strings.Contains(err.Error(), "unknown edge side") {
		t.Fatalf("expected unknown side error, got %v", err)
	}
}

func TestValidateHardwareLine_Quantity(t *testing.T) {
	err := ValidateHardwareLine(domain.HardwareLine{ID: "h", Quantity: 0, OptionRole: "X"}, "MOD")
	if err == nil || !strings.Contains(err.Error(), "quantity must be > 0") {
		t.Fatalf("expected quantity error, got %v", err)
	}
}

func TestValidateModule_EmptyCodeName(t *testing.T) {
	err := ValidateModule(validModule(func(m *domain.Module) { m.Code = "  " }))
	if err == nil || !strings.Contains(err.Error(), "code must not be empty") {
		t.Fatalf("expected empty code error, got %v", err)
	}
	err = ValidateModule(validModule(func(m *domain.Module) { m.Name = "" }))
	if err == nil || !strings.Contains(err.Error(), "name must not be empty") {
		t.Fatalf("expected empty name error, got %v", err)
	}
}

func TestValidateModule_HardwareNeedsRoleOrID(t *testing.T) {
	err := ValidateModule(validModule(func(m *domain.Module) {
		m.HardwareLines = []domain.HardwareLine{{ID: "h", Quantity: 1}}
	}))
	if err == nil || !strings.Contains(err.Error(), "optionRole or fixed hardwareId") {
		t.Fatalf("expected hardware identity error, got %v", err)
	}
}

func TestCalcBoardLineCost_RejectsInactiveEdgeBand(t *testing.T) {
	material := domain.MaterialBoard{ID: "mat-1", Code: "TAB-1", CostPerM2: 100, Active: true}
	part := validPart(func(p *domain.BoardPart) {
		p.Edges = []domain.EdgeAssignment{
			{Side: "L1", Enabled: true},
			{Side: "L2", Enabled: false},
			{Side: "W1", Enabled: false},
			{Side: "W2", Enabled: false},
		}
	})
	inactive := &domain.EdgeBand{ID: "edge-off", Code: "CAN-OFF", CostPerMl: 10, Active: false}

	_, err := CalcBoardLineCost(part, material, inactive, 1)
	if err == nil || !strings.Contains(err.Error(), "inactive edge band") {
		t.Fatalf("expected inactive edge error, got %v", err)
	}
}

func TestCalcBoardLineCost_RejectsInactiveMaterial(t *testing.T) {
	material := domain.MaterialBoard{ID: "mat-1", Code: "TAB-OFF", CostPerM2: 100, Active: false}
	_, err := CalcBoardLineCost(validPart(), material, nil, 1)
	if err == nil || !strings.Contains(err.Error(), "inactive material") {
		t.Fatalf("expected inactive material error, got %v", err)
	}
}

func TestCalcProjectBreakdown_RejectsZeroItemQuantity(t *testing.T) {
	catalog, project := minimalQuoteFixture()
	project.Items[0].Quantity = 0

	_, err := CalcProjectBreakdown(project, catalog)
	if err == nil || !strings.Contains(err.Error(), "project item quantity must be > 0") {
		t.Fatalf("expected item qty error, got %v", err)
	}
}

func TestCalcProjectBreakdown_RejectsMalformedModuleEdges(t *testing.T) {
	catalog, project := minimalQuoteFixture()
	catalog.Modules[0].BoardParts[0].Edges = []domain.EdgeAssignment{
		{Side: "L1", Enabled: true},
		{Side: "L2", Enabled: true},
		{Side: "W1", Enabled: true},
		// missing W2 — incomplete structure
	}

	_, err := CalcProjectBreakdown(project, catalog)
	if err == nil || !strings.Contains(err.Error(), "exactly 4 edge") {
		t.Fatalf("expected edges structure error, got %v", err)
	}
}

func TestCalcProjectBreakdown_RejectsUnknownEdgeSideInModule(t *testing.T) {
	catalog, project := minimalQuoteFixture()
	catalog.Modules[0].BoardParts[0].Edges = []domain.EdgeAssignment{
		{Side: "L1", Enabled: true},
		{Side: "L2", Enabled: true},
		{Side: "W1", Enabled: true},
		{Side: "L3", Enabled: true},
	}

	_, err := CalcProjectBreakdown(project, catalog)
	if err == nil || !strings.Contains(err.Error(), "unknown edge side") {
		t.Fatalf("expected unknown side error, got %v", err)
	}
}

func TestCalcProjectBreakdown_RejectsZeroPartQuantity(t *testing.T) {
	catalog, project := minimalQuoteFixture()
	catalog.Modules[0].BoardParts[0].Quantity = 0

	_, err := CalcProjectBreakdown(project, catalog)
	if err == nil || !strings.Contains(err.Error(), "board part quantity must be > 0") {
		t.Fatalf("expected part qty error, got %v", err)
	}
}

// minimalQuoteFixture builds a valid single-item quote used by rejection tests.
func minimalQuoteFixture() (domain.Catalog, domain.Project) {
	material := domain.MaterialBoard{
		ID: "mat-1", Code: "TAB-1", Name: "MDF", CostPerM2: 160, Active: true,
	}
	hardware := domain.Hardware{
		ID: "hw-1", Code: "HER-1", Name: "Bisagra", Unit: domain.UnitPiece, CostPerUnit: 25, Active: true,
	}
	catalog := domain.Catalog{
		Materials: []domain.MaterialBoard{material},
		Hardware:  []domain.Hardware{hardware},
		Modules: []domain.Module{
			{
				ID:            "mod-1",
				Code:          "MOD-GAB-01",
				Name:          "Gabinete",
				BaseLaborCost: 100,
				BoardParts:    []domain.BoardPart{validPart()},
				HardwareLines: []domain.HardwareLine{
					{ID: "hwline-1", Quantity: 2, OptionRole: "BISAGRA"},
				},
			},
		},
		OptionGroups: []domain.OptionGroup{
			{ID: "g-int", Code: "INTERIOR", Name: "Interior", Kind: "board", Required: true, OptionIDs: []string{"mat-1"}},
			{ID: "g-hw", Code: "BISAGRA", Name: "Bisagra", Kind: "hardware", Required: true, OptionIDs: []string{"hw-1"}},
		},
	}
	project := domain.Project{
		ID: "proj-1", Name: "P", CustomerID: "c", Currency: "MXN",
		MarginFactor: 1.35, LaborFixedCost: 0, Status: domain.StatusDraft,
		Items: []domain.ProjectItem{
			{
				ID: "item-1", ModuleID: "mod-1", Quantity: 1,
				OptionChoices: map[string]string{"INTERIOR": "mat-1", "BISAGRA": "hw-1"},
			},
		},
	}
	return catalog, project
}
