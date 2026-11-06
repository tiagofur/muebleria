package engine

// #1529 acceptance — one measure: the A3 resolution (reported), the layout
// board (geometry) and the cut-list part are the same number for every
// front of a real composed 3-drawer column.

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// withOpeningTestMaterial adds one board material and the role choices the
// cut list needs for the one-door fixture's roles.
func withOpeningTestMaterial(catalog *domain.Catalog) map[string]string {
	catalog.Materials = append(catalog.Materials, domain.MaterialBoard{
		ID: "mat-a3", Code: "MAT-A3", Name: "Tablero A3", WidthMm: 2750, LengthMm: 1850, ThicknessMm: 18, Active: true,
	})
	return map[string]string{"LATERAL": "mat-a3", "INTERIOR": "mat-a3", "FONDO": "mat-a3", "FRENTE": "mat-a3"}
}

func drawerColumnCatalog() (domain.Module, domain.Catalog) {
	drawerFront := domain.Component{
		ID: "comp-dfront", Code: "FRENTE-CAJ", Name: "Frente Cajón", Placement: domain.PlacementFrenteCajon,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"FRENTE"},
		LengthFormula: "PH - 4", WidthFormula: "PW - 4", Active: true,
	}
	agregado := domain.Agregado{
		ID: "agr-drawer", Code: "CAJON", Name: "Cajón", Active: true,
		Components: []domain.ComponentInstance{{ComponentID: "comp-dfront", Quantity: 1}},
	}
	module, catalog := oneDoorCabinetCatalog()
	module.Components = []domain.ComponentInstance{}
	catalog.Agregados = append(catalog.Agregados, agregado)
	catalog.Components = append(catalog.Components, drawerFront)
	catalog.Structures[0].Agregados = []domain.ModuleAgregadoInstance{{
		ID: "agr-inst-1", AgregadoID: "agr-drawer", Quantity: 3, LayoutDirection: "vertical",
	}}
	return module, catalog
}

func TestOpeningA3ReportedEqualsLayoutEqualsCutList(t *testing.T) {
	module, catalog := drawerColumnCatalog()
	catalog.Modules = append(catalog.Modules, module)
	choices := withOpeningTestMaterial(&catalog)
	top, between := 40.0, 36.0
	fronts := []OpeningResolvedFront{{
		ZoneID: "z1", Access: "drawer", WidthMm: 596, HeightMm: 720,
		EdgeGrips: &OpeningEdgeGrips{TopDiscountMm: &top, BetweenDiscountMm: &between},
	}}

	// Reported: the A3 resolution over the default expansion's boards.
	baseBoards, err := resolveLayoutBoards(module, catalog, LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}, nil, resolveOptions{})
	if err != nil {
		t.Fatalf("baseline boards: %v", err)
	}
	poses, reported, err := openingA3Poses(baseBoards, *fronts[0].EdgeGrips, 720)
	if err != nil {
		t.Fatalf("A3 over the real column: %v", err)
	}
	if len(reported.Rows) != 3 || reported.TopEdgeMm != 720-40+reported.Rows[2].BottomMm {
		t.Fatalf("reported resolution drifted: %+v", reported)
	}
	reportedByID := map[string]float64{}
	for index, pose := range poses {
		reportedByID[baseBoards[index].id] = pose[1]
	}

	// Geometry: the layout with the opening.
	_, boards, err := resolveFurnitureLayoutOpts(module, catalog, &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}, nil, resolveOptions{fronts: fronts})
	if err != nil {
		t.Fatalf("layout with v2 opening: %v", err)
	}
	layoutByID := map[string]float64{}
	for _, board := range boards {
		if boardIsOpeningFront(&board) {
			layoutByID[board.id] = board.lengthMm
		}
	}

	// Cut list: the release BOM with the same fronts.
	bom, err := ResolveBomForReleaseWithOpening(module, choices, catalog, &domain.ItemCustomDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}, nil, fronts, nil, nil)
	if err != nil {
		t.Fatalf("cut list with v2 opening: %v", err)
	}
	cutByID := map[string]float64{}
	for _, part := range bom.BoardParts {
		if _, front := layoutByID[part.ID]; front {
			cutByID[part.ID] = part.LengthMm
		}
	}

	if len(reportedByID) != 3 || len(layoutByID) != 3 || len(cutByID) != 3 {
		t.Fatalf("3 fronts each: reported %v layout %v cut %v", reportedByID, layoutByID, cutByID)
	}
	for id, reportedMm := range reportedByID {
		if layoutByID[id] != reportedMm || cutByID[id] != reportedMm {
			t.Fatalf("%s: reported %g, layout %g, cut %g — must be one number", id, reportedMm, layoutByID[id], cutByID[id])
		}
	}
}

