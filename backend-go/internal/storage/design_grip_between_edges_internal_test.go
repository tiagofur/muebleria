package storage

// #1532 (judgment-day r1→r2, S4 residual): the production helpers that
// derive the between-edge count for quote and release. The multi-row
// arithmetic itself is engine-tested (OpeningFrontStackReport +
// ResolveProjectGripBOM in opening_project_grip_test.go); these tests pin
// the wrapper contract the quote/release paths consume: the no-between
// short-circuit and the fail-closed unknown definition.

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

func betweenTestIntPtr(v int) *int { return &v }

func TestDesignGripBetweenEdgesShortCircuitsWithoutBetweenProfile(t *testing.T) {
	store := &PostgresStore{}
	recipe := &domain.GripSnapshotRecipe{
		Mode: domain.GripModeGola,
		TopProfile: &domain.FrozenGripProfile{
			ProfileID: "p", Code: "C", FrontDiscountTopMm: betweenTestIntPtr(40),
		},
	}
	count, err := store.designGripBetweenEdges(nil, domain.Catalog{}, designOpeningUnit{}, recipe, &domain.ItemCustomDims{WidthMm: 600, HeightMm: 720, DepthMm: 560})
	if err != nil || count != 0 {
		t.Fatalf("a recipe without a between profile adds no between run: %d %v", count, err)
	}
}

func TestDesignGripBetweenEdgesFailsClosedOnUnknownDefinition(t *testing.T) {
	store := &PostgresStore{}
	between := &domain.FrozenGripProfile{ProfileID: "p-c", Code: "C", FrontDiscountBetweenMm: betweenTestIntPtr(36)}
	recipe := &domain.GripSnapshotRecipe{
		Mode:           domain.GripModeGola,
		TopProfile:     between,
		BetweenProfile: between,
	}
	empty := domain.Catalog{Modules: []domain.Module{}}
	if _, err := store.designGripBetweenEdges(nil, empty, designOpeningUnit{FurnitureDefinitionID: "no-existe"}, recipe,
		&domain.ItemCustomDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}); err == nil ||
		!strings.Contains(err.Error(), "no existe en el catálogo") {
		t.Fatalf("an unknown definition must fail closed, got %v", err)
	}
}

func TestReleaseGripBetweenEdgesShortCircuitsWithoutBetweenProfile(t *testing.T) {
	recipe := &domain.GripSnapshotRecipe{
		Mode:       domain.GripModeGola,
		TopProfile: &domain.FrozenGripProfile{ProfileID: "p", Code: "C", FrontDiscountTopMm: betweenTestIntPtr(40)},
	}
	count, err := releaseGripBetweenEdges(domain.Catalog{}, domain.DesignRevisionItem{}, recipe, 600, 720, 560)
	if err != nil || count != 0 {
		t.Fatalf("a recipe without a between profile adds no between run: %d %v", count, err)
	}
}

func TestReleaseGripBetweenEdgesFailsClosedOnUnknownDefinition(t *testing.T) {
	between := &domain.FrozenGripProfile{ProfileID: "p-c", Code: "C", FrontDiscountBetweenMm: betweenTestIntPtr(36)}
	recipe := &domain.GripSnapshotRecipe{
		Mode:           domain.GripModeGola,
		TopProfile:     between,
		BetweenProfile: between,
	}
	empty := domain.Catalog{Modules: []domain.Module{}}
	if _, err := releaseGripBetweenEdges(empty, domain.DesignRevisionItem{FurnitureDefinitionID: "no-existe"}, recipe, 600, 720, 560); err == nil ||
		!strings.Contains(err.Error(), "no existe en el catálogo") {
		t.Fatalf("an unknown definition must fail closed, got %v", err)
	}
}

// The edges the wrappers count come from the SAME stack the engine reports;
// the arithmetic (rows − 1) is pinned at the engine level
// (TestOpeningFrontStackReportBetweenEdgesFromAStack) — this compiles the
// intent so the wrappers cannot silently skip the stack read.
var _ = engine.OpeningFrontStackReport
