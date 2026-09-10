package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #502 / WEB-DT-3 storage proofs for the production approval gate: with an
// exact accepted QuoteRevision pinned, approval enforces the SAME
// authoritative commercial + preflight verdicts as the release command — an
// approval can never bypass blocking state, and the legacy body-less form
// keeps the bare lifecycle transition.

// publishCleanRevision publishes a fresh revision identical to the accepted
// Q3 snapshot (same items, moved spatially — spatial-only, no commercial
// delta) so the commercial gate passes and the preflight is exercised alone.
func publishRevisionFromWorkingCopy(t *testing.T, fx *releaseFixture, baseRev string, items []storage.UpdateDesignWorkingCopyItemCommand) string {
	t.Helper()
	actorA := fiActorA()
	var revID string
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:    fx.designID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			Items:       items,
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			BaseRevisionID: baseRev,
			SourceType:     domain.DesignRevisionSourceSketchup,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		revID = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("publish revision: %v", err)
	}
	return revID
}

func cleanWorkingItems(fx *releaseFixture, widthOverride *float64) []storage.UpdateDesignWorkingCopyItemCommand {
	item := func(fiID string) storage.UpdateDesignWorkingCopyItemCommand {
		width := 600.0
		if widthOverride != nil {
			width = *widthOverride
		}
		return storage.UpdateDesignWorkingCopyItemCommand{
			FurnitureInstanceID:   fiID,
			FurnitureDefinitionID: fiModuleA,
			Parameters:            map[string]any{"widthMm": width, "heightMm": 720.0, "depthMm": 560.0},
			MaterialChoices:       map[string]string{"BODY": releaseMaterial},
			Transform:             domain.Transform3D{TranslationMm: [3]float64{200, 0, 0}},
		}
	}
	return []storage.UpdateDesignWorkingCopyItemCommand{item(fx.fiA), item(fx.fiB)}
}

func TestApproveDesignRevision_ProductionGateHappyPath(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	// Publish a clean revision (spatial-only move vs Q3) and approve it with
	// the exact accepted Q3 pinned: gates pass, transition succeeds.
	revID := publishRevisionFromWorkingCopy(t, fx, fx.revR3, cleanWorkingItems(fx, nil))
	var approved *domain.DesignRevision
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		approved, err = fx.store.ApproveDesignRevisionForProduction(ctx, storage.ApproveDesignRevisionForProductionCommand{
			ProjectID:        fx.projectID,
			DesignID:         fx.designID,
			DesignRevisionID: revID,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("gated approval must succeed on a clean exact pair: %v", err)
	}
	if approved.Status != domain.DesignRevisionStatusApproved {
		t.Fatalf("revision must transition to approved, got %s", approved.Status)
	}

	// Idempotent replay with the same pin keeps returning the approved state.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ApproveDesignRevisionForProduction(ctx, storage.ApproveDesignRevisionForProductionCommand{
			ProjectID:        fx.projectID,
			DesignID:         fx.designID,
			DesignRevisionID: revID,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("idempotent replay must succeed: %v", err)
	}
}

