package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// A command cannot borrow a READ COMMITTED tenant transaction after one
// catalog read and then combine it with a later committed catalog mutation.
// The second connection commits before the command begins: no timing or mock
// is involved. Release already rejects this boundary; preflight and approval
// must make the same promise.
func TestFrozenBaseCommands_RejectInconsistentBorrowedCatalogView(t *testing.T) {
	for _, command := range []string{"preflight", "approval", "release"} {
		t.Run(command, func(t *testing.T) {
			fx := setupFrozenBaseReleaseFixture(t, "plinth_board")
			revisionID := fx.revR3
			if command == "approval" {
				items := make([]storage.UpdateDesignWorkingCopyItemCommand, 0, 2)
				for _, id := range []string{fx.fiA, fx.fiB} {
					items = append(items, storage.UpdateDesignWorkingCopyItemCommand{
						FurnitureInstanceID: id, FurnitureDefinitionID: fiModuleA,
						Parameters:      map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
						MaterialChoices: map[string]string{"BODY": releaseMaterial, "ZOCLO": releaseMaterial},
						Transform:       domain.Transform3D{TranslationMm: [3]float64{200, 0, 0}},
					})
				}
				revisionID = publishRevisionFromWorkingCopy(t, fx, fx.revR3, items)
			}

			err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
				if _, err := fx.store.GetFullCatalog(ctx); err != nil {
					return err
				}
				// Independent connection commits a catalog mutation between source
				// reads of the still-open tenant transaction.
				multiOrgExec(t, fx.admin, `DELETE FROM structure_components WHERE structure_id='71000000-0000-0000-0000-000000000001'`)
				switch command {
				case "preflight":
					_, err := fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, revisionID, fx.quoteQ3)
					return err
				case "approval":
					_, err := fx.store.ApproveDesignRevisionForProduction(ctx, storage.ApproveDesignRevisionForProductionCommand{
						ProjectID: fx.projectID, DesignID: fx.designID, DesignRevisionID: revisionID,
						QuoteRevisionID: fx.quoteQ3, ActorUserID: rlsUserA,
					})
					return err
				default:
					_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
						ProjectID: fx.projectID, DesignRevisionID: revisionID,
						QuoteRevisionID: fx.quoteQ3, ActorUserID: rlsUserA,
					})
					return err
				}
			})
			if !errors.Is(err, storage.ErrInconsistentCatalogTransaction) {
				t.Fatalf("%s must reject the borrowed READ COMMITTED boundary, got %v", command, err)
			}
		})
	}
}

func TestFrozenBaseCommands_SameSnapshotThenFreshCommandReevaluates(t *testing.T) {
	fx := setupFrozenBaseReleaseFixture(t, "plinth_board")
	items := make([]storage.UpdateDesignWorkingCopyItemCommand, 0, 2)
	for _, id := range []string{fx.fiA, fx.fiB} {
		items = append(items, storage.UpdateDesignWorkingCopyItemCommand{
			FurnitureInstanceID: id, FurnitureDefinitionID: fiModuleA,
			Parameters:      map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
			MaterialChoices: map[string]string{"BODY": releaseMaterial, "ZOCLO": releaseMaterial},
			Transform:       domain.Transform3D{TranslationMm: [3]float64{200, 0, 0}},
		})
	}
	revisionID := publishRevisionFromWorkingCopy(t, fx, fx.revR3, items)
	actor := fiActorA()
	var releaseID string
	err := fx.store.WithinTenantTx(storage.WithConsistentCatalogTx(context.Background()), actor, func(ctx context.Context) error {
		// The first catalog read pins the PostgreSQL snapshot on the runtime
		// connection. A different connection then commits a destructive catalog
		// edit before any of the three commands run.
		if _, err := fx.store.GetFullCatalog(ctx); err != nil {
			return err
		}
		multiOrgExec(t, fx.admin, `DELETE FROM structure_components WHERE structure_id='71000000-0000-0000-0000-000000000001'`)
		preflight, err := fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, revisionID, fx.quoteQ3)
		if err != nil {
			return err
		}
		if preflight.Status != domain.ManufacturingPreflightReady {
			t.Fatalf("coherent old snapshot should be READY, got %+v", preflight)
		}
		if _, err := fx.store.ApproveDesignRevisionForProduction(ctx, storage.ApproveDesignRevisionForProductionCommand{
			ProjectID: fx.projectID, DesignID: fx.designID, DesignRevisionID: revisionID,
			QuoteRevisionID: fx.quoteQ3, ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		release, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID: fx.projectID, DesignRevisionID: revisionID,
			QuoteRevisionID: fx.quoteQ3, ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		releaseID = release.Release.ID
		return nil
	})
	if err != nil || releaseID == "" {
		t.Fatalf("coherent preflight, approval and release must agree: release=%q err=%v", releaseID, err)
	}
	// This is a NEW command boundary, not a transaction held between HTTP
	// requests. Its new snapshot must see the committed catalog edit and may
	// legitimately block where the earlier command was READY.
	var fresh *domain.ManufacturingPreflightResult
	err = fx.store.WithinTenantTx(storage.WithConsistentCatalogTx(context.Background()), actor, func(ctx context.Context) error {
		var err error
		fresh, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, revisionID, fx.quoteQ3)
		return err
	})
	if err != nil || fresh.Status != domain.ManufacturingPreflightBlocked {
		t.Fatalf("a later command must re-evaluate against the new catalog, got %+v err=%v", fresh, err)
	}
	err = fx.store.WithinTenantTx(storage.WithConsistentCatalogTx(context.Background()), actor, func(ctx context.Context) error {
		_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID: fx.projectID, DesignRevisionID: revisionID,
			QuoteRevisionID: fx.quoteQ3, ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, storage.ErrReleaseSnapshotResolution) {
		t.Fatalf("later release must block against its own fresh catalog snapshot, got %v", err)
	}
}
