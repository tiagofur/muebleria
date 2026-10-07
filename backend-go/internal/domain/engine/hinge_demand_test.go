package engine

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1078 engine behavior: hinge demand derives from each placed door's height
// band, placements win (#1210), the band replaces bulk lines of the same
// resolved hardware, and the ladder is overridable (factory → component).

func bandTestCatalog(mod domain.Module, policy *domain.FactoryConstructionPolicy, placements int) domain.Catalog {
	mat := domain.MaterialBoard{ID: "mat-1", Code: "MEL-18", Name: "Melamina 18", ThicknessMm: 18, Active: true}
	edge := domain.EdgeBand{ID: "edge-1", Code: "ABS-B", Name: "ABS Blanco", Active: true}
	hw := domain.Hardware{ID: "hw-bisagra", Code: "BIS-CL110", Name: "Bisagra cierre lento", Active: true}
	comp := domain.Component{
		ID: "comp-pue", Code: "COM-PUE-01", Name: "Puerta", Placement: "puerta",
		GeometryKind: "rectangular_board", LengthMm: 717, WidthMm: 296, ThicknessMm: 18,
		OptionRoles: []string{"FRENTE"}, Active: true,
	}
	st := domain.Structure{
		ID: "st-1", Code: "EST", Name: "Cuerpo",
		WidthMm: 600, HeightMm: 720, DepthMm: 560, Active: true,
		Components: []domain.ComponentInstance{{
			ComponentID: "comp-pue", Quantity: 1,
			Overrides:   bandPlacements(placements),
		}},
	}
	return domain.Catalog{
		Materials:          []domain.MaterialBoard{mat},
		Edges:              []domain.EdgeBand{edge},
		Hardware:           []domain.Hardware{hw},
		Structures:         []domain.Structure{st},
		Components:         []domain.Component{comp},
		Modules:            []domain.Module{mod},
		ConstructionPolicy: policy,
	}
}

// bandPlacements builds N role-based hinge placements (#1210 form) or nil.
func bandPlacements(n int) *domain.ComponentInstanceOverrides {
	if n <= 0 {
		return nil
	}
	placements := make([]domain.HardwarePlacement, 0, n)
	for i := 0; i < n; i++ {
		placements = append(placements, domain.HardwarePlacement{
			OptionRole:       domain.HingeDemandRole,
			AnchorFace:       "front",
			RelativePosition: domain.HardwareRelPosition{XMm: float64(20 * (i + 1)), YMm: float64(20 * (i + 1))},
		})
	}
	return &domain.ComponentInstanceOverrides{HardwarePlacements: placements}
}

func bandTestModule(extraStHeightMm int, bulkLines []domain.HardwareLine, placements int) domain.Module {
	height := 720
	if extraStHeightMm > 0 {
		height = extraStHeightMm
	}
	// The module references st-1 by id; the structure definition lives in the
	// catalog (bandTestCatalog) — door dims are static component dims, so the
	// structure height only drives the module envelope here.
	return domain.Module{
		ID: "mod-1", Code: "MOD-PUE", Name: "Con puerta",
		StructureID: "st-1", WidthMm: 600, HeightMm: height, DepthMm: 560,
		HardwareLines: bulkLines,
	}
}

func hingeBandLines(bom domain.ResolvedBom) []domain.ResolvedHardwareLine {
	out := make([]domain.ResolvedHardwareLine, 0)
	for _, line := range bom.HardwareLines {
		if strings.HasPrefix(line.ID, domain.HingeDemandLinePrefix) {
			out = append(out, line)
		}
	}
	return out
}

func TestHingeBandDemandDerivesFromDoorHeight(t *testing.T) {
	cases := []struct {
		name           string
		doorLen, doorW int
		want           int
	}{
		{"alacena 717 compra 2 (aceptación #1078)", 717, 296, 2},
		{"1601 compra 4 (aceptación #1078)", 1601, 400, 4},
		{"despensa 2100 compra 5 (aceptación #1078)", 2100, 600, 5},
		{"recargo Blum ancho 651 sobre 720", 720, 700, 3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			comp := domain.Component{
				ID: "comp-pue", Code: "COM-PUE-01", Name: "Puerta", Placement: "puerta",
				GeometryKind: "rectangular_board", LengthMm: tc.doorLen, WidthMm: tc.doorW, ThicknessMm: 18,
				OptionRoles: []string{"FRENTE"}, Active: true,
			}
			mod := bandTestModule(0, nil, 0)
			catalog := bandTestCatalog(mod, nil, 0)
			catalog.Components = []domain.Component{comp}
			catalog.Structures[0].Components[0].ComponentID = comp.ID

			bom, err := ResolveBom(mod, map[string]string{"INTERIOR": "mat-1", "FRENTE": "mat-1", "BISAGRA": "hw-bisagra"}, catalog)
			if err != nil {
				t.Fatalf("resolve: %v", err)
			}
			bands := hingeBandLines(bom)
			if len(bands) != 1 {
				t.Fatalf("band lines = %d (%+v), want 1", len(bands), bom.HardwareLines)
			}
			line := bands[0]
			if line.HardwareID != "hw-bisagra" || int(line.Quantity) != tc.want {
				t.Fatalf("band line = %+v, want hw-bisagra ×%d", line, tc.want)
			}
			if line.OptionRole != domain.HingeDemandRole {
				t.Fatalf("band role = %q, want %q (consumes the group choice)", line.OptionRole, domain.HingeDemandRole)
			}
			if line.DescriptionOverride != domain.HingeDemandLineDescription {
				t.Fatalf("band description = %q, want the applied-band description", line.DescriptionOverride)
			}
		})
	}
}

