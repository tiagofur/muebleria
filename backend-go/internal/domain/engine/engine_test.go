package engine

import (
	"testing"
	"math"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestCalcMaterialCostPerM2(t *testing.T) {
	// Arauco Blanco 15mm: 1830 x 2440 mm, precio 714.43, 0% merma -> ~160.0
	cost := CalcMaterialCostPerM2(1830, 2440, 714.43, 0)
	if math.Abs(cost-160.0) > 0.01 {
		t.Errorf("expected ~160.0, got %f", cost)
	}

	// Con 10% merma -> 160 * 1.10 = 176
	costWithWaste := CalcMaterialCostPerM2(1830, 2440, 714.43, 10)
	if math.Abs(costWithWaste-176.0) > 0.01 {
		t.Errorf("expected ~176.0, got %f", costWithWaste)
	}
}

func TestCalcBoardLineCost(t *testing.T) {
	material := domain.MaterialBoard{
		ID:        "mat-1",
		Code:      "TAB-1",
		Name:      "MDF Blanco",
		CostPerM2: 160.0,
		Active:    true,
	}

	part := domain.BoardPart{
		ID:          "part-1",
		Code:        "P-1",
		Description: "Costado",
		Quantity:    2,
		LengthMm:    1000,
		WidthMm:     500,
		Grain:       0,
		Edges: []domain.EdgeAssignment{
			{Side: "L1", Enabled: true},
			{Side: "L2", Enabled: false},
			{Side: "W1", Enabled: true},
			{Side: "W2", Enabled: false},
		},
		OptionRole: "INTERIOR",
	}

	edge := domain.EdgeBand{
		ID:        "edge-1",
		Code:      "CAN-1",
		Name:      "Canto Blanco",
		CostPerMl: 10.0,
		Active:    true,
	}

	// 2 piezas de 1000x500 mm = 1.0 M2. Costo tablero = 1.0 * 160 = 160.0.
	// Cantos: L1 habilitado (1000mm) + W1 habilitado (500mm) = 1500mm por pieza.
	// Para 2 piezas: 3.0 ML de canto. Costo canto = 3.0 * 10 = 30.0.
	cost, err := CalcBoardLineCost(part, material, &edge, 1)
	if err != nil {
		t.Fatal(err)
	}

	if cost.AreaM2 != 1.0 {
		t.Errorf("expected AreaM2 = 1.0, got %f", cost.AreaM2)
	}
	if cost.EdgeMl != 3.0 {
		t.Errorf("expected EdgeMl = 3.0, got %f", cost.EdgeMl)
	}
	if cost.BoardCost != 160.0 {
		t.Errorf("expected BoardCost = 160.0, got %f", cost.BoardCost)
	}
	if cost.EdgeCost != 30.0 {
		t.Errorf("expected EdgeCost = 30.0, got %f", cost.EdgeCost)
	}
}

func TestCalcProjectBreakdown(t *testing.T) {
	material := domain.MaterialBoard{
		ID:        "mat-1",
		Code:      "TAB-1",
		Name:      "MDF Blanco",
		CostPerM2: 160.0,
		Active:    true,
	}

	hardware := domain.Hardware{
		ID:          "hw-1",
		Code:        "HER-1",
		Name:        "Bisagra",
		Unit:        domain.UnitPiece,
		CostPerUnit: 25.0,
		Active:      true,
	}

	catalog := domain.Catalog{
		Materials: []domain.MaterialBoard{material},
		Hardware:  []domain.Hardware{hardware},
		Modules: []domain.Module{
			{
				ID:            "mod-1",
				Code:          "MOD-GAB-01",
				Name:          "Gabinete",
				BaseLaborCost: 350.0,
				BoardParts: []domain.BoardPart{
					{
						ID:          "part-1",
						Description: "Techo",
						Quantity:    1,
						LengthMm:    800,
						WidthMm:     600,
						Grain:       0,
						Edges: []domain.EdgeAssignment{
							{Side: "L1", Enabled: false},
							{Side: "L2", Enabled: false},
							{Side: "W1", Enabled: false},
							{Side: "W2", Enabled: false},
						},
						OptionRole: "INTERIOR",
					},
				},
				HardwareLines: []domain.HardwareLine{
					{
						ID:         "hwline-1",
						Quantity:   4,
						OptionRole: "BISAGRA",
					},
				},
			},
		},
		OptionGroups: []domain.OptionGroup{
			{
				ID:        "g-interior",
				Code:      "INTERIOR",
				Name:      "Interior",
				Kind:      "board",
				Required:  true,
				OptionIDs: []string{"mat-1"},
			},
			{
				ID:        "g-bisagra",
				Code:      "BISAGRA",
				Name:      "Bisagra",
				Kind:      "hardware",
				Required:  true,
				OptionIDs: []string{"hw-1"},
			},
		},
	}

	project := domain.Project{
		ID:             "proj-1",
		Name:           "Proyecto Test",
		CustomerID:     "cust-1",
		Currency:       "MXN",
		MarginFactor:   1.35,
		LaborFixedCost: 200.0,
		Status:         domain.StatusDraft,
		Items: []domain.ProjectItem{
			{
				ID:       "item-1",
				ModuleID: "mod-1",
				Quantity: 2, // 2 Gabinetes
				OptionChoices: map[string]string{
					"INTERIOR": "mat-1",
					"BISAGRA":  "hw-1",
				},
			},
		},
	}

	// Cálculo manual esperado:
	// Para 1 Gabinete:
	// - Pieza 1: 800x600 = 0.48 M2. Costo tablero = 0.48 * 160 = 76.8
	// - Herraje: 4 Bisagras * 25 = 100
	// Para 2 Gabinetes:
	// - Tablero total = 2 * 76.8 = 153.6
	// - Herrajes total = 2 * 100 = 200.0
	// Costo Directo total = 153.6 + 200.0 = 353.6
	// Mano de obra modular total = 2 * 350 = 700.0
	// Mano de obra fija = 200.0
	// Factor margen = 1.35
	// Sale Price = (353.6 * 1.35) + 700.0 + 200.0 = 477.36 + 900.0 = 1377.36

	breakdown, err := CalcProjectBreakdown(project, catalog)
	if err != nil {
		t.Fatal(err)
	}

	if breakdown.MaterialsCost != 153.6 {
		t.Errorf("expected MaterialsCost = 153.6, got %f", breakdown.MaterialsCost)
	}
	if breakdown.HardwareTotal != 200.0 {
		t.Errorf("expected HardwareTotal = 200.0, got %f", breakdown.HardwareTotal)
	}
	if breakdown.DirectCost != 353.6 {
		t.Errorf("expected DirectCost = 353.6, got %f", breakdown.DirectCost)
	}
	if breakdown.LaborModular != 700.0 {
		t.Errorf("expected LaborModular = 700.0, got %f", breakdown.LaborModular)
	}
	if breakdown.SalePrice != 1377.36 {
		t.Errorf("expected SalePrice = 1377.36, got %f", breakdown.SalePrice)
	}
}
