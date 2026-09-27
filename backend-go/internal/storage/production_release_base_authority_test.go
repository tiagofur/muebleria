package storage_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

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
// the catalog module does not default to. withContext=false produces the
// legacy shape (units without pricing context) for the fail-closed proofs.
func frozenBaseCommercialSnapshot(projectID string, items []storage.CreateQuoteRevisionItemCommand, baseMode string, clearance int, withContext bool) *domain.QuoteCommercialSnapshot {
	lines := map[string]*domain.QuoteCommercialLine{}
	units := make([]domain.QuoteCommercialUnit, 0, len(items))
	for _, item := range items {
		lineID := item.FurnitureInstanceID
		if lines[lineID] == nil {
			lines[lineID] = &domain.QuoteCommercialLine{QuoteLineID: lineID, Quantity: 1}
		}
		lines[lineID].FurnitureInstanceIDs = append(lines[lineID].FurnitureInstanceIDs, item.FurnitureInstanceID)
		unit := domain.QuoteCommercialUnit{
			FurnitureInstanceID: item.FurnitureInstanceID,
			QuoteLineID:         lineID,
			ModuleCode:          "RLS-MODULE",
			ModuleName:          "RLS module",
			LifecycleStatus:     "active",
			Options:             []domain.QuoteCommercialOption{},
		}
		if withContext {
			unit.PricingContext = &domain.QuoteCommercialPricingContext{BaseMode: baseMode, BaseClearanceMm: &clearance}
		}
		units = append(units, unit)
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

func frozenBaseFixtureOptions(baseMode string, withContext bool) releaseFixtureOptions {
	return releaseFixtureOptions{
		choices: map[string]string{"BODY": releaseMaterial, "ZOCLO": releaseMaterial},
		quoteSnapshot: func(items []storage.CreateQuoteRevisionItemCommand) *domain.QuoteCommercialSnapshot {
			return frozenBaseCommercialSnapshot(fiSharedProject, items, baseMode, frozenBaseClearanceMm, withContext)
		},
		// The synthesized zócalo carries a banded front edge: like the real
		// melamine catalog, the board resolves it from its default edge band —
		// no EDGE choice the module-default convergence would drop.
		seedCatalog: func(t *testing.T, admin *pgxpool.Pool) {
			if _, err := admin.Exec(context.Background(),
				`UPDATE material_boards SET default_edge_band_id = '70000000-0000-0000-0000-000000000003' WHERE id = $1`, releaseMaterial); err != nil {
				t.Fatalf("seed default edge band: %v", err)
			}
		},
	}
}

// setupFrozenBaseReleaseFixture is the canonical release demo with a frozen
// base-mode commercial truth: Q3 froze `baseMode` (Y) while the catalog module
// keeps its own default (X, unset → none), and the revision retains the base
// role Y consumes (#826 keeps base-treatment choices at write).
func setupFrozenBaseReleaseFixture(t *testing.T, baseMode string) *releaseFixture {
	t.Helper()
	return setupReleaseFixtureWithOptions(t, frozenBaseFixtureOptions(baseMode, true))
}

func zocloPart(t *testing.T, unit storage.ReleaseManufacturingUnit) (domain.ResolvedBoardPart, bool) {
	t.Helper()
	for _, part := range unit.Resolved.BOM.BoardParts {
		if part.OptionRole == "ZOCLO" {
			return part, true
		}
	}
	return domain.ResolvedBoardPart{}, false
}

// The exact accepted quote governs: preflight-with-quote READY, release
// SUCCESS, frozen BOM under the quoted mode, and a later module-default
// mutation cannot reinterpret the quoted truth (#830 §A/§B, acceptance flow).
func TestProductionRelease_FrozenBaseAuthority_QuotedFrozenModeWins(t *testing.T) {
	fx := setupFrozenBaseReleaseFixture(t, "plinth_board")
	actorA := fiActorA()

	// PARITY: the quoted preflight evaluates the same frozen authority the
	// release consumes — READY before any release exists.
	var preflight *domain.ManufacturingPreflightResult
	if err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		preflight, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, fx.revR3, fx.quoteQ3)
		return err
	}); err != nil {
		t.Fatalf("quoted preflight must evaluate: %v", err)
	}
	if preflight.Status != domain.ManufacturingPreflightReady {
		t.Fatalf("quoted preflight under frozen plinth_board must be READY, got %+v", preflight)
	}

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

	// Frozen BOM evidence (§10): the exact Q → pricing context → resolved BOM
	// → frozen release snapshot chain, without consulting mutable project state.
	var snapshot *storage.ReleaseManufacturingSnapshot
	if err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
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
		part, ok := zocloPart(t, unit)
		if !ok {
			t.Fatalf("unit %s BOM must carry the zócalo part the frozen mode consumes", unit.Resolved.FurnitureInstanceID)
		}
		if part.LengthMm != 600 || part.WidthMm != frozenBaseClearanceMm {
			t.Fatalf("zócalo part must carry the frozen clearance (%d×%d), got %d×%d",
				600, frozenBaseClearanceMm, part.LengthMm, part.WidthMm)
		}
	}

	// Module-default mutation AFTER the accepted Q must not reinterpret quoted
	// truth: same R3 + same Q3 keeps resolving under plinth_board — never the
	// mutated default — and the second release freezes the same zócalo BOM.
	multiOrgExec(t, fx.admin, `UPDATE modules SET base_mode='legs' WHERE id='`+fiModuleA+`';`)
	var preflightAfter *domain.ManufacturingPreflightResult
	if err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		preflightAfter, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, fx.revR3, fx.quoteQ3)
		return err
	}); err != nil {
		t.Fatalf("quoted preflight after catalog mutation must evaluate: %v", err)
	}
	if preflightAfter.Status != domain.ManufacturingPreflightReady {
		t.Fatalf("frozen authority must be immune to the module-default mutation, got %+v", preflightAfter)
	}
	var p2 *storage.ProductionReleaseReadback
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		p2, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
			RequestID:        "req-830-frozen-base-replay",
		})
		return err
	})
	if err != nil {
		t.Fatalf("re-release under the frozen authority must succeed after catalog mutation: %v", err)
	}
	var snapshot2 *storage.ReleaseManufacturingSnapshot
	if err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		snapshot2, err = fx.store.GetProductionReleaseManufacturingSnapshot(ctx, fx.projectID, p2.Release.ID)
		return err
	}); err != nil {
		t.Fatalf("read second manufacturing snapshot: %v", err)
	}
	if len(snapshot2.Units) != len(snapshot.Units) {
		t.Fatalf("both releases must freeze the same unit count")
	}
	for i, unit := range snapshot2.Units {
		part, ok := zocloPart(t, unit)
		if !ok || part.WidthMm != frozenBaseClearanceMm || part.LengthMm != 600 {
			t.Fatalf("release #2 must keep the frozen interpretation (plinth_board), got %+v", part)
		}
		if unit.Resolved.FurnitureInstanceID != snapshot.Units[i].Resolved.FurnitureInstanceID {
			t.Fatalf("unit order/identity must stay stable between releases")
		}
	}

	// QUOTE-LESS policy (no contamination): without the exact quote pin the
	// same revision resolves under the mutated module default (legs) — the
	// retained ZOCLO choice is honestly rejected, never absorbed by the frozen
	// context of a quote nobody pinned.
	var quoteLessPreflight *domain.ManufacturingPreflightResult
	if err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		quoteLessPreflight, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, fx.revR3, "")
		return err
	}); err != nil {
		t.Fatalf("quote-less preflight must evaluate: %v", err)
	}
	if quoteLessPreflight.Status != domain.ManufacturingPreflightBlocked {
		t.Fatalf("quote-less preflight must honestly block the retained choice under the module default, got %+v", quoteLessPreflight)
	}
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			ActorUserID:      rlsUserA,
			RequestID:        "req-830-quote-less",
		})
		return err
	})
	if !errors.Is(err, storage.ErrReleaseSnapshotResolution) {
		t.Fatalf("quote-less release must keep the module-default policy (BLOCK), got %v", err)
	}
}

