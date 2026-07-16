package engine

import (
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func generatorsFixture() (domain.Catalog, domain.Project) {
	matInterior := domain.MaterialBoard{
		ID: "mat-int", Code: "TAB-INT", Name: "MDF Interior",
		CostPerM2: 100, GrainDefault: false, Active: true,
		DefaultEdgeBandID: "edge-1",
	}
	matFront := domain.MaterialBoard{
		ID: "mat-front", Code: "TAB-FRONT", Name: "Melamina Frente",
		CostPerM2: 150, GrainDefault: true, Active: true,
		DefaultEdgeBandID: "edge-1",
	}
	edge := domain.EdgeBand{
		ID: "edge-1", Code: "CAN-1", Name: "Canto", CostPerMl: 5, Active: true,
	}
	hwA := domain.Hardware{
		ID: "hw-a", Code: "HER-A", Name: "Bisagra",
		Unit: domain.UnitPiece, CostPerUnit: 10, Active: true,
	}
	hwB := domain.Hardware{
		ID: "hw-b", Code: "HER-B", Name: "Jaladera",
		Unit: domain.UnitPiece, CostPerUnit: 20, Active: true,
	}

	modGab := domain.Module{
		ID: "mod-gab", Code: "MOD-GAB-01", Name: "Gabinete", BaseLaborCost: 50,
		BoardParts: []domain.BoardPart{
			{
				ID: "p-side", Code: "MOD-GAB-01-P01", Description: "Costado",
				Quantity: 2, LengthMm: 720, WidthMm: 590,
				Edges: []domain.EdgeAssignment{
					{Side: "L1", Enabled: true}, {Side: "L2", Enabled: true},
					{Side: "W1", Enabled: true}, {Side: "W2", Enabled: true},
				},
				OptionRole: "INTERIOR",
			},
			{
				ID: "p-door", Code: "MOD-GAB-01-P08", Description: "Puerta",
				Quantity: 1, LengthMm: 700, WidthMm: 400,
				Edges: []domain.EdgeAssignment{
					{Side: "L1", Enabled: true}, {Side: "L2", Enabled: true},
					{Side: "W1", Enabled: true}, {Side: "W2", Enabled: true},
				},
				OptionRole: "EXTERIOR",
			},
		},
		HardwareLines: []domain.HardwareLine{
			{ID: "h1", Quantity: 2, OptionRole: "BISAGRA"},
			{ID: "h2", Quantity: 1, OptionRole: "JALADERA"},
		},
	}

	// Second module with earlier code for sort test (MOD-CAJ < MOD-GAB).
	modCaj := domain.Module{
		ID: "mod-caj", Code: "MOD-CAJ-01", Name: "Cajon", BaseLaborCost: 20,
		BoardParts: []domain.BoardPart{
			{
				ID: "p-front", Code: "MOD-CAJ-01-P01", Description: "Frente Cajon",
				Quantity: 1, LengthMm: 500, WidthMm: 150,
				Edges: validEdges(),
				OptionRole: "EXTERIOR",
			},
		},
		HardwareLines: []domain.HardwareLine{
			{ID: "h3", Quantity: 2, HardwareID: "hw-a"}, // fixed id, no role choice
		},
	}

	catalog := domain.Catalog{
		Materials: []domain.MaterialBoard{matInterior, matFront},
		Edges:     []domain.EdgeBand{edge},
		Hardware:  []domain.Hardware{hwA, hwB},
		Modules:   []domain.Module{modGab, modCaj},
		OptionGroups: []domain.OptionGroup{
			{ID: "g1", Code: "INTERIOR", Name: "Int", Kind: "board", Required: true, OptionIDs: []string{"mat-int"}},
			{ID: "g2", Code: "EXTERIOR", Name: "Ext", Kind: "board", Required: true, OptionIDs: []string{"mat-front"}},
			{ID: "g3", Code: "BISAGRA", Name: "Bis", Kind: "hardware", Required: true, OptionIDs: []string{"hw-a"}},
			{ID: "g4", Code: "JALADERA", Name: "Jal", Kind: "hardware", Required: true, OptionIDs: []string{"hw-b"}},
		},
	}

	choices := map[string]string{
		"INTERIOR": "mat-int",
		"EXTERIOR": "mat-front",
		"BISAGRA":  "hw-a",
		"JALADERA": "hw-b",
	}

	project := domain.Project{
		ID: "proj-1", Name: "Test", CustomerID: "c", Currency: "MXN",
		MarginFactor: 1.35, LaborFixedCost: 100, Status: domain.StatusDraft,
		Items: []domain.ProjectItem{
			{ID: "i-gab", ModuleID: "mod-gab", Quantity: 1, OptionChoices: choices},
			{ID: "i-caj", ModuleID: "mod-caj", Quantity: 1, OptionChoices: choices},
		},
	}
	return catalog, project
}

func TestResolveBom_GrainInheritedFromMaterial(t *testing.T) {
	catalog, project := generatorsFixture()
	module, _ := findModule(catalog, "mod-gab")
	bom, err := ResolveBom(module, project.Items[0].OptionChoices, catalog)
	if err != nil {
		t.Fatal(err)
	}
	var side, door *domain.ResolvedBoardPart
	for i := range bom.BoardParts {
		p := &bom.BoardParts[i]
		if p.Code == "MOD-GAB-01-P01" {
			side = p
		}
		if p.Code == "MOD-GAB-01-P08" {
			door = p
		}
	}
	if side == nil || door == nil {
		t.Fatal("expected side and door parts")
	}
	if side.Grain != domain.GrainNone {
		t.Errorf("interior grain: got %d want 0", side.Grain)
	}
	if door.Grain != domain.GrainYes {
		t.Errorf("front grain: got %d want 1", door.Grain)
	}
	if side.MaterialID != "mat-int" || door.MaterialID != "mat-front" {
		t.Errorf("material resolution failed: side=%s door=%s", side.MaterialID, door.MaterialID)
	}
	if side.EdgeBandID != "edge-1" {
		t.Errorf("edge from material default: got %q", side.EdgeBandID)
	}
}

func TestGenerateCutRows_MultipliesAndSorts(t *testing.T) {
	catalog, project := generatorsFixture()
	project.Items = []domain.ProjectItem{
		{
			ID: "i-gab", ModuleID: "mod-gab", Quantity: 3,
			OptionChoices: project.Items[0].OptionChoices,
		},
	}

	rows, err := GenerateCutRows(project, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 board rows, got %d", len(rows))
	}
	// Sorted by part code: P01 before P08; F048 descriptions include codes
	if rows[0].PartName != "Costado" || rows[1].PartName != "Puerta" {
		t.Errorf("sort order part names: %q then %q", rows[0].PartName, rows[1].PartName)
	}
	if !strings.Contains(rows[0].Description, "Costado") || !strings.Contains(rows[0].Description, "MOD-GAB") {
		t.Errorf("enriched description: %q", rows[0].Description)
	}
	// part qty 2 × item qty 3 = 6
	if rows[0].Quantity != 6 {
		t.Errorf("Costado qty: got %d want 6", rows[0].Quantity)
	}
	if rows[1].Quantity != 3 {
		t.Errorf("Puerta qty: got %d want 3", rows[1].Quantity)
	}
	if rows[0].MaterialName != "MDF Interior" {
		t.Errorf("material name: %q", rows[0].MaterialName)
	}
	if rows[1].Grain != domain.GrainYes {
		t.Errorf("puerta grain: got %d want 1", rows[1].Grain)
	}
	if rows[0].L1 != 1 || rows[0].L2 != 1 || rows[0].W1 != 1 || rows[0].W2 != 1 {
		t.Errorf("edge flags: L1=%d L2=%d W1=%d W2=%d", rows[0].L1, rows[0].L2, rows[0].W1, rows[0].W2)
	}
}

func TestGenerateCutRows_SortsByModuleCode(t *testing.T) {
	catalog, project := generatorsFixture()
	rows, err := GenerateCutRows(project, catalog)
	if err != nil {
		t.Fatal(err)
	}
	// MOD-CAJ-01 before MOD-GAB-01
	if rows[0].PartName != "Frente Cajon" && !strings.Contains(rows[0].Description, "Frente Cajon") {
		t.Errorf("first row should be CAJ frente, got part=%q desc=%q", rows[0].PartName, rows[0].Description)
	}
}

func TestFormatOptimizerPartDescription(t *testing.T) {
	got := FormatOptimizerPartDescription("MOD-GAB-01", "Costado", "P01")
	want := "P01 · Costado · MOD-GAB-01"
	if got != want {
		t.Errorf("got %q want %q", got, want)
	}
	got2 := FormatOptimizerPartDescription("MOD-X", "Pieza", "")
	if got2 != "Pieza · MOD-X" {
		t.Errorf("no code: %q", got2)
	}
}

func TestGenerateCutRows_NoHardwareAndEmptyError(t *testing.T) {
	catalog, project := generatorsFixture()
	rows, err := GenerateCutRows(project, catalog)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if strings.Contains(strings.ToLower(r.Description), "bisagra") {
			t.Error("cut rows must never include hardware")
		}
	}

	// Hardware-only module → VAL-05
	hwOnly := domain.Module{
		ID: "mod-hw", Code: "MOD-HW", Name: "HW only",
		BoardParts: nil,
		HardwareLines: []domain.HardwareLine{
			{ID: "h", Quantity: 1, HardwareID: "hw-a"},
		},
	}
	catalog.Modules = []domain.Module{hwOnly}
	project.Items = []domain.ProjectItem{
		{ID: "i", ModuleID: "mod-hw", Quantity: 1, OptionChoices: map[string]string{}},
	}
	_, err = GenerateCutRows(project, catalog)
	if err == nil || !strings.Contains(err.Error(), "no hay piezas de tablero") {
		t.Fatalf("expected empty board parts error, got %v", err)
	}
}

