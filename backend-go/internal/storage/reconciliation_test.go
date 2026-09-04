package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #393 / DT-9: QuoteRevision ↔ DesignRevision reconciliation by FurnitureInstance
// against real PostgreSQL under the app role.
//
// Key contracts verified:
// - Physical join key is strictly FurnitureInstance.id (never definition, dimensions, or similarity)
// - Negative Proof E: same-looking items with different identities produce quoted_not_modeled and modeled_not_quoted, NOT synced
// - Quantity > 1 evaluates at unit-level
// - Cross-project reconciliation is rejected with domain.ErrCrossProjectReconciliation
// - Immutability: reconciliation is purely read-only and causes ZERO mutations to quotes or designs
// - Multi-org isolation: organizations cannot access or reconcile other organizations' projects

func TestReconciliation_SyncedAndModified(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	ctx := context.Background()

	lineID := "60000000-0000-0000-0000-000000000091"
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO project_items (id, project_id, module_id, quantity, custom_dims, organization_id)
		VALUES ($1, $2, $3, 2, '{"widthMm": 600, "heightMm": 720, "depthMm": 560}', '`+rlsOrgA+`')`,
		lineID, fiSharedProject, fiModuleA); err != nil {
		t.Fatalf("seed quote line: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO project_item_choices (project_item_id, option_group_code, choice_entity_id, organization_id)
		VALUES ($1, 'BODY', '70000000-0000-0000-0000-000000000001', '`+rlsOrgA+`')`,
		lineID); err != nil {
		t.Fatalf("seed quote choices: %v", err)
	}

	var designRevID string
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		// 1. Create a design
		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Test Kitchen Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		// 2. Materialize quote line with 2 instances (FI-1, FI-2)
		matRes, err := fx.store.MaterializeQuoteLine(ctx, storage.MaterializeQuoteLineCommand{
			ProjectID:   fiSharedProject,
			QuoteLineID: lineID,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		if len(matRes.Instances) != 2 {
			t.Fatalf("expected 2 instances, got %d", len(matRes.Instances))
		}
		fi1 := matRes.Instances[0].FurnitureInstanceID
		fi2 := matRes.Instances[1].FurnitureInstanceID

		// 3. Update working copy and publish DesignRevision:
		// fi1 has identical dimensions and material
		// fi2 has modified width (from 600 to 650)
		_, err = fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID: fi1,
					Parameters:          map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					MaterialChoices:     map[string]string{"BODY": "70000000-0000-0000-0000-000000000001"},
				},
				{
					FurnitureInstanceID: fi2,
					Parameters:          map[string]any{"widthMm": 650.0, "heightMm": 720.0, "depthMm": 560.0}, // Modified width
					MaterialChoices:     map[string]string{"BODY": "70000000-0000-0000-0000-000000000001"},
				},
			},
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		designRevID = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup fixture: %v", err)
	}

	// 4. Run reconciliation
	var res *domain.ReconciliationResult
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		res, err = fx.store.ReconcileProject(ctx, fiSharedProject, fiSharedProject, designRevID)
		return err
	})
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	if res.Summary.Total != 2 {
		t.Errorf("expected total 2, got %d", res.Summary.Total)
	}
	if res.Summary.Synced != 1 {
		t.Errorf("expected synced 1, got %d", res.Summary.Synced)
	}
	if res.Summary.Modified != 1 {
		t.Errorf("expected modified 1, got %d", res.Summary.Modified)
	}
}

