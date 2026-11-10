package engine

// #1536 — the italian strip BETWEEN fronts: one real board per between edge
// of the resolved stack, the top-strip rule mirrored (the strip's top edge
// hangs from the upper front's bottom edge, full furniture width, the
// FRENTE material role). Fail-closed on a missing or inactive catalog
// component; a single front places no between strips (truthful absence).

import (
	"fmt"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func betweenStripsCatalog() (domain.Module, domain.Catalog) {
	module, catalog := drawerColumnCatalog()
	tira := domain.Component{
		ID: "comp-tira-1536", Code: "TIRA-IT", Name: "Tira italiana",
		Placement: domain.PlacementSuperior, GeometryKind: "rectangular_board",
		ThicknessMm: 16, OptionRoles: []string{"FRENTE"}, Active: true,
	}
	catalog.Components = append(catalog.Components, tira)
	return module, catalog
}

func TestOpeningBetweenStripBoardsOnePerBetweenEdge(t *testing.T) {
	module, catalog := betweenStripsCatalog()
	top, between := 36.0, 36.0
	fronts := []OpeningResolvedFront{{
		ZoneID: "z1", Access: "drawer", WidthMm: 596, HeightMm: 720,
		EdgeGrips: &OpeningEdgeGrips{TopDiscountMm: &top, BetweenDiscountMm: &between},
	}}
	members := &OpeningMembers{
		BetweenComponentMembers: []OpeningComponentMember{
			{Key: "strip", ComponentID: "comp-tira-1536", DepthMm: 16, HeightMm: 70},
		},
	}
	_, boards, err := resolveFurnitureLayoutOpts(module, catalog, &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}, nil,
		resolveOptions{fronts: fronts, openingMembers: members})
	if err != nil {
		t.Fatalf("3-drawer italian column: %v", err)
	}
	strips := []layoutBoard{}
	for _, board := range boards {
		if strings.HasPrefix(board.id, "opening-strip-between-") {
			strips = append(strips, board)
		}
	}
	if len(strips) != 2 {
		t.Fatalf("3 fronts → 2 between strips, got %d (%v)", len(strips),
			func() []string {
				ids := []string{}
				for _, b := range boards {
					ids = append(ids, b.id)
				}
				return ids
			}())
	}
	// The front boards' resolved rows, top first: the strip between the
	// upper pair hangs from the UPPER front's bottom edge.
	rows, err := openingFrontRows(boards)
	if err != nil || len(rows) != 3 {
		t.Fatalf("3 rows expected: %v %v", rows, err)
	}
	type frontPose struct {
		z      float64
		length float64
	}
	frontsPose := []frontPose{}
	for _, row := range rows {
		board := boards[row.boards[0]]
		frontsPose = append(frontsPose, frontPose{z: board.z, length: board.lengthMm})
	}
	// rows are top → bottom: the upper front of pair k is frontsPose[k].
	for k, strip := range strips {
		upper := frontsPose[k]
		wantZ := upper.z - 70.0
		if strip.z != wantZ {
			t.Fatalf("between strip %d: z = %.2f, want %.2f (upper front bottom %.2f − 70)", k+1, strip.z, wantZ, upper.z)
		}
		if strip.widthMm != 16 || strip.thicknessMm != 70 {
			t.Fatalf("between strip %d: declared dims drift (depth 16, height 70): %.2f × %.2f", k+1, strip.widthMm, strip.thicknessMm)
		}
		if strip.lengthMm != 600 {
			t.Fatalf("between strip %d: full furniture width expected (600), got %.2f", k+1, strip.lengthMm)
		}
		if strip.optionRole != "FRENTE" {
			t.Fatalf("between strip %d: FRENTE material role expected, got %q", k+1, strip.optionRole)
		}
		if strip.catalogComponentID != "comp-tira-1536" {
			t.Fatalf("between strip %d: catalog component id expected", k+1)
		}
	}
	// The strips are REAL cut-list boards: they join the components the
	// same lane the top strip publishes (kind board, published AABB).
	for _, strip := range strips {
		local, min, size, err := boardLocalPose(&strip)
		if err != nil {
			t.Fatalf("between strip pose: %v", err)
		}
		if size[0] <= 0 || size[1] <= 0 || size[2] <= 0 {
			t.Fatalf("between strip %s: non-positive published size %v (local %v min %v)", strip.id, size, local, min)
		}
	}
}

func TestOpeningBetweenStripsFailClosedOnMissingComponent(t *testing.T) {
	module, catalog := betweenStripsCatalog()
	top, between := 36.0, 36.0
	fronts := []OpeningResolvedFront{{
		ZoneID: "z1", Access: "drawer", WidthMm: 596, HeightMm: 720,
		EdgeGrips: &OpeningEdgeGrips{TopDiscountMm: &top, BetweenDiscountMm: &between},
	}}
	members := &OpeningMembers{
		BetweenComponentMembers: []OpeningComponentMember{
			{Key: "strip", ComponentID: "comp-inexistente", DepthMm: 16, HeightMm: 70},
		},
	}
	_, _, err := resolveFurnitureLayoutOpts(module, catalog, &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}, nil,
		resolveOptions{fronts: fronts, openingMembers: members})
	if err == nil {
		t.Fatal("a missing between-strip component must reject the resolve")
	}
	if !strings.Contains(err.Error(), "no existe o está inactivo") {
		t.Fatalf("fail-closed message drifted: %v", err)
	}
}

func TestOpeningBetweenStripsSingleFrontPlacesNothing(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	tira := domain.Component{
		ID: "comp-tira-1536", Code: "TIRA-IT", Name: "Tira italiana",
		Placement: domain.PlacementSuperior, GeometryKind: "rectangular_board",
		ThicknessMm: 16, OptionRoles: []string{"FRENTE"}, Active: true,
	}
	catalog.Components = append(catalog.Components, tira)
	top := 40.0
	fronts := []OpeningResolvedFront{{
		ZoneID: "z1", Access: "hinged", WidthMm: 596, HeightMm: 720,
		EdgeGrips: &OpeningEdgeGrips{TopDiscountMm: &top},
	}}
	members := &OpeningMembers{
		BetweenComponentMembers: []OpeningComponentMember{
			{Key: "strip", ComponentID: "comp-tira-1536", DepthMm: 16, HeightMm: 70},
		},
	}
	_, boards, err := resolveFurnitureLayoutOpts(module, catalog, &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}, nil,
		resolveOptions{fronts: fronts, openingMembers: members})
	if err != nil {
		t.Fatalf("single front: %v", err)
	}
	for _, board := range boards {
		if strings.HasPrefix(board.id, "opening-strip-between-") {
			t.Fatalf("a single front has no between edges: %s must not exist", board.id)
		}
	}
	if len(boards) == 0 {
		t.Fatal("sanity: boards expected")
	}
	_ = fmt.Sprint() // keep fmt imported for future assertions
}
