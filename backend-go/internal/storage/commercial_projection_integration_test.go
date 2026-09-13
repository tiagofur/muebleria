package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestDesignCommercialProjection_RealPostgresUsesWorkingCopyAndAcceptedReference(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	q1 := createInitialRevision(t, fx)
	publishRevision(t, fx, q1.Revision.ID)
	acceptRevision(t, fx, q1.Revision.ID)
	details := listRevisions(t, fx)
	if len(details) != 1 || len(details[0].Items) < 1 {
		t.Fatal("fixture did not materialize quote units")
	}
	unit := details[0].Items[0]

	var designID string
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		design, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{ProjectID: csProject, Name: "Presupuesto SketchUp", ActorUserID: rlsUserA})
		if err != nil {
			return err
		}
		designID = design.ID
		_, err = fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID: design.ID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{{
				FurnitureInstanceID: unit.FurnitureInstanceID, FurnitureDefinitionID: csModule,
				Parameters:      map[string]any{},
				MaterialChoices: map[string]string{"INTERIOR": csMaterial},
			}},
		})
		return err
	})
	if err != nil {
		t.Fatalf("seed design: %v", err)
	}

	var projection *domain.CommercialProjection
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var readErr error
		projection, readErr = fx.store.GetDesignCommercialProjection(ctx, csProject, designID)
		return readErr
	})
	if err != nil {
		t.Fatalf("projection: %v", err)
	}
	if projection.Status != domain.CommercialProjectionCurrent || projection.Amounts == nil || projection.Amounts.SaleTotal == nil {
		t.Fatalf("projection incomplete: %+v", projection)
	}
	if *projection.Amounts.SaleTotal != 294 {
		t.Fatalf("sale=%v want 294 from existing pricing authority", *projection.Amounts.SaleTotal)
	}
	if projection.Reference == nil || projection.Reference.QuoteRevisionID != q1.Revision.ID || projection.Comparison == nil || projection.Comparison.AbsoluteDelta != -194 {
		t.Fatalf("reference/delta=%+v/%+v", projection.Reference, projection.Comparison)
	}
	if projection.WorkingFingerprint == "" || projection.ProjectionFingerprint == nil || projection.CatalogFingerprint == nil {
		t.Fatalf("exact version evidence missing: %+v", projection)
	}
	firstWorkingFingerprint := projection.WorkingFingerprint

	// The existing confirmed working-copy command is the only write. A material
	// change must produce a new exact projection without creating QuoteRevision Q2.
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, updateErr := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID: designID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{{
				FurnitureInstanceID: unit.FurnitureInstanceID, FurnitureDefinitionID: csModule,
				Parameters: map[string]any{}, MaterialChoices: map[string]string{"INTERIOR": csMaterial2},
			}},
		})
		return updateErr
	})
	if err != nil {
		t.Fatalf("update design material: %v", err)
	}
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var readErr error
		projection, readErr = fx.store.GetDesignCommercialProjection(ctx, csProject, designID)
		return readErr
	})
	if err != nil {
		t.Fatalf("updated projection: %v", err)
	}
	if projection.Amounts == nil || projection.Amounts.SaleTotal == nil || *projection.Amounts.SaleTotal != 438 {
		t.Fatalf("updated sale=%+v want 438", projection.Amounts)
	}
	if projection.WorkingFingerprint == firstWorkingFingerprint {
		t.Fatal("confirmed material change did not change exact working fingerprint")
	}
	if got := len(listRevisions(t, fx)); got != 1 {
		t.Fatalf("projection refresh created a QuoteRevision: got %d", got)
	}

	err = fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, readErr := fx.store.GetDesignCommercialProjection(ctx, csProject, designID)
		return readErr
	})
	if !errors.Is(err, domain.ErrDesignNotFound) {
		t.Fatalf("cross-tenant error=%v want uniform not found", err)
	}
}