func TestReconciliation_NegativeProofE_SameLookingDifferentIdentity(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	ctx := context.Background()

	lineID := "60000000-0000-0000-0000-000000000092"
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO project_items (id, project_id, module_id, quantity, organization_id)
		VALUES ($1, $2, $3, 1, '`+rlsOrgA+`')`,
		lineID, fiSharedProject, fiModuleA); err != nil {
		t.Fatalf("seed quote line: %v", err)
	}

	var designRevID string
	var quotedFI string
	var modeledFI string

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Proof E Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		// Materialize quote line to get quotedFI
		matRes, err := fx.store.MaterializeQuoteLine(ctx, storage.MaterializeQuoteLineCommand{
			ProjectID:   fiSharedProject,
			QuoteLineID: lineID,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		quotedFI = matRes.Instances[0].FurnitureInstanceID

		// Create a separate furniture instance modeledFI in the same project
		fiRes, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginManual,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}
		modeledFI = fiRes.ID

		// Update working copy with modeledFI (same definition & dimensions as quotedFI) and publish
		_, err = fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID: modeledFI,
					Parameters:          map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
				},
			},
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		designRevID = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	// Reconcile
	var res *domain.ReconciliationResult
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		res, err = fx.store.ReconcileProject(ctx, fiSharedProject, fiSharedProject, designRevID)
		return err
	})
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	// Proof E verification: MUST NOT be synced!
	if res.Summary.Synced != 0 {
		t.Errorf("NEGATIVE PROOF E FAILED: items matched as synced despite different identities! Synced=%d", res.Summary.Synced)
	}
	if res.Summary.QuotedNotModeled != 1 {
		t.Errorf("expected 1 quoted_not_modeled, got %d", res.Summary.QuotedNotModeled)
	}
	if res.Summary.ModeledNotQuoted != 1 {
		t.Errorf("expected 1 modeled_not_quoted, got %d", res.Summary.ModeledNotQuoted)
	}

	foundQuoted := false
	foundModeled := false
	for _, item := range res.Items {
		if item.FurnitureInstanceID == quotedFI {
			foundQuoted = true
			if item.Status != domain.ReconciliationStatusQuotedNotModeled {
				t.Errorf("expected quotedFI %s to be quoted_not_modeled, got %s", quotedFI, item.Status)
			}
		}
		if item.FurnitureInstanceID == modeledFI {
			foundModeled = true
			if item.Status != domain.ReconciliationStatusModeledNotQuoted {
				t.Errorf("expected modeledFI %s to be modeled_not_quoted, got %s", modeledFI, item.Status)
			}
		}
	}
	if !foundQuoted {
		t.Errorf("quotedFI %s not found in items", quotedFI)
	}
	if !foundModeled {
		t.Errorf("modeledFI %s not found in items", modeledFI)
	}
}

func TestReconciliation_QuantityGreaterThanOne_PartialPlacement(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	ctx := context.Background()

	lineID := "60000000-0000-0000-0000-000000000093"
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO project_items (id, project_id, module_id, quantity, custom_dims, organization_id)
		VALUES ($1, $2, $3, 3, '{"widthMm": 600, "heightMm": 720, "depthMm": 560}', '`+rlsOrgA+`')`,
		lineID, fiSharedProject, fiModuleA); err != nil {
		t.Fatalf("seed quote line: %v", err)
	}

	var designRevID string
	var fi1, fi2, fi3 string

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Qty > 1 Partial Placement Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		// Materialize 3 units
		matRes, err := fx.store.MaterializeQuoteLine(ctx, storage.MaterializeQuoteLineCommand{
			ProjectID:   fiSharedProject,
			QuoteLineID: lineID,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		fi1 = matRes.Instances[0].FurnitureInstanceID
		fi2 = matRes.Instances[1].FurnitureInstanceID
		fi3 = matRes.Instances[2].FurnitureInstanceID

		// Only place fi1 and fi2 in the design (fi3 is left unplaced)
		_, err = fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID: fi1,
					Parameters:          map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
				},
				{
					FurnitureInstanceID: fi2,
					Parameters:          map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
				},
			},
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		designRevID = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	var res *domain.ReconciliationResult
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		res, err = fx.store.ReconcileProject(ctx, fiSharedProject, fiSharedProject, designRevID)
		return err
	})
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	if res.Summary.Total != 3 {
		t.Fatalf("expected total 3, got %d", res.Summary.Total)
	}
	if res.Summary.Synced != 2 {
		t.Errorf("expected synced 2, got %d", res.Summary.Synced)
	}
	if res.Summary.QuotedNotModeled != 1 {
		t.Errorf("expected quoted_not_modeled 1, got %d", res.Summary.QuotedNotModeled)
	}

	// Verify that the quoted_not_modeled item is specifically fi3
	foundFi3 := false
	for _, item := range res.Items {
		if item.FurnitureInstanceID == fi3 {
			foundFi3 = true
			if item.Status != domain.ReconciliationStatusQuotedNotModeled {
				t.Errorf("expected fi3 to have status quoted_not_modeled, got %s", item.Status)
			}
		}
	}
	if !foundFi3 {
		t.Errorf("fi3 not found in reconciliation items")
	}
}