func TestHingeBandDemandReplacesBulkLineOfSameHardware(t *testing.T) {
	mod := bandTestModule(2100, []domain.HardwareLine{
		{ID: "hl-bulk", Quantity: 2, OptionRole: "BISAGRA"},
	}, 0)
	catalog := bandTestCatalog(mod, nil, 0)
	bom, err := ResolveBom(mod, map[string]string{"INTERIOR": "mat-1", "FRENTE": "mat-1", "BISAGRA": "hw-bisagra"}, catalog)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	for _, line := range bom.HardwareLines {
		if line.ID == "hl-bulk" {
			t.Fatalf("the fixed bulk line must stop governing once the band covers it: %+v", line)
		}
	}
	if len(hingeBandLines(bom)) != 1 {
		t.Fatalf("expected exactly one band line, got %+v", bom.HardwareLines)
	}
}

func TestHingeBandPositionsWinOverBand(t *testing.T) {
	mod := bandTestModule(2100, []domain.HardwareLine{
		{ID: "hl-bulk", Quantity: 2, OptionRole: "BISAGRA"},
	}, 2)
	catalog := bandTestCatalog(mod, nil, 2)
	bom, err := ResolveBom(mod, map[string]string{"INTERIOR": "mat-1", "FRENTE": "mat-1", "BISAGRA": "hw-bisagra"}, catalog)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if bands := hingeBandLines(bom); len(bands) != 0 {
		t.Fatalf("placements must win: no band line expected, got %+v", bands)
	}
	found := 0
	for _, line := range bom.HardwareLines {
		if strings.HasPrefix(line.ID, "placement-mod-") && line.HardwareID == "hw-bisagra" {
			if line.Quantity != 2 {
				t.Fatalf("positioned qty = %v, want 2", line.Quantity)
			}
			found++
		}
		if line.ID == "hl-bulk" {
			t.Fatalf("positions must also drop the bulk line: %+v", line)
		}
	}
	if found != 1 {
		t.Fatalf("expected one positioned line, got %d (%+v)", found, bom.HardwareLines)
	}
}

func TestHingeBandWithoutChoiceStaysQuiet(t *testing.T) {
	// Post-seed reality: no BISAGRA line authored, no choice made. The band
	// cannot invent an identity — it stays out, the resolve stays green, and
	// the QUOTE GATE (TS) owns demanding the group before pricing.
	mod := bandTestModule(2100, nil, 0)
	catalog := bandTestCatalog(mod, nil, 0)
	bom, err := ResolveBom(mod, map[string]string{"INTERIOR": "mat-1", "FRENTE": "mat-1"}, catalog)
	if err != nil {
		t.Fatalf("resolve must stay green without a choice: %v", err)
	}
	if bands := hingeBandLines(bom); len(bands) != 0 {
		t.Fatalf("no choice → no band line, got %+v", bands)
	}
}

func TestHingeBandBrokenChoiceFailsClosed(t *testing.T) {
	mod := bandTestModule(2100, nil, 0)
	catalog := bandTestCatalog(mod, nil, 0)
	_, err := ResolveBom(mod, map[string]string{"INTERIOR": "mat-1", "FRENTE": "mat-1", "BISAGRA": "hw-fantasma"}, catalog)
	if err == nil {
		t.Fatal("a choice pointing at missing hardware must error, never silently $0")
	}
}