// #1529 — a v1 pin resolves exactly as before on a single row (regression):
// the one-door cabinet keeps 716 − 32 = 684 in both the layout and the cut
// list, and its reported v1 resolution is untouched.
func TestOpeningV1PinSingleRowRegression(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	catalog.Modules = append(catalog.Modules, module)
	choices := withOpeningTestMaterial(&catalog)
	fronts := openingPassFront("top", 32)
	_, boards, err := resolveFurnitureLayoutOpts(module, catalog, &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}, nil, resolveOptions{fronts: fronts})
	if err != nil {
		t.Fatalf("v1 layout: %v", err)
	}
	for _, board := range boards {
		if boardIsOpeningFront(&board) && (board.lengthMm != 684 || board.z != 2) {
			t.Fatalf("v1 single door drifted: L %g @ z %g, want 684 @ 2", board.lengthMm, board.z)
		}
	}
	bom, err := ResolveBomForReleaseWithOpening(module, choices, catalog, &domain.ItemCustomDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}, nil, fronts, nil, nil)
	if err != nil {
		t.Fatalf("v1 cut list: %v", err)
	}
	doors := 0
	for _, part := range bom.BoardParts {
		for _, board := range boards {
			if board.id == part.ID && boardIsOpeningFront(&board) {
				doors++
				if part.LengthMm != 684 {
					t.Fatalf("v1 cut list drifted: %g, want 684", part.LengthMm)
				}
			}
		}
	}
	if doors != 1 {
		t.Fatalf("expected the door in the cut list, found %d", doors)
	}
}

// #1529 acceptance — the notch and the bevel come from one definition at
// the between edges too: on a v2 Italian drawer column (36 top, 36 between)
// the top bevel cuts only the top drawer, the between bevel cuts the top
// edge of the two lower drawers, and the between notch hangs from the bottom
// edge of each upper drawer on both sides.
func TestOpeningA3BetweenEdgesBevelAndNotch(t *testing.T) {
	module, catalog := drawerColumnCatalog()
	top, between := 36.0, 36.0
	fronts := []OpeningResolvedFront{{
		ZoneID: "z1", Access: "drawer", WidthMm: 596, HeightMm: 720,
		EdgeGrips: &OpeningEdgeGrips{TopDiscountMm: &top, BetweenDiscountMm: &between},
	}}
	modifiers := []ResolvedOpeningBodyModifier{
		{Effect: OpeningModifierEffectBevel, Role: "door", ProfileID: "it", Boundary: "top", BevelAngleDeg: 45, BevelSizeMm: 10},
		{Effect: OpeningModifierEffectBevel, Role: "door", ProfileID: "it", Boundary: "between:column", BevelAngleDeg: 45, BevelSizeMm: 10},
		{Effect: OpeningModifierEffectNotch, Role: "lateral", ProfileID: "it", Boundary: "between:column", NotchHeightMm: 71, NotchDepthMm: 17},
	}
	_, boards, err := resolveFurnitureLayoutOpts(module, catalog, &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}, nil,
		resolveOptions{fronts: fronts, openingBodyModifiers: modifiers})
	if err != nil {
		t.Fatalf("Italian column: %v", err)
	}
	rows, err := openingFrontRows(boards)
	if err != nil || len(rows) != 3 {
		t.Fatalf("3 rows expected: %v %v", rows, err)
	}
	edgesByRow := []string{}
	for _, row := range rows {
		board := boards[row.boards[0]]
		edges := ""
		for _, bevel := range board.bevels {
			edges += bevel.Boundary + ";"
		}
		edgesByRow = append(edgesByRow, edges)
	}
	if edgesByRow[0] != "top;" || edgesByRow[1] != "between:column;" || edgesByRow[2] != "between:column;" {
		t.Fatalf("bevels by row (top → bottom) = %v", edgesByRow)
	}
	sides := 0
	for _, board := range boards {
		if !boardIsOpeningSide(&board) {
			continue
		}
		sides++
		if len(board.notches) != 2 {
			t.Fatalf("%s: one notch per between edge, got %d", board.id, len(board.notches))
		}
		for n, notch := range board.notches {
			if notch.SizeMm[1] != 17 && notch.SizeMm[0] != 17 && notch.SizeMm[2] != 17 {
				t.Fatalf("%s notch %d: depth 17 expected in %v", board.id, n, notch.SizeMm)
			}
		}
	}
	if sides == 0 {
		t.Fatal("the fixture must have side boards")
	}
}
