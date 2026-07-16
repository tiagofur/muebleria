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

	assertClose := func(name string, got, want float64) {
		t.Helper()
		if math.Abs(got-want) > 1e-9 {
			t.Errorf("%s: got %v, want %v", name, got, want)
		}
	}
	assertClose("MaterialsCost", breakdown.MaterialsCost, 153.6)
	assertClose("HardwareTotal", breakdown.HardwareTotal, 200.0)
	assertClose("DirectCost", breakdown.DirectCost, 353.6)
	assertClose("LaborModular", breakdown.LaborModular, 700.0)
	// Raw float path (no Round): sale = 353.6*1.35 + 700 + 200
	assertClose("SalePrice", breakdown.SalePrice, 353.6*1.35+700+200)
}

// TestCalcProjectBreakdown_NoIntermediateRounding locks issue #7:
// domain engines must NOT round to 2 decimals; only presentation/export may.
// Uses costs that produce >2 fractional digits so Round(x*100)/100 would diverge.
func TestCalcProjectBreakdown_NoIntermediateRounding(t *testing.T) {
	material := domain.MaterialBoard{
		ID:        "mat-1",
		Code:      "TAB-1",
		Name:      "MDF",
		CostPerM2: 160.333, // yields non-2-decimal board cost
		Active:    true,
	}
	hardware := domain.Hardware{
		ID:          "hw-1",
		Code:        "HER-1",
		Name:        "Bisagra",
		Unit:        domain.UnitPiece,
		CostPerUnit: 7.777,
		Active:      true,
	}
	edge := domain.EdgeBand{
		ID:        "edge-1",
		Code:      "CAN-1",
		Name:      "Canto",
		CostPerMl: 3.333,
		Active:    true,
	}

	catalog := domain.Catalog{
		Materials: []domain.MaterialBoard{material},
		Hardware:  []domain.Hardware{hardware},
		Edges:     []domain.EdgeBand{edge},
		Modules: []domain.Module{
			{
				ID:            "mod-1",
				Code:          "MOD-TEST",
				Name:          "Test",
				BaseLaborCost: 100.111,
				BoardParts: []domain.BoardPart{
					{
						ID:          "part-1",
						Description: "Panel",
						Quantity:    1,
						LengthMm:    800,
						WidthMm:     600, // 0.48 m2
						Edges: []domain.EdgeAssignment{
							{Side: "L1", Enabled: true},
							{Side: "L2", Enabled: false},
							{Side: "W1", Enabled: true},
							{Side: "W2", Enabled: false},
						},
						OptionRole: "INTERIOR",
					},
				},
				HardwareLines: []domain.HardwareLine{
					{ID: "hwline-1", Quantity: 3, OptionRole: "BISAGRA"},
				},
			},
		},
		OptionGroups: []domain.OptionGroup{
			{ID: "g-int", Code: "INTERIOR", Name: "Interior", Kind: "board", Required: true, OptionIDs: []string{"mat-1"}},
			{ID: "g-hw", Code: "BISAGRA", Name: "Bisagra", Kind: "hardware", Required: true, OptionIDs: []string{"hw-1"}},
			{ID: "g-edge", Code: "EDGE", Name: "Canto", Kind: "edge", Required: false, OptionIDs: []string{"edge-1"}},
		},
	}

	project := domain.Project{
		ID:             "proj-1",
		Name:           "No-round",
		CustomerID:     "cust-1",
		Currency:       "MXN",
		MarginFactor:   1.35,
		LaborFixedCost: 50.555,
		Status:         domain.StatusDraft,
		Items: []domain.ProjectItem{
			{
				ID:       "item-1",
				ModuleID: "mod-1",
				Quantity: 1,
				OptionChoices: map[string]string{
					"INTERIOR": "mat-1",
					"BISAGRA":  "hw-1",
					"EDGE":     "edge-1",
				},
			},
		},
	}

	// Raw expected (no Round):
	// area = 0.48 → materials = 0.48 * 160.333 = 76.95984
	// edge ml: L1 0.8 + W1 0.6 = 1.4 → edge = 1.4 * 3.333 = 4.6662
	// hardware = 3 * 7.777 = 23.331
	// direct = 76.95984 + 4.6662 + 23.331 = 104.95704
	// laborModular = 100.111
	// sale = 104.95704*1.35 + 100.111 + 50.555 = 292.358004
	const (
		wantMaterials = 76.95984
		wantEdge      = 4.6662
		wantHardware  = 23.331
		wantDirect    = 104.95704
		wantLabor     = 100.111
		wantSale      = 292.358004
	)

	breakdown, err := CalcProjectBreakdown(project, catalog)
	if err != nil {
		t.Fatal(err)
	}

	assertClose := func(name string, got, want float64) {
		t.Helper()
		if math.Abs(got-want) > 1e-9 {
			t.Errorf("%s: got %v, want %v (diff %v)", name, got, want, got-want)
		}
	}
	assertClose("MaterialsCost", breakdown.MaterialsCost, wantMaterials)
	assertClose("EdgeTotal", breakdown.EdgeTotal, wantEdge)
	assertClose("HardwareTotal", breakdown.HardwareTotal, wantHardware)
	assertClose("DirectCost", breakdown.DirectCost, wantDirect)
	assertClose("LaborModular", breakdown.LaborModular, wantLabor)
	assertClose("SalePrice", breakdown.SalePrice, wantSale)

	// Algebraic identity must hold on raw floats (fails if components and total are rounded separately).
	sumParts := breakdown.MaterialsCost + breakdown.EdgeTotal + breakdown.HardwareTotal
	if math.Abs(sumParts-breakdown.DirectCost) > 1e-12 {
		t.Errorf("DirectCost %v != sum of components %v", breakdown.DirectCost, sumParts)
	}

	// Guard: values must NOT equal their 2-decimal rounded form (proves we keep precision).
	if breakdown.MaterialsCost == math.Round(wantMaterials*100)/100 {
		t.Error("MaterialsCost appears rounded to 2 decimals — parity with TS broken")
	}
	if breakdown.SalePrice == math.Round(wantSale*100)/100 {
		t.Error("SalePrice appears rounded to 2 decimals — parity with TS broken")
	}
}
