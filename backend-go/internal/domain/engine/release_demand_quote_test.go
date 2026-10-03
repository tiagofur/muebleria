package engine

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// quoteProfileDemandParityContract is the shared pricing rule fixture the TS
// test consumes too: contracts/quoteProfileDemandParity.contract.json.
type quoteProfileDemandParityContract struct {
	Catalog struct {
		Hardware []parityFixtureHardware `json:"hardware"`
	} `json:"catalog"`
	Cases []struct {
		Name                  string                      `json:"name"`
		QuantityMultiplier    int                         `json:"quantityMultiplier"`
		ManualHardwareLines   []parityFixtureHardwareLine `json:"manualHardwareLines"`
		ProfileDemandLines    []HardwareProfileDemandLine `json:"profileDemandLines"`
		ExpectedHardwareTotal float64                     `json:"expectedHardwareTotal"`
	} `json:"cases"`
	FailClosed []struct {
		Name               string                      `json:"name"`
		QuantityMultiplier int                         `json:"quantityMultiplier"`
		ProfileDemandLines []HardwareProfileDemandLine `json:"profileDemandLines"`
	} `json:"failClosed"`
}

// parityFixtureHardware mirrors the fixture's camelCase hardware —
// domain.Hardware travels the wire snake_case and must not leak into the
// shared contract shape.
type parityFixtureHardware struct {
	ID          string  `json:"id"`
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Unit        string  `json:"unit"`
	CostPerUnit float64 `json:"costPerUnit"`
	Active      bool    `json:"active"`
}

// parityFixtureHardwareLine mirrors the fixture's camelCase manual line —
// domain.ResolvedHardwareLine travels the wire snake_case and must not leak
// into the shared contract shape.
type parityFixtureHardwareLine struct {
	ID         string  `json:"id"`
	Quantity   float64 `json:"quantity"`
	OptionRole string  `json:"optionRole"`
	HardwareID string  `json:"hardwareId"`
}

// TestQuoteProfileDemandParityContract pins the pricing RULE the breakdown
// wiring applies to demand lines: the same validation and unit price as manual
// lines, additive, one multiplier per item — byte-level peers with vitest.
func TestQuoteProfileDemandParityContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "quoteProfileDemandParity.contract.json"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture quoteProfileDemandParityContract
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	hardware := make([]domain.Hardware, 0, len(fixture.Catalog.Hardware))
	for _, hw := range fixture.Catalog.Hardware {
		hardware = append(hardware, domain.Hardware{
			ID: hw.ID, Code: hw.Code, Name: hw.Name,
			Unit: domain.HardwareUnit(hw.Unit), CostPerUnit: hw.CostPerUnit, Active: hw.Active,
		})
	}
	catalog := domain.Catalog{Hardware: hardware}
	for _, parityCase := range fixture.Cases {
		t.Run(parityCase.Name, func(t *testing.T) {
			total := 0.0
			for _, line := range parityCase.ManualHardwareLines {
				cost, err := CalcHardwareLineCost(domain.ResolvedHardwareLine{
					ID: line.ID, Quantity: line.Quantity, OptionRole: line.OptionRole, HardwareID: line.HardwareID,
				}, catalog, parityCase.QuantityMultiplier)
				if err != nil {
					t.Fatalf("manual line: %v", err)
				}
				total += cost.HardwareCost
			}
			for _, line := range parityCase.ProfileDemandLines {
				cost, err := CalcHardwareLineCost(domain.ResolvedHardwareLine{
					ID: line.HardwareID, Quantity: line.Quantity, HardwareID: line.HardwareID,
				}, catalog, parityCase.QuantityMultiplier)
				if err != nil {
					t.Fatalf("demand line: %v", err)
				}
				total += cost.HardwareCost
			}
			if math.Abs(total-parityCase.ExpectedHardwareTotal) > 1e-9 {
				t.Fatalf("hardware total = %v want %v", total, parityCase.ExpectedHardwareTotal)
			}
		})
	}
	for _, failCase := range fixture.FailClosed {
		t.Run("fail closed: "+failCase.Name, func(t *testing.T) {
			for _, line := range failCase.ProfileDemandLines {
				if _, err := CalcHardwareLineCost(domain.ResolvedHardwareLine{
					ID: line.HardwareID, Quantity: line.Quantity, HardwareID: line.HardwareID,
				}, catalog, failCase.QuantityMultiplier); err == nil {
					t.Fatalf("%s must fail closed", failCase.Name)
				}
			}
		})
	}
}