func TestApproveDesignRevision_ProductionGateBlocksOnCommercialChange(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	// Unincorporated commercial change (width 650 vs Q3's 600): the approval
	// gate must reject with the SAME typed commercial blocker the release
	// command returns — no bypass via approval.
	width := 650.0
	revID := publishRevisionFromWorkingCopy(t, fx, fx.revR3, cleanWorkingItems(fx, &width))
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ApproveDesignRevisionForProduction(ctx, storage.ApproveDesignRevisionForProductionCommand{
			ProjectID:        fx.projectID,
			DesignID:         fx.designID,
			DesignRevisionID: revID,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	var commercial *domain.ReleaseCommercialGateError
	if !errors.As(err, &commercial) {
		t.Fatalf("gated approval must reject unincorporated commercial change, got %v", err)
	}

	// The generic lifecycle approval (a SEPARATE concept: design-first flows
	// without a commercial baseline) still transitions the revision — but the
	// commercial Digital Thread stays protected at its own boundary: a
	// quote-pinned release over this revision is rejected by the same gate.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{
			DesignID:         fx.designID,
			DesignRevisionID: revID,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("generic lifecycle approval must keep working: %v", err)
	}
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: revID,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if !errors.As(err, &commercial) {
		t.Fatalf("quote-pinned release must still enforce the commercial gate, got %v", err)
	}
}

func TestApproveDesignRevision_ProductionGateBlocksOnPreflight(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	// Commercially identical revision, but the catalog contract tightens
	// behind the snapshot (widthMm max 500 while both sides carry 600):
	// reconciliation stays clean and ONLY the authoritative preflight
	// rejects — proof that approval cannot bypass a blocked preflight even
	// without any commercial delta.
	revID := publishRevisionFromWorkingCopy(t, fx, fx.revR3, cleanWorkingItems(fx, nil))
	if _, err := fx.admin.Exec(context.Background(), `
		UPDATE modules
		SET parameter_definitions = '[{"name":"widthMm","label":"Ancho","type":"number","defaultValue":600,"required":false,"unit":"mm","category":"dimension","min":300,"max":500,"integer":true}]'::jsonb
		WHERE id = $1`, fiModuleA); err != nil {
		t.Fatalf("tighten catalog contract: %v", err)
	}

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ApproveDesignRevisionForProduction(ctx, storage.ApproveDesignRevisionForProductionCommand{
			ProjectID:        fx.projectID,
			DesignID:         fx.designID,
			DesignRevisionID: revID,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	var preflight *domain.ReleasePreflightBlockedError
	if !errors.As(err, &preflight) {
		t.Fatalf("gated approval must reject a preflight-blocked revision, got %v", err)
	}
	if preflight.Result.Status != domain.ManufacturingPreflightBlocked {
		t.Fatalf("gate must carry the authoritative preflight verdict")
	}

	// The revision was NOT transitioned: approval never lands on a blocked
	// state.
	var status string
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT status FROM design_revisions WHERE id = $1`, revID,
	).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != string(domain.DesignRevisionStatusPublished) {
		t.Fatalf("blocked approval must leave the revision published, got %s", status)
	}
}

func TestApproveDesignRevision_ProductionGateRejectsNonAcceptedBaseline(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	// Draft commercial baseline never grounds a production approval.
	var draftQuoteID string
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		q, err := createFixtureQuoteRevision(ctx, fx.store, storage.CreateQuoteRevisionCommand{
			ProjectID: fx.projectID,
			Notes:     "Q4 draft",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}, LifecycleStatus: "active"},
			},
			Status:         "draft",
			BaseRevisionID: fx.quoteQ3,
		})
		draftQuoteID = q.ID
		return err
	})
	if err != nil {
		t.Fatalf("create draft quote: %v", err)
	}

	revID := publishRevisionFromWorkingCopy(t, fx, fx.revR3, cleanWorkingItems(fx, nil))
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ApproveDesignRevisionForProduction(ctx, storage.ApproveDesignRevisionForProductionCommand{
			ProjectID:        fx.projectID,
			DesignID:         fx.designID,
			DesignRevisionID: revID,
			QuoteRevisionID:  draftQuoteID,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrReleaseQuoteNotAccepted) {
		t.Fatalf("draft baseline must reject the gated approval, got %v", err)
	}

	// Cross-project baseline answers the typed cross-project error.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ApproveDesignRevisionForProduction(ctx, storage.ApproveDesignRevisionForProductionCommand{
			ProjectID:        fx.projectID,
			DesignID:         fx.designID,
			DesignRevisionID: revID,
			QuoteRevisionID:  "7eeeeeee-0000-0000-0000-00000000000e",
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrQuoteRevisionNotFound) && !errors.Is(err, domain.ErrCrossProjectRelease) {
		t.Fatalf("foreign baseline must reject with the typed cross-project/not-found error, got %v", err)
	}

	// The production command has NO skip mode: an empty pin rejects as an
	// invalid command before anything runs.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ApproveDesignRevisionForProduction(ctx, storage.ApproveDesignRevisionForProductionCommand{
			ProjectID:        fx.projectID,
			DesignID:         fx.designID,
			DesignRevisionID: revID,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrInvalidDesignCommand) {
		t.Fatalf("production approval without the exact quote pin must reject, got %v", err)
	}
}
