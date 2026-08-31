package engine

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #442 — unit tests del tratamiento de base en Go (además del contract
// compartido): wiring del contexto efectivo en la vía de cotización y
// reglas de herraje que el fixture congela por escenario.

// baseParityCatalog builds a minimal floor-cabinet catalog: a composed
// module with NO zoclo component (synthesis path), adjustable-legs hardware
// with a 4 m strip profile, and front/body materials.
func baseParityCatalog(t *testing.T) domain.Catalog {
	t.Helper()
	fx := loadPlinthFixture(t)
	return fx.toDomainCatalog()
}

func baseParityModule(t *testing.T, c domain.Catalog, id string) domain.Module {
	t.Helper()
	for _, m := range c.Modules {
		if m.ID == id {
			return m
		}
	}
	t.Fatalf("module %s not found", id)
	return domain.Module{}
}

// CalcProjectBreakdown must honor the quote-line baseMode override end to
// end: `legs` synthesizes PATAS (with a choice) and drops the board plinth,
// `none` drops the whole base.
func TestCalcProjectBreakdown_HonorsItemBaseMode(t *testing.T) {
	catalog := baseParityCatalog(t)
	module := baseParityModule(t, catalog, "m-bajo")

	newProject := func(baseMode string) domain.Project {
		return domain.Project{
			ID:           "p-442",
			MarginFactor: 1.5,
			Items: []domain.ProjectItem{{
				ID:       "item-1",
				ModuleID: "m-bajo",
				Quantity: 1,
				OptionChoices: map[string]string{
					"FRENTE": "mat-front",
					"INTERIOR": "mat-body",
					"PATAS":   "hw-patas",
				},
				BaseMode: baseMode,
			}},
		}
	}

	legsBom, err := CalcProjectBreakdown(newProject("legs"), catalog)
	if err != nil {
		t.Fatalf("legs breakdown: %v", err)
	}
	noneBom, err := CalcProjectBreakdown(newProject("none"), catalog)
	if err != nil {
		t.Fatalf("none breakdown: %v", err)
	}

	// legs: 4 patas × $5 = $20 de herraje; sin pieza ZOCLO-AUTO.
	if legsBom.HardwareTotal != 20 {
		t.Errorf("legs hardware total: got %v, want 20 (4 patas × 5)", legsBom.HardwareTotal)
	}
	// none: sin base → sin herraje sintetizado.
	if noneBom.HardwareTotal != 0 {
		t.Errorf("none hardware total: got %v, want 0", noneBom.HardwareTotal)
	}
	// El módulo es plinth_board por catálogo: none filtra/suprime la base que
	// legs también suprime (sólo cambia el herraje) — ambas difieren del
	// default plinth_board, que sintetiza la pieza.
	boardBom, err := CalcProjectBreakdown(newProject(""), catalog)
	if err != nil {
		t.Fatalf("default breakdown: %v", err)
	}
	if boardBom.MaterialsCost <= noneBom.MaterialsCost {
		t.Errorf(
			"plinth_board default debe costear el zócalo sintetizado (got %v vs none %v)",
			boardBom.MaterialsCost, noneBom.MaterialsCost,
		)
	}
	_ = module
}

// A wall-elevation placement yields B=0: no synthesized plinth even though
// the module is plinth_board (plan wins over the module default).
func TestCalcProjectBreakdown_WallElevationSuppressesPlinth(t *testing.T) {
	catalog := baseParityCatalog(t)
	project := domain.Project{
		ID:           "p-442-wall",
		MarginFactor: 1.5,
		KitchenLayout: []byte(`{
			"walls": [ { "id": "w-1", "lengthMm": 3000 } ],
			"placements": [
				{ "itemId": "item-1", "instanceIndex": 0, "wallId": "w-1", "offsetMm": 0, "elevation": "wall" }
			]
		}`),
		Items: []domain.ProjectItem{{
			ID:       "item-1",
			ModuleID: "m-bajo",
			Quantity: 1,
			OptionChoices: map[string]string{
				"FRENTE":   "mat-front",
				"INTERIOR": "mat-body",
			},
		}},
	}

	breakdown, err := CalcProjectBreakdown(project, catalog)
	if err != nil {
		t.Fatalf("breakdown: %v", err)
	}

	// Sin patas elegidas y B=0 → herraje 0 y materiales = sólo laterales.
	if breakdown.HardwareTotal != 0 {
		t.Errorf("wall elevation: hardware total: got %v, want 0", breakdown.HardwareTotal)
	}
}

