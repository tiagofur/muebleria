package storage_test

import (
	"context"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #830 — frozen base-treatment authority: when a ProductionRelease pins an
// accepted QuoteRevision, the per-unit QuoteCommercialPricingContext frozen in
// that exact revision governs manufacturing resolution. These proofs run
// against real PostgreSQL under the tenant RLS runtime role.

const frozenBaseClearanceMm = 120

// frozenBaseCommercialSnapshot builds a structurally valid frozen commercial
// truth whose units carry an explicit base-mode pricing context — what an
// accepted modern quote freezes when the sale was made with a base treatment
// the catalog module does not default to.
func frozenBaseCommercialSnapshot(projectID string, items []storage.CreateQuoteRevisionItemCommand, baseMode string, clearance int) *domain.QuoteCommercialSnapshot {
	lines := map[string]*domain.QuoteCommercialLine{}
	units := make([]domain.QuoteCommercialUnit, 0, len(items))
	for _, item := range items {
		lineID := item.FurnitureInstanceID
		if lines[lineID] == nil {
			lines[lineID] = &domain.QuoteCommercialLine{QuoteLineID: lineID, Quantity: 1}
		}
		lines[lineID].FurnitureInstanceIDs = append(lines[lineID].FurnitureInstanceIDs, item.FurnitureInstanceID)
		units = append(units, domain.QuoteCommercialUnit{
			FurnitureInstanceID: item.FurnitureInstanceID,
			QuoteLineID:         lineID,
			ModuleCode:          "RLS-MODULE",
			ModuleName:          "RLS module",
			LifecycleStatus:     "active",
			Options:             []domain.QuoteCommercialOption{},
			PricingContext:      &domain.QuoteCommercialPricingContext{BaseMode: baseMode, BaseClearanceMm: &clearance},
		})
	}
	ordered := make([]domain.QuoteCommercialLine, 0, len(lines))
	for _, line := range lines {
		ordered = append(ordered, *line)
	}
	snapshot, err := domain.BuildQuoteCommercialSnapshot(
		time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC), "MXN",
		domain.QuoteCommercialIdentity{ID: projectID, Name: "Fixture customer"},
		domain.QuoteCommercialIdentity{ID: projectID, Name: "Fixture project"},
		domain.QuoteBreakdown{MarginFactor: 1}, ordered, units)
	if err != nil {
		panic(err)
	}
	return snapshot
}

// setupFrozenBaseReleaseFixture is the canonical release demo with a frozen
// base-mode commercial truth: Q3 froze `baseMode` (Y) while the catalog module
// keeps its own default (X, unset → none), and the revision retains the base
// role Y consumes (#826 keeps base-treatment choices at write).
func setupFrozenBaseReleaseFixture(t *testing.T, baseMode string) *releaseFixture {
	t.Helper()
	return setupReleaseFixtureWithOptions(t, releaseFixtureOptions{
		choices: map[string]string{"BODY": releaseMaterial, "ZOCLO": releaseMaterial},
		quoteSnapshot: func(items []storage.CreateQuoteRevisionItemCommand) *domain.QuoteCommercialSnapshot {
			return frozenBaseCommercialSnapshot(fiSharedProject, items, baseMode, frozenBaseClearanceMm)
		},
	})
}

// RED (#830): the accepted quote legitimately froze base mode plinth_board
// while the module defaults to none. The retained ZOCLO choice was commercially
// valid; the quoted release must consume the frozen mode, resolve and succeed.
func TestProductionRelease_FrozenBaseAuthority_QuotedFrozenModeWins(t *testing.T) {
	fx := setupFrozenBaseReleaseFixture(t, "plinth_board")
	actorA := fiActorA()

	var p1 *storage.ProductionReleaseReadback
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		p1, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
			RequestID:        "req-830-frozen-base",
		})
		return err
	})
	if err != nil {
		t.Fatalf("#830: quoted release under frozen base mode plinth_board must succeed, got: %v", err)
	}
	if p1.Release.QuoteRevisionID != fx.quoteQ3 || p1.Release.DesignRevisionID != fx.revR3 {
		t.Fatalf("release must pin the exact pair, got %+v", p1.Release)
	}

	// Frozen BOM evidence (§10): the exact Q → pricing context → resolved BOM →
	// frozen release snapshot chain, without consulting mutable project state.
	var snapshot *storage.ReleaseManufacturingSnapshot
	if err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		snapshot, err = fx.store.GetProductionReleaseManufacturingSnapshot(ctx, fx.projectID, p1.Release.ID)
		return err
	}); err != nil {
		t.Fatalf("read manufacturing snapshot: %v", err)
	}
	if len(snapshot.Units) != 2 {
		t.Fatalf("snapshot must freeze both physical units, got %d", len(snapshot.Units))
	}
	for _, unit := range snapshot.Units {
		foundZoclo := false
		for _, part := range unit.Resolved.BOM.BoardParts {
			if part.OptionRole == "ZOCLO" {
				foundZoclo = true
				if part.LengthMm != 600 || part.WidthMm != frozenBaseClearanceMm {
					t.Fatalf("zócalo part must carry the frozen clearance (%d×%d), got %d×%d",
						600, frozenBaseClearanceMm, part.LengthMm, part.WidthMm)
				}
			}
		}
		if !foundZoclo {
			t.Fatalf("unit %s BOM must carry the zócalo part the frozen mode consumes", unit.Resolved.FurnitureInstanceID)
		}
	}
}