func TestReconciliation_CrossProjectRejected(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	var designRevB string

	// Create design and revision on project fiProjectAOnly
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiProjectAOnly,
			Name:        "Project A Only Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		designRevB = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	// Attempt to reconcile fiSharedProject with design revision belonging to fiProjectAOnly
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ReconcileProject(ctx, fiSharedProject, fiSharedProject, designRevB)
		return err
	})

	if !errors.Is(err, domain.ErrCrossProjectReconciliation) {
		t.Fatalf("expected ErrCrossProjectReconciliation, got %v", err)
	}
}

func TestReconciliation_ImmutabilityNegativeProof(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	ctx := context.Background()

	lineID := "60000000-0000-0000-0000-000000000094"
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO project_items (id, project_id, module_id, quantity, organization_id)
		VALUES ($1, $2, $3, 1, '`+rlsOrgA+`')`,
		lineID, fiSharedProject, fiModuleA); err != nil {
		t.Fatalf("seed quote line: %v", err)
	}

	var designRevID string
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Immutability Test Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		matRes, err := fx.store.MaterializeQuoteLine(ctx, storage.MaterializeQuoteLineCommand{
			ProjectID:   fiSharedProject,
			QuoteLineID: lineID,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		_, err = fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID: matRes.Instances[0].FurnitureInstanceID,
					Parameters:          map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
				},
			},
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		designRevID = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	// Snapshot row counts before reconciliation
	countQuery := func() (int, int, int, int) {
		var qlCount, fiCount, drCount, driCount int
		if err := fx.admin.QueryRow(ctx, "SELECT count(*) FROM quote_line_furniture_instances").Scan(&qlCount); err != nil {
			t.Fatal(err)
		}
		if err := fx.admin.QueryRow(ctx, "SELECT count(*) FROM furniture_instances").Scan(&fiCount); err != nil {
			t.Fatal(err)
		}
		if err := fx.admin.QueryRow(ctx, "SELECT count(*) FROM design_revisions").Scan(&drCount); err != nil {
			t.Fatal(err)
		}
		if err := fx.admin.QueryRow(ctx, "SELECT count(*) FROM design_revision_items").Scan(&driCount); err != nil {
			t.Fatal(err)
		}
		return qlCount, fiCount, drCount, driCount
	}

	qlBefore, fiBefore, drBefore, driBefore := countQuery()

	// Execute reconciliation multiple times
	for i := 0; i < 3; i++ {
		err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
			_, err := fx.store.ReconcileProject(ctx, fiSharedProject, fiSharedProject, designRevID)
			return err
		})
		if err != nil {
			t.Fatalf("reconciliation run %d failed: %v", i, err)
		}
	}

	// Snapshot row counts after reconciliation
	qlAfter, fiAfter, drAfter, driAfter := countQuery()

	if qlBefore != qlAfter {
		t.Errorf("IMMUTABILITY VIOLATION: quote_line_furniture_instances count changed from %d to %d", qlBefore, qlAfter)
	}
	if fiBefore != fiAfter {
		t.Errorf("IMMUTABILITY VIOLATION: furniture_instances count changed from %d to %d", fiBefore, fiAfter)
	}
	if drBefore != drAfter {
		t.Errorf("IMMUTABILITY VIOLATION: design_revisions count changed from %d to %d", drBefore, drAfter)
	}
	if driBefore != driAfter {
		t.Errorf("IMMUTABILITY VIOLATION: design_revision_items count changed from %d to %d", driBefore, driAfter)
	}
}

func TestReconciliation_MultiOrgRLS(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	actorB := fiActorB()

	var designRevID string
	// Org A creates design and revision on fiProjectAOnly (private to Org A)
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiProjectAOnly,
			Name:        "Org A Private Kitchen",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		designRevID = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	// Org B attempts to reconcile Org A's private project -> must fail (not found under RLS)
	err = fiTx(t, fx.store, actorB, func(ctx context.Context) error {
		_, err := fx.store.ReconcileProject(ctx, fiProjectAOnly, fiProjectAOnly, designRevID)
		return err
	})

	if err == nil {
		t.Fatalf("RLS VIOLATION: Org B was able to access or reconcile Org A's private project!")
	}
}