// Legacy quoted snapshots fail closed (#830 §C): a quoted release whose frozen
// units carry no pricing context — or a malformed one — never degrades to the
// quote-less behavior. Both the preflight verdict and the release command
// block with the typed frozen-base cause.
func TestProductionRelease_FrozenBaseAuthority_LegacyContextFailsClosed(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		patchFunc func(payload map[string]any)
		cause     string
	}{
		{name: "missing pricing context", cause: domain.FrozenBaseContextMissingCause, patchFunc: func(payload map[string]any) {
			for _, unit := range payload["units"].([]any) {
				delete(unit.(map[string]any), "pricingContext")
			}
		}},
		{name: "malformed base mode", cause: domain.FrozenBaseContextInvalidCause, patchFunc: func(payload map[string]any) {
			for _, unit := range payload["units"].([]any) {
				unit.(map[string]any)["pricingContext"].(map[string]any)["baseMode"] = "plastic"
			}
		}},
		{name: "incomplete base context", cause: domain.FrozenBaseContextInvalidCause, patchFunc: func(payload map[string]any) {
			for _, unit := range payload["units"].([]any) {
				delete(unit.(map[string]any)["pricingContext"].(map[string]any), "baseClearanceMm")
			}
		}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fx := setupFrozenBaseReleaseFixture(t, "plinth_board")
			actorA := fiActorA()

			// Simulate the legacy/malformed frozen truth directly on the
			// immutable row (the normal builders never write these shapes).
			var raw []byte
			if err := fx.admin.QueryRow(context.Background(),
				`SELECT commercial_snapshot FROM quote_revisions WHERE id = $1`, fx.quoteQ3).Scan(&raw); err != nil {
				t.Fatal(err)
			}
			var payload map[string]any
			if err := json.Unmarshal(raw, &payload); err != nil {
				t.Fatal(err)
			}
			scenario.patchFunc(payload)
			patched, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			multiOrgExec(t, fx.admin, `ALTER TABLE quote_revisions DISABLE TRIGGER protect_quote_revisions_immutable`)
			t.Cleanup(func() {
				multiOrgExec(t, fx.admin, `ALTER TABLE quote_revisions ENABLE TRIGGER protect_quote_revisions_immutable`)
			})
			if _, err := fx.admin.Exec(context.Background(),
				`UPDATE quote_revisions SET commercial_snapshot = $2 WHERE id = $1`, fx.quoteQ3, patched); err != nil {
				t.Fatalf("patch frozen snapshot: %v", err)
			}

			var preflight *domain.ManufacturingPreflightResult
			if err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
				var err error
				preflight, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, fx.revR3, fx.quoteQ3)
				return err
			}); err != nil {
				t.Fatalf("quoted preflight must answer the blocked verdict, got %v", err)
			}
			if preflight.Status != domain.ManufacturingPreflightBlocked || len(preflight.Issues) == 0 {
				t.Fatalf("legacy frozen context must BLOCK the quoted preflight, got %+v", preflight)
			}
			if preflight.Issues[0].Code != domain.PreflightIssueFrozenBaseContext {
				t.Fatalf("expected frozen_base_context issue, got %+v", preflight.Issues[0])
			}

			err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
				_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
					ProjectID:        fx.projectID,
					DesignRevisionID: fx.revR3,
					QuoteRevisionID:  fx.quoteQ3,
					ActorUserID:      rlsUserA,
					RequestID:        "req-830-legacy-" + scenario.name,
				})
				return err
			})
			// Even when the earlier reconciliation gate parses the frozen
			// snapshot first, malformed quoted base truth has the same typed
			// business blocker as a missing unit context, never a generic
			// invalid-snapshot error that the API could mistake for a 500.
			var frozen *domain.FrozenBaseContextError
			if !errors.As(err, &frozen) {
				t.Fatalf("release must reject with a typed frozen-base blocker, got %T %v", err, err)
			}
			if frozen.Cause != scenario.cause {
				t.Fatalf("expected frozen cause %s, got %s", scenario.cause, frozen.Cause)
			}
			var releaseCount int
			if err := fx.admin.QueryRow(context.Background(),
				`SELECT count(*) FROM production_releases WHERE project_id = $1`, fx.projectID).Scan(&releaseCount); err != nil || releaseCount != 0 {
				t.Fatalf("no release may commit, got %d (err=%v)", releaseCount, err)
			}
		})
	}
}

