package storage_test

import (
	"context"
	"errors"
	"fmt"
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
	// Current pricing must consume the project's live kitchen plan. This wall
	// placement suppresses the module's otherwise synthesized plinth board; if
	// the projection drops KitchenLayout, it returns a plausible but wrong total.
	multiOrgExec(t, fx.admin, `
		UPDATE modules
		SET base_mode = 'plinth_board', width_mm = 800, depth_mm = 600
		WHERE id = '`+csModule+`';
		INSERT INTO project_level_choices (project_id, option_group_code, choice_entity_id, organization_id)
		VALUES ('`+csProject+`', 'INTERIOR', '`+csMaterial+`', '`+rlsOrgA+`');
		UPDATE projects
		SET kitchen_layout = '{"walls":[{"id":"w-1","lengthMm":3000}],"placements":[{"itemId":"`+csLine+`","instanceIndex":0,"wallId":"w-1","offsetMm":0,"elevation":"wall"}]}'::jsonb
		WHERE id = '`+csProject+`';`)

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
				MaterialChoices: map[string]string{"FRENTE": csMaterial},
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
	firstProjectionFingerprint := *projection.ProjectionFingerprint

	// A quote-line base override is part of the current pricing context even
	// though DesignWorkingCopy identifies the physical unit. It must therefore
	// change the exact projection input instead of silently falling back to the
	// module default.
	multiOrgExec(t, fx.admin, `
		UPDATE project_items SET base_mode = 'none' WHERE id = '`+csLine+`';`)
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var readErr error
		projection, readErr = fx.store.GetDesignCommercialProjection(ctx, csProject, designID)
		return readErr
	})
	if err != nil {
		t.Fatalf("projection after base override: %v", err)
	}
	if projection.Status != domain.CommercialProjectionCurrent || projection.ProjectionFingerprint == nil ||
		*projection.ProjectionFingerprint == firstProjectionFingerprint {
		t.Fatalf("line base override missing from exact projection input: %+v", projection)
	}

	// The existing confirmed working-copy command is the only write. A material
	// change must produce a new exact projection without creating QuoteRevision Q2.
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, updateErr := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID: designID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{{
				FurnitureInstanceID: unit.FurnitureInstanceID, FurnitureDefinitionID: csModule,
				Parameters: map[string]any{}, MaterialChoices: map[string]string{"INTERIOR": csMaterial2, "FRENTE": csMaterial2},
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

	multiOrgExec(t, fx.admin, `
		ALTER TABLE projects DISABLE TRIGGER protect_project_organization_ownership;
		UPDATE projects
		SET manufacturing_organization_id = '`+rlsOrgB+`'
		WHERE id = '`+csProject+`';
		ALTER TABLE projects ENABLE TRIGGER protect_project_organization_ownership;`)
	var manufacturingOrg string
	if readErr := fx.admin.QueryRow(context.Background(),
		`SELECT manufacturing_organization_id::text FROM projects WHERE id=$1`, csProject).Scan(&manufacturingOrg); readErr != nil {
		t.Fatalf("read manufacturing assignment: %v", readErr)
	}
	if manufacturingOrg != rlsOrgB {
		t.Fatalf("manufacturing assignment=%s want %s", manufacturingOrg, rlsOrgB)
	}
	err = fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		if _, workingErr := fx.store.GetDesignWorkingCopy(ctx, designID); workingErr != nil {
			return fmt.Errorf("manufacturing working copy: %w", workingErr)
		}
		if _, revisionsErr := fx.store.ListQuoteRevisionsByProject(ctx, csProject); revisionsErr != nil {
			return fmt.Errorf("manufacturing quote references: %w", revisionsErr)
		}
		var readErr error
		projection, readErr = fx.store.GetDesignCommercialProjection(ctx, csProject, designID)
		return readErr
	})
	if err != nil {
		t.Fatalf("manufacturing projection: %v", err)
	}
	if projection.Status != domain.CommercialProjectionIncomplete || projection.Amounts != nil ||
		!projection.CostsWithheld || !projection.SaleAmountsWithheld || projection.Comparison != nil {
		t.Fatalf("manufacturing projection disclosed commercial amounts: %+v", projection)
	}
	if projection.Reference == nil || projection.Reference.SaleTotal != nil {
		t.Fatalf("manufacturing reference disclosure=%+v", projection.Reference)
	}

	err = fiTx(t, fx.store, storage.TenantActor{OrganizationID: rlsOrgC, UserID: rlsUserA}, func(ctx context.Context) error {
		_, readErr := fx.store.GetDesignCommercialProjection(ctx, csProject, designID)
		return readErr
	})
	if !errors.Is(err, domain.ErrDesignNotFound) {
		t.Fatalf("cross-tenant error=%v want uniform not found", err)
	}
}
