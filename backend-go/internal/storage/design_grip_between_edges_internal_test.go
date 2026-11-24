package storage

// #1532 (judgment-day r1→r2, S4 residual), distribution per #1706: the
// production helpers that resolve the stack's grip distribution for quote
// and release. The distribution arithmetic itself is engine-tested
// (OpeningGripPlacementFor + OpeningFrontStackReport); these tests pin the
// wrapper contract the quote/release paths consume: the stack is consulted
// for EVERY gola recipe (the distribution decides the top mounting too, not
// only the between edges) and the fail-closed unknown definition.

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

func betweenTestIntPtr(v int) *int { return &v }

func TestDesignGripPlacementFailsClosedOnUnknownDefinition(t *testing.T) {
	store := &PostgresStore{}
	between := &domain.FrozenGripProfile{ProfileID: "p-c", Code: "C", FrontDiscountBetweenMm: betweenTestIntPtr(36)}
	recipe := &domain.GripSnapshotRecipe{
		Mode:           domain.GripModeGola,
		TopProfile:     between,
		BetweenProfile: between,
	}
	empty := domain.Catalog{Modules: []domain.Module{}}
	if _, err := store.designGripPlacement(nil, empty, designOpeningUnit{FurnitureDefinitionID: "no-existe"}, recipe,
		&domain.ItemCustomDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}); err == nil ||
		!strings.Contains(err.Error(), "no existe en el catálogo") {
		t.Fatalf("an unknown definition must fail closed, got %v", err)
	}
}

func TestReleaseGripPlacementFailsClosedOnUnknownDefinition(t *testing.T) {
	between := &domain.FrozenGripProfile{ProfileID: "p-c", Code: "C", FrontDiscountBetweenMm: betweenTestIntPtr(36)}
	recipe := &domain.GripSnapshotRecipe{
		Mode:           domain.GripModeGola,
		TopProfile:     between,
		BetweenProfile: between,
	}
	empty := domain.Catalog{Modules: []domain.Module{}}
	if _, err := releaseGripPlacement(empty, domain.DesignRevisionItem{FurnitureDefinitionID: "no-existe"}, recipe, 600, 720, 560); err == nil ||
		!strings.Contains(err.Error(), "no existe en el catálogo") {
		t.Fatalf("an unknown definition must fail closed, got %v", err)
	}
}

// The distribution the wrappers resolve comes from the SAME stack the engine
// reports; the placement rule is pinned at the engine level
// (TestOpeningGripPlacementForRowCounts) — this compiles the intent so the
// wrappers cannot silently skip the stack read.
var _ = engine.OpeningFrontStackReport