// Exact-unit binding (#830 §identity): a quoted authority must bind every
// physical identity of the revision. A revision unit the accepted quote never
// covered fails closed — the preflight surfaces the frozen-base unit mismatch,
// and no release may silently borrow another unit's commercial truth.
func TestProductionRelease_FrozenBaseAuthority_UnitMismatchFailsClosed(t *testing.T) {
	fx := setupFrozenBaseReleaseFixture(t, "plinth_board")
	actorA := fiActorA()

	// A third physical unit appears after the accepted Q3: new line, new
	// instance, R4 with three units while Q3 froze two.
	lineID := "60000000-0000-0000-0000-000000000094"
	if _, err := fx.admin.Exec(context.Background(), `
		INSERT INTO project_items (id, project_id, module_id, quantity, custom_dims, organization_id)
		VALUES ($1, $2, $3, 1, '{"widthMm": 600, "heightMm": 720, "depthMm": 560}', '`+rlsOrgA+`')`,
		lineID, fiSharedProject, fiModuleA); err != nil {
		t.Fatal(err)
	}
	var revR4 string
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		matRes, err := fx.store.MaterializeQuoteLine(ctx, storage.MaterializeQuoteLineCommand{
			ProjectID: fiSharedProject, QuoteLineID: lineID, ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		fiC := matRes.Instances[0].FurnitureInstanceID
		item := func(fiID string) storage.UpdateDesignWorkingCopyItemCommand {
			return storage.UpdateDesignWorkingCopyItemCommand{
				FurnitureInstanceID:   fiID,
				FurnitureDefinitionID: fiModuleA,
				Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
				MaterialChoices:       map[string]string{"BODY": releaseMaterial, "ZOCLO": releaseMaterial},
			}
		}
		if _, err := UpdateWorkingCopyCurrent(ctx, fx.store, storage.UpdateDesignWorkingCopyCommand{
			DesignID:    fx.designID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			Items:       []storage.UpdateDesignWorkingCopyItemCommand{item(fx.fiA), item(fx.fiB), item(fiC)},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			BaseRevisionID: fx.revR3,
			SourceType:     domain.DesignRevisionSourceSketchup,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		revR4 = rev.ID
		_, err = fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{
			DesignID: fx.designID, DesignRevisionID: rev.ID, ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish R4 with the extra unit: %v", err)
	}

	var preflight *domain.ManufacturingPreflightResult
	if err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		preflight, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, revR4, fx.quoteQ3)
		return err
	}); err != nil {
		t.Fatalf("quoted preflight must answer the blocked verdict, got %v", err)
	}
	if preflight.Status != domain.ManufacturingPreflightBlocked || len(preflight.Issues) == 0 ||
		preflight.Issues[0].Code != domain.PreflightIssueFrozenBaseContext ||
		preflight.Issues[0].FurnitureInstanceID == "" {
		t.Fatalf("unbound unit must BLOCK with frozen_base_context + exact identity, got %+v", preflight)
	}

	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: revR4,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
			RequestID:        "req-830-unit-mismatch",
		})
		return err
	})
	if err == nil {
		t.Fatal("release over a unit the quote never covered must fail closed")
	}
}

