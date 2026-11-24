package engine

import (
	"fmt"
	"sort"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1579 characterization: the hinge demand the Go resolve produces TODAY for
// aggregate doors (AGR-PUE-* recipe shape) had no test. These pins keep the
// per-hinge table and the count rule from moving what is already quoted or
// released: closed quotes re-resolve against pins with the live engine, so any
// behavior change for recipes that declare no countRule is a regression.
//
// The pinned values are OBSERVED behavior, not an endorsement of it:
//   - a door whose material role is FRENTES is not seen as a door by the band
//     (it keys on FRENTE), and aggregate placements are not demand in Go, so a
//     recipe with hinge placements only quotes ZERO hinges server-side;
//   - a door with role FRENTE plus a bulk hinge line is counted twice (bulk +
//     band).
// Both predate #1579; fixing either for recipes without countRule would move
// closed quotes and is the owner's call, not this issue's.

type pinnedHingeLine struct {
	id  string
	qty float64
}

// agregadoDoorCase builds one aggregate-door module in the AGR-PUE-* shape.
func agregadoDoorCase(doorHeightMm int, doorMaterialRole string, placements int, bulk *domain.HardwareLine) (domain.Module, domain.Catalog) {
	sideComp := domain.Component{
		ID: "comp-side-izq", Code: "COM-COS-IZQ", Name: "Costado Izq.",
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		Placement: domain.PlacementLateralIzquierdo, OptionRoles: []string{"INTERIOR"},
		WidthFormula: "PD", LengthFormula: "PH", Active: true,
	}
	doorComp := domain.Component{
		ID: "comp-door", Code: "PUERTA", Name: "Puerta",
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		Placement: domain.PlacementPuerta, OptionRoles: []string{doorMaterialRole},
		WidthFormula: "PW", LengthFormula: "PH", Active: true,
	}
	hinges := make([]domain.HardwarePlacement, 0, placements)
	for i := 0; i < placements; i++ {
		hinges = append(hinges, domain.HardwarePlacement{
			OptionRole:       domain.HingeDemandRole,
			AnchorFace:       "back",
			RelativePosition: domain.HardwareRelPosition{XMm: 20.5, YMm: 90, XFormula: "PW-20.5", YFormula: fmt.Sprintf("PH-%d", 90*(i+1))},
		})
	}
	var overrides *domain.ComponentInstanceOverrides
	if placements > 0 {
		overrides = &domain.ComponentInstanceOverrides{HardwarePlacements: hinges}
	}
	agr := domain.Agregado{
		ID: "agr-pue", Code: "AGR-PUE-DER", Name: "Puerta Derecha", Active: true,
		Components: []domain.ComponentInstance{{
			ComponentID: "comp-door", Quantity: 1, PlacementOverride: ptrPlacement(domain.PlacementPuerta), Overrides: overrides,
		}},
		HardwareLines: bulkLinesOf(bulk),
	}
	mat := domain.MaterialBoard{ID: "mat-1", Code: "MEL-18", Name: "Melamina 18", ThicknessMm: 18, Active: true}
	hw := domain.Hardware{ID: "hw-bisagra", Code: "BIS-CL110", Name: "Bisagra cierre lento", Active: true, CostPerUnit: 10}
	st := domain.Structure{
		ID: "st-1", Code: "EST", Name: "Cuerpo",
		WidthMm: 600, HeightMm: doorHeightMm, DepthMm: 560, Active: true,
		Components: []domain.ComponentInstance{{ComponentID: "comp-side-izq", Quantity: 1}},
	}
	mod := domain.Module{
		ID: "mod-1", Code: "MOD-PUE", Name: "Con puerta agregado",
		StructureID: "st-1", WidthMm: 600, HeightMm: doorHeightMm, DepthMm: 560,
		Agregados: []domain.ModuleAgregadoInstance{{ID: "inst-door", AgregadoID: "agr-pue", Quantity: 1}},
	}
	catalog := domain.Catalog{
		Materials:  []domain.MaterialBoard{mat},
		Hardware:   []domain.Hardware{hw},
		Structures: []domain.Structure{st},
		Components: []domain.Component{sideComp, doorComp},
		Agregados:  []domain.Agregado{agr},
		Modules:    []domain.Module{mod},
	}
	return mod, catalog
}

func ptrPlacement(p domain.ComponentPlacement) *domain.ComponentPlacement { return &p }

func bulkLinesOf(line *domain.HardwareLine) []domain.HardwareLine {
	if line == nil {
		return nil
	}
	return []domain.HardwareLine{*line}
}

// hingeLinesOf returns the resolved hinge lines, sorted by id for a stable pin.
func hingeLinesOf(bom domain.ResolvedBom) []pinnedHingeLine {
	out := make([]pinnedHingeLine, 0)
	for _, line := range bom.HardwareLines {
		if line.HardwareID == "hw-bisagra" {
			out = append(out, pinnedHingeLine{id: line.ID, qty: line.Quantity})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].id < out[j].id })
	return out
}