func TestHingeBandFactoryPolicyOverridesLadder(t *testing.T) {
	// Factory overlay: bandas 1200→2, 2400→6, surge explícitamente null.
	overlay := `{"joint.constructionPolicy":{"version":1,"doorHingeDemand":{"optionRole":"BISAGRA","bands":[{"upToHeightMm":1200,"hinges":2},{"upToHeightMm":2400,"hinges":6}],"widthSurgeOverMm":null}}}`
	policy, err := ParseFactoryConstructionPolicy([]byte(overlay))
	if err != nil {
		t.Fatalf("parse policy: %v", err)
	}
	if policy == nil || policy.DoorHingeDemand == nil || len(policy.DoorHingeDemand.Bands) != 2 {
		t.Fatalf("doorHingeDemand not parsed: %+v", policy)
	}
	if domain.HingesForDoor(1500, 900, policy.DoorHingeDemand) != 6 {
		t.Fatalf("factory ladder must replace the library ladder")
	}
	// widthSurgeOverMm: null = disabled — a 900-wide door buys no surge.
	if domain.HingesForDoor(720, 900, policy.DoorHingeDemand) != 2 {
		t.Fatalf("explicit null surge must disable the width rule")
	}

	mod := bandTestModule(1500, nil, 0)
	catalog := bandTestCatalog(mod, policy, 0)
	catalog.Components[0].LengthMm = 1500
	catalog.Components[0].WidthMm = 600
	bom, err := ResolveBom(mod, map[string]string{"INTERIOR": "mat-1", "FRENTE": "mat-1", "BISAGRA": "hw-bisagra"}, catalog)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	bands := hingeBandLines(bom)
	if len(bands) != 1 || int(bands[0].Quantity) != 6 {
		t.Fatalf("quote must follow the factory ladder (6), got %+v", bands)
	}
}

func TestHingeBandComponentExceptionOverridesFactory(t *testing.T) {
	// Factory ladder 1200→2/2400→6; the door component's exception: always 2.
	overlay := `{"joint.constructionPolicy":{"version":1,"doorHingeDemand":{"optionRole":"BISAGRA","bands":[{"upToHeightMm":1200,"hinges":2},{"upToHeightMm":2400,"hinges":6}]},"componentOverrides":{"comp-pue":{"hingeDemand":{"bands":[{"upToHeightMm":2400,"hinges":2}]}}}}}`
	policy, err := ParseFactoryConstructionPolicy([]byte(overlay))
	if err != nil {
		t.Fatalf("parse policy: %v", err)
	}
	if got := policy.HingeDemandForComponent("comp-pue"); got == nil || len(got.Bands) != 1 || got.Bands[0].Hinges != 2 {
		t.Fatalf("component exception not resolved: %+v", got)
	}
	if got := policy.HingeDemandForComponent("comp-otra"); got == nil || len(got.Bands) != 2 {
		t.Fatalf("unrelated component must inherit the factory family: %+v", got)
	}

	mod := bandTestModule(1500, nil, 0)
	catalog := bandTestCatalog(mod, policy, 0)
	catalog.Components[0].LengthMm = 1500
	catalog.Components[0].WidthMm = 600
	bom, err := ResolveBom(mod, map[string]string{"INTERIOR": "mat-1", "FRENTE": "mat-1", "BISAGRA": "hw-bisagra"}, catalog)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	bands := hingeBandLines(bom)
	if len(bands) != 1 || int(bands[0].Quantity) != 2 {
		t.Fatalf("component exception must govern (2), got %+v", bands)
	}
}

func TestHingeBandInvalidFactoryPolicyFailsClosed(t *testing.T) {
	overlays := []string{
		// non-ascending bands
		`{"joint.constructionPolicy":{"version":1,"doorHingeDemand":{"bands":[{"upToHeightMm":1600,"hinges":3},{"upToHeightMm":900,"hinges":2}]}}}`,
		// hinge count out of range
		`{"joint.constructionPolicy":{"version":1,"doorHingeDemand":{"bands":[{"upToHeightMm":900,"hinges":0}]}}}`,
		// negative surge
		`{"joint.constructionPolicy":{"version":1,"doorHingeDemand":{"bands":[{"upToHeightMm":900,"hinges":2}],"widthSurgeOverMm":-5}}}`,
		// bands missing
		`{"joint.constructionPolicy":{"version":1,"doorHingeDemand":{"optionRole":"BISAGRA"}}}`,
	}
	for _, overlay := range overlays {
		if _, err := ParseFactoryConstructionPolicy([]byte(overlay)); err == nil {
			t.Fatalf("overlay must fail closed: %s", overlay)
		}
	}
}

func TestHingeBandGranularOverlayInheritsLibraryLadder(t *testing.T) {
	// The legacy granular surface has no band array form: honest absence —
	// the policy parses WITHOUT a hinge family and the resolve stays on the
	// library ladder (never a half-parsed band set).
	overlay := `{"joint.floorToSide.stationsCount":3}`
	policy, err := ParseFactoryConstructionPolicy([]byte(overlay))
	if err != nil {
		t.Fatalf("parse policy: %v", err)
	}
	if policy == nil || policy.DoorHingeDemand != nil {
		t.Fatalf("granular overlay must not invent a hinge policy: %+v", policy)
	}
	if domain.HingesForDoor(2100, 600, policy.DoorHingeDemand) != 5 {
		t.Fatalf("nil family must inherit the library ladder (5)")
	}
}