// Cross-project/tenant authority (#830 §11): the quoted preflight never
// accepts a baseline from another project, and a foreign revision is not
// visible under the tenant RLS read at all.
func TestProductionRelease_FrozenBaseAuthority_ForeignQuoteRejected(t *testing.T) {
	fx := setupFrozenBaseReleaseFixture(t, "plinth_board")
	actorA := fiActorA()

	// A quote from the actor's own org but a DIFFERENT project: the baseline
	// contract rejects it before any authority is consumed.
	var foreignQuoteID string
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		instance, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID: fiProjectAOnly,
			Origin:    domain.FurnitureInstanceOriginManual,
		})
		if err != nil {
			return err
		}
		items := []storage.CreateQuoteRevisionItemCommand{{
			FurnitureInstanceID: instance.ID,
			LifecycleStatus:     "active",
		}}
		q, err := createFixtureQuoteRevision(ctx, fx.store, storage.CreateQuoteRevisionCommand{
			ProjectID:          fiProjectAOnly,
			Notes:              "foreign project quote",
			Status:             "accepted",
			Items:              items,
			CommercialSnapshot: frozenBaseCommercialSnapshot(fiProjectAOnly, items, "plinth_board", frozenBaseClearanceMm, true),
		})
		foreignQuoteID = q.ID
		return err
	})
	if err != nil {
		t.Fatalf("create foreign quote: %v", err)
	}
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, fx.revR3, foreignQuoteID)
		return err
	})
	if !errors.Is(err, domain.ErrCrossProjectRelease) {
		t.Fatalf("cross-project quote must reject the quoted preflight, got %v", err)
	}

	// Tenant boundary: org B reads the shared project's revision by design,
	// but its OWN project's quote never grounds org A's revision — the
	// baseline contract rejects it exactly like the release command would.
	var orgBQuoteID string
	err = releaseTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		instance, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID: fiProjectB,
			Origin:    domain.FurnitureInstanceOriginManual,
		})
		if err != nil {
			return err
		}
		items := []storage.CreateQuoteRevisionItemCommand{{
			FurnitureInstanceID: instance.ID,
			LifecycleStatus:     "active",
		}}
		q, err := createFixtureQuoteRevision(ctx, fx.store, storage.CreateQuoteRevisionCommand{
			ProjectID:          fiProjectB,
			Notes:              "org B own project quote",
			Status:             "accepted",
			Items:              items,
			CommercialSnapshot: frozenBaseCommercialSnapshot(fiProjectB, items, "plinth_board", frozenBaseClearanceMm, true),
		})
		orgBQuoteID = q.ID
		return err
	})
	if err != nil {
		t.Fatalf("create org B quote: %v", err)
	}
	err = releaseTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, fx.revR3, orgBQuoteID)
		return err
	})
	if !errors.Is(err, domain.ErrCrossProjectRelease) {
		t.Fatalf("org B's own quote must never ground org A's shared revision, got %v", err)
	}
}