// Malformed kitchen layouts fail loudly — silently ignoring a corrupt plan
// would let the quote diverge from what the user sees.
func TestResolveBaseContextForItem_RejectsMalformedLayout(t *testing.T) {
	project := domain.Project{KitchenLayout: []byte(`{"walls": `)}
	item := domain.ProjectItem{ID: "item-1"}
	if _, err := ResolveBaseContextForItem(project, item, nil); err == nil {
		t.Fatal("expected malformed kitchen layout to fail loudly")
	}
}

func TestSuggestLegCount(t *testing.T) {
	cases := []struct {
		width, want int
	}{{0, 0}, {600, 4}, {601, 6}, {800, 6}}
	for _, c := range cases {
		if got := suggestLegCount(c.width); got != c.want {
			t.Errorf("suggestLegCount(%d): got %d, want %d", c.width, got, c.want)
		}
	}
}

func TestPlinthStripMeters(t *testing.T) {
	if got := plinthStripMeters(600, 1); got != 0.6 {
		t.Errorf("plinthStripMeters(600,1): got %v, want 0.6", got)
	}
	if got := plinthStripMeters(600, 1.2); got != 0.72 {
		t.Errorf("plinthStripMeters(600,1.2): got %v, want 0.72", got)
	}
}

// roundHardwarePurchaseQuantity mirrors TS: exact multiples must not buy an
// extra bar (the 1e-12 epsilon).
func TestRoundHardwarePurchaseQuantity(t *testing.T) {
	pkg4 := 4.0
	q, packages, echoed := roundHardwarePurchaseQuantity(0.6, &pkg4)
	if q != 4 || packages == nil || *packages != 1 || echoed == nil || *echoed != 4 {
		t.Errorf("0.6 ml → 1 barra de 4: got q=%v packages=%v echoed=%v", q, packages, echoed)
	}
	q, packages, echoed = roundHardwarePurchaseQuantity(4, &pkg4)
	if q != 4 || packages == nil || *packages != 1 {
		t.Errorf("4 ml exactos → 1 barra (sin barra extra): got q=%v packages=%v", q, packages)
	}
	q, packages, echoed = roundHardwarePurchaseQuantity(4.1, &pkg4)
	if q != 8 || packages == nil || *packages != 2 {
		t.Errorf("4.1 ml → 2 barras: got q=%v packages=%v", q, packages)
	}
	q, packages, echoed = roundHardwarePurchaseQuantity(2, nil)
	if q != 2 || packages != nil || echoed != nil {
		t.Errorf("sin packageSize → cantidad consumida: got q=%v packages=%v", q, packages)
	}
}

// GenerateHardwareList must price purchased bars, not consumed ml (TS
// generateHardwareList parity — the 4 m bar test).
func TestGenerateHardwareList_CeilProfileToPackageBars(t *testing.T) {
	catalog := baseParityCatalog(t)
	project := domain.Project{
		ID:  "p-442-strip",
		Items: []domain.ProjectItem{{
			ID:       "item-1",
			ModuleID: "m-bajo-perfil",
			Quantity: 1,
			OptionChoices: map[string]string{
				"FRENTE":       "mat-front",
				"INTERIOR":     "mat-body",
				"ZOCLO_PERFIL": "hw-perfil",
			},
		}},
	}

	rows, err := GenerateHardwareList(project, catalog)
	if err != nil {
		t.Fatalf("hardware list: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	row := rows[0]
	// 600 mm → 0.6 ml consumidos; barra comercial 4 m → compra 1 barra = 4 ml = $72.
	if row.Quantity != 0.6 {
		t.Errorf("consumed: got %v, want 0.6", row.Quantity)
	}
	if row.PurchaseQuantity != 4 || row.PurchasePackages == nil || *row.PurchasePackages != 1 {
		t.Errorf("purchase: got qty=%v packages=%v, want 4 / 1", row.PurchaseQuantity, row.PurchasePackages)
	}
	if row.LineCost != 4*18 {
		t.Errorf("lineCost prices the purchase: got %v, want %v", row.LineCost, 4*18)
	}
}