func TestGenerateHardwareList_AggregateMultiplySort(t *testing.T) {
	catalog, project := generatorsFixture()
	// GAB only
	project.Items = project.Items[:1]

	rows, err := GenerateHardwareList(project, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 hardware rows, got %d", len(rows))
	}
	// Sorted by code: HER-A before HER-B
	if rows[0].Code != "HER-A" || rows[1].Code != "HER-B" {
		t.Errorf("sort: %s, %s", rows[0].Code, rows[1].Code)
	}
	if rows[0].Quantity != 2 || rows[0].LineCost != 20 {
		t.Errorf("bisagra: qty=%d line=%v", rows[0].Quantity, rows[0].LineCost)
	}
	if rows[1].Quantity != 1 || rows[1].LineCost != 20 {
		t.Errorf("jaladera: qty=%d line=%v", rows[1].Quantity, rows[1].LineCost)
	}

	// item qty ×3
	project.Items[0].Quantity = 3
	rows, err = GenerateHardwareList(project, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if rows[0].Quantity != 6 || rows[0].LineCost != 60 {
		t.Errorf("bisagra×3: qty=%d line=%v", rows[0].Quantity, rows[0].LineCost)
	}
}

func TestGenerateHardwareList_EmptyError(t *testing.T) {
	catalog, project := generatorsFixture()
	catalog.Modules[0].HardwareLines = nil
	catalog.Modules[1].HardwareLines = nil
	_, err := GenerateHardwareList(project, catalog)
	if err == nil || !strings.Contains(err.Error(), "no hay herrajes") {
		t.Fatalf("expected empty hardware error, got %v", err)
	}
}

func TestCaptureQuoteSnapshot_AndTransition(t *testing.T) {
	catalog, project := generatorsFixture()
	at := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)

	snap, err := CaptureQuoteSnapshot(project, catalog, at)
	if err != nil {
		t.Fatal(err)
	}
	if !snap.CapturedAt.Equal(at) {
		t.Errorf("capturedAt: got %v", snap.CapturedAt)
	}
	if snap.Breakdown.SalePrice <= 0 {
		t.Error("expected positive sale price in snapshot")
	}
	if _, ok := snap.MaterialCostPerM2["mat-int"]; !ok {
		t.Error("expected material unit price in snapshot")
	}
	if _, ok := snap.HardwareCostPerUnit["hw-a"]; !ok {
		t.Error("expected hardware unit price in snapshot")
	}

	// draft → quoted attaches snapshot
	closed, err := TransitionProjectStatus(project, domain.StatusQuoted, catalog, at)
	if err != nil {
		t.Fatal(err)
	}
	if closed.Status != domain.StatusQuoted || closed.PriceSnapshot == nil {
		t.Fatal("expected quoted with snapshot")
	}
	frozenSale := closed.PriceSnapshot.Breakdown.SalePrice

	// Raise catalog prices — closed breakdown must stay frozen via CalcProjectBreakdown
	catalog.Materials[0].CostPerM2 = 9999
	catalog.Hardware[0].CostPerUnit = 9999
	bd, err := CalcProjectBreakdown(closed, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if bd.SalePrice != frozenSale {
		t.Errorf("frozen sale: got %v want %v", bd.SalePrice, frozenSale)
	}

	// quoted → accepted keeps same snapshot
	accepted, err := TransitionProjectStatus(closed, domain.StatusAccepted, catalog, at)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.PriceSnapshot == nil || accepted.PriceSnapshot.Breakdown.SalePrice != frozenSale {
		t.Error("accepted should keep existing snapshot")
	}

	// accepted → draft clears snapshot
	reopened, err := TransitionProjectStatus(accepted, domain.StatusDraft, catalog, at)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.PriceSnapshot != nil {
		t.Error("reopened draft must drop snapshot")
	}
}

func TestCalcHardwareLineCost(t *testing.T) {
	catalog, _ := generatorsFixture()
	line := domain.ResolvedHardwareLine{ID: "h1", Quantity: 4, HardwareID: "hw-a"}
	cost, err := CalcHardwareLineCost(line, catalog, 2)
	if err != nil {
		t.Fatal(err)
	}
	// 4 × 2 × 10 = 80
	if cost.HardwareCost != 80 {
		t.Errorf("got %v want 80", cost.HardwareCost)
	}
}