func TestHingeAgregadoPre1579BehaviorIsPinned(t *testing.T) {
	bulk2 := func() *domain.HardwareLine {
		return &domain.HardwareLine{ID: "agr-bulk", Quantity: 2, OptionRole: domain.HingeDemandRole}
	}
	band := func(qty float64) pinnedHingeLine {
		return pinnedHingeLine{id: domain.HingeDemandLinePrefix + "hw-bisagra", qty: qty}
	}
	bulk := pinnedHingeLine{id: "agr-bulk", qty: 2}

	cases := []struct {
		name   string
		height int
		role   string
		plass  int
		bulk   *domain.HardwareLine
		want   []pinnedHingeLine
	}{
		// The owner's catalog shape (door role FRENTES, hinge placements only):
		// zero hinges server-side.
		{"FRENTES placements 720 quotes zero", 720, "FRENTES", 2, nil, []pinnedHingeLine{}},
		{"FRENTES placements 2100 quotes zero", 2100, "FRENTES", 2, nil, []pinnedHingeLine{}},
		{"FRENTES placements+bulk 720 quotes the bulk only", 720, "FRENTES", 2, bulk2(), []pinnedHingeLine{bulk}},
		{"FRENTES placements+bulk 2100 quotes the bulk only", 2100, "FRENTES", 2, bulk2(), []pinnedHingeLine{bulk}},
		{"FRENTES bulk-only 720 quotes the bulk", 720, "FRENTES", 0, bulk2(), []pinnedHingeLine{bulk}},
		{"FRENTES bulk-only 2100 quotes the bulk", 2100, "FRENTES", 0, bulk2(), []pinnedHingeLine{bulk}},
		// Door role FRENTE: the band sees the aggregate door.
		{"FRENTE placements 720 bands 2", 720, "FRENTE", 2, nil, []pinnedHingeLine{band(2)}},
		{"FRENTE placements 2100 bands 5", 2100, "FRENTE", 2, nil, []pinnedHingeLine{band(5)}},
		{"FRENTE placements+bulk 720 double counts", 720, "FRENTE", 2, bulk2(), []pinnedHingeLine{bulk, band(2)}},
		{"FRENTE placements+bulk 2100 double counts", 2100, "FRENTE", 2, bulk2(), []pinnedHingeLine{bulk, band(5)}},
		{"FRENTE bulk-only 720 double counts", 720, "FRENTE", 0, bulk2(), []pinnedHingeLine{bulk, band(2)}},
		{"FRENTE bulk-only 2100 double counts", 2100, "FRENTE", 0, bulk2(), []pinnedHingeLine{bulk, band(5)}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mod, catalog := agregadoDoorCase(tc.height, tc.role, tc.plass, tc.bulk)
			choices := map[string]string{"INTERIOR": "mat-1", tc.role: "mat-1", domain.HingeDemandRole: "hw-bisagra"}
			bom, err := ResolveBom(mod, choices, catalog)
			if err != nil {
				t.Fatalf("resolve: %v", err)
			}
			got := hingeLinesOf(bom)
			if len(got) != len(tc.want) {
				t.Fatalf("hinge lines changed for a recipe without countRule:\n got  %+v\n want %+v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("hinge line %d changed for a recipe without countRule:\n got  %+v\n want %+v", i, got[i], tc.want[i])
				}
			}
		})
	}
}