// #986 acceptance at the engine level: the governed resolve's profile demand
// prices through the same validation and unit price as manual lines — additive
// to the same hardware total, one quantity multiplier per item — and a project
// without demand is byte-identical to CalcProjectBreakdown.

func demandPricingWorld(t *testing.T) (domain.Project, domain.Catalog) {
	t.Helper()
	catalog := domain.Catalog{
		Materials: []domain.MaterialBoard{
			{ID: "mat-1", Code: "TAB-1", Name: "MDF Blanco", CostPerM2: 160.0, Active: true},
		},
		Hardware: []domain.Hardware{
			{ID: "hw-1", Code: "HER-1", Name: "Bisagra", Unit: domain.UnitPiece, CostPerUnit: 25.0, Active: true},
			{ID: "hw-prof", Code: "PRF-1", Name: "Minifix de perfil", Unit: domain.UnitPiece, CostPerUnit: 2.5, Active: true},
		},
		Modules: []domain.Module{
			{
				ID: "mod-1", Code: "MOD-GAB-01", Name: "Gabinete", BaseLaborCost: 350.0,
				BoardParts: []domain.BoardPart{
					{
						ID: "part-1", Description: "Techo", Quantity: 1, LengthMm: 800, WidthMm: 600,
						Edges: []domain.EdgeAssignment{
							{Side: "L1", Enabled: false}, {Side: "L2", Enabled: false},
							{Side: "W1", Enabled: false}, {Side: "W2", Enabled: false},
						},
						OptionRole: "INTERIOR",
					},
				},
				HardwareLines: []domain.HardwareLine{{ID: "hwline-1", Quantity: 4, OptionRole: "BISAGRA"}},
			},
		},
		OptionGroups: []domain.OptionGroup{
			{ID: "g-interior", Code: "INTERIOR", Name: "Interior", Kind: "board", Required: true, OptionIDs: []string{"mat-1"}},
			{ID: "g-bisagra", Code: "BISAGRA", Name: "Bisagra", Kind: "hardware", Required: true, OptionIDs: []string{"hw-1"}},
		},
	}
	project := domain.Project{
		ID: "proj-1", Name: "Proyecto Test", CustomerID: "cust-1", Currency: "MXN",
		MarginFactor: 1.35, LaborFixedCost: 200.0, Status: domain.StatusDraft,
		Items: []domain.ProjectItem{
			{
				ID: "item-1", ModuleID: "mod-1", Quantity: 2,
				OptionChoices: map[string]string{"INTERIOR": "mat-1", "BISAGRA": "hw-1"},
			},
		},
	}
	return project, catalog
}

func TestCalcProjectBreakdownWithProfileDemandPricesAdditively(t *testing.T) {
	project, catalog := demandPricingWorld(t)

	baseline, err := CalcProjectBreakdown(project, catalog)
	if err != nil {
		t.Fatal(err)
	}
	// Manual truth: hardware = 4 bisagras × 25 × 2 gabinetes = 200.
	if math.Abs(baseline.HardwareTotal-200.0) > 1e-9 {
		t.Fatalf("baseline HardwareTotal=%v want 200", baseline.HardwareTotal)
	}

	// The governed resolve demanded 4 minifix per unit: 4 × 2.5 × 2 = 20 joins
	// the SAME total — 220, one multiplier, no extra rounding stage.
	demand := [][]HardwareProfileDemandLine{
		{{HardwareID: "hw-prof", Quantity: 4, Sources: []HardwareProfileDemandSource{{
			TechnicalProfileID: "prof-1", TechnicalProfileRevision: "rev-1",
			RelationshipID: "rel-1", ContactCount: 2,
		}}}},
	}
	withDemand, err := CalcProjectBreakdownWithProfileDemand(project, catalog, demand)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(withDemand.HardwareTotal-220.0) > 1e-9 {
		t.Fatalf("HardwareTotal=%v want 220 (manual 200 + demand 4×2.5×2)", withDemand.HardwareTotal)
	}
	if math.Abs(withDemand.DirectCost-373.6) > 1e-9 {
		t.Fatalf("DirectCost=%v want 373.6", withDemand.DirectCost)
	}
	// Sale = (373.6 × 1.35) + 700 + 200 = 1404.36 — demand carries margin too.
	if math.Abs(withDemand.SalePrice-1404.36) > 1e-9 {
		t.Fatalf("SalePrice=%v want 1404.36", withDemand.SalePrice)
	}
}

func TestCalcProjectBreakdownWithoutDemandIsByteIdentical(t *testing.T) {
	project, catalog := demandPricingWorld(t)

	direct, err := CalcProjectBreakdown(project, catalog)
	if err != nil {
		t.Fatal(err)
	}
	nilMatrix, err := CalcProjectBreakdownWithProfileDemand(project, catalog, nil)
	if err != nil {
		t.Fatal(err)
	}
	shortMatrix, err := CalcProjectBreakdownWithProfileDemand(project, catalog, [][]HardwareProfileDemandLine{nil})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(direct, nilMatrix) || !reflect.DeepEqual(direct, shortMatrix) {
		t.Fatal("breakdown without demand entries must be byte-identical to CalcProjectBreakdown")
	}
}

func TestCalcProjectBreakdownWithProfileDemandFailsClosed(t *testing.T) {
	project, catalog := demandPricingWorld(t)
	for _, scenario := range []struct {
		name  string
		lines []HardwareProfileDemandLine
	}{
		{"ghost hardware", []HardwareProfileDemandLine{{HardwareID: "hw-ghost", Quantity: 1}}},
		{"zero quantity", []HardwareProfileDemandLine{{HardwareID: "hw-prof", Quantity: 0}}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			if _, err := CalcProjectBreakdownWithProfileDemand(project, catalog, [][]HardwareProfileDemandLine{scenario.lines}); err == nil {
				t.Fatal("demand pricing must fail closed on invalid demand hardware")
			}
		})
	}
}

func TestDeriveQuoteUnitProfileDemandSkipContract(t *testing.T) {
	item, catalog := releaseUnitFixture(t)
	profiles := &ReleaseServerInputs{
		ProfilesByID: map[string]domain.HardwareProfile{
			"prof-1": {ID: "prof-1", Revision: "rev-1"},
		},
	}

	if demand, err := DeriveQuoteUnitProfileDemand(item, catalog, nil); err != nil || demand != nil {
		t.Fatalf("nil server inputs must skip: demand=%v err=%v", demand, err)
	}
	if demand, err := DeriveQuoteUnitProfileDemand(item, catalog, &ReleaseServerInputs{}); err != nil || demand != nil {
		t.Fatalf("empty profiles must skip: demand=%v err=%v", demand, err)
	}
	versioned := item
	version := 3
	versioned.DefinitionVersion = &version
	if demand, err := DeriveQuoteUnitProfileDemand(versioned, catalog, profiles); err != nil || demand != nil {
		t.Fatalf("historical definition version must skip: demand=%v err=%v", demand, err)
	}
	unknown := item
	unknown.FurnitureDefinitionID = "mod-missing"
	if demand, err := DeriveQuoteUnitProfileDemand(unknown, catalog, profiles); err != nil || demand != nil {
		t.Fatalf("unknown definition must skip: demand=%v err=%v", demand, err)
	}
	// A structure module whose pricing authority carries no explicit placement
	// dims is exactly the unit the release path cannot derive either.
	dimless := item
	dimless.Parameters = map[string]any{"shelves": float64(2)}
	if demand, err := DeriveQuoteUnitProfileDemand(dimless, catalog, profiles); err != nil || demand != nil {
		t.Fatalf("structure module without explicit dims must skip: demand=%v err=%v", demand, err)
	}
}

func TestProjectItemAsDemandUnitInvertsCommercialDims(t *testing.T) {
	item := domain.ProjectItem{
		ID:            "line-1",
		ModuleID:      "mod-1",
		Quantity:      2,
		OptionChoices: map[string]string{"INTERIOR": "mat-1"},
		CustomDims:    &domain.ItemCustomDims{WidthMm: 600, HeightMm: 750, DepthMm: 500},
	}
	converted := ProjectItemAsDemandUnit(item)
	if converted.FurnitureInstanceID != "line-1" || converted.FurnitureDefinitionID != "mod-1" {
		t.Fatalf("identities = %+v", converted)
	}
	for name, want := range map[string]float64{"widthMm": 600, "heightMm": 750, "depthMm": 500} {
		got, ok := converted.Parameters[name].(float64)
		if !ok || got != want {
			t.Fatalf("parameter %s = %v want %v (inverse of CommercialDimsFromParameters)", name, converted.Parameters[name], want)
		}
	}
	// The round trip through the forward conversion must be exact.
	dims := domain.CommercialDimsFromParameters(converted.Parameters)
	if dims == nil || *dims != *item.CustomDims {
		t.Fatalf("round trip = %+v want %+v", dims, item.CustomDims)
	}
	if dims := domain.CommercialDimsFromParameters(ProjectItemAsDemandUnit(domain.ProjectItem{ID: "x", ModuleID: "m"}).Parameters); dims != nil {
		t.Fatalf("item without custom dims must not synthesize dims: %+v", dims)
	}
}
