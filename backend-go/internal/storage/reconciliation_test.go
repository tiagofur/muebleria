package storage_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #393 / DT-9: QuoteRevision ↔ DesignRevision reconciliation by FurnitureInstance
// against real PostgreSQL under the app role.
//
// Key contracts verified:
// - Physical join key is strictly FurnitureInstance.id (never definition, dimensions, or similarity)
// - Historical commercial snapshot is immutable: old quote revisions stay old despite subsequent revisions or draft edits
// - Historical removal: later cancellation of a FurnitureInstance does not rewrite old revision reconciliation
// - Definition version differences are detected when authoritative
// - Fail-closed on corrupt revision snapshot JSON
// - Negative Proof E: same-looking items with different identities produce quoted_not_modeled and modeled_not_quoted, NOT synced
// - Quantity > 1 evaluates at unit-level
// - Cross-project reconciliation is rejected with domain.ErrCrossProjectReconciliation
// - Immutability: reconciliation is purely read-only and causes ZERO mutations to quotes or designs
// - Multi-org isolation: organizations cannot access or reconcile other organizations' projects

func quoteRevisionMigrationSQL(t *testing.T) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000115_quote_revisions.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func TestQuoteRevisions_MigrationFreshAndUpgrade(t *testing.T) {
	ctx := context.Background()

	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 115)
	assertQuoteRevisionsSchema(t, fresh)

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 114)
	if _, err := upgrade.Exec(ctx, quoteRevisionMigrationSQL(t)); err != nil {
		t.Fatalf("upgrade apply 00115: %v", err)
	}
	assertQuoteRevisionsSchema(t, upgrade)
}

func assertQuoteRevisionsSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	for _, table := range []string{"quote_revisions", "quote_revision_items"} {
		var exists bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name=$1)`, table,
		).Scan(&exists); err != nil || !exists {
			t.Fatalf("table %s exists=%v err=%v", table, exists, err)
		}

		var classification, readScope, writeScope string
		if err := pool.QueryRow(ctx,
			`SELECT classification, read_scope, write_scope FROM rls_policy_inventory WHERE table_name=$1`, table,
		).Scan(&classification, &readScope, &writeScope); err != nil {
			t.Fatalf("inventory row for %s: %v", table, err)
		}
		if classification != "explicitly-shared" || readScope != "project-organizations" {
			t.Fatalf("inventory for %s = (%q,%q,%q)", table, classification, readScope, writeScope)
		}

		var rls, forced bool
		if err := pool.QueryRow(ctx,
			`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname=$1`, table,
		).Scan(&rls, &forced); err != nil || !rls || !forced {
			t.Fatalf("RLS for %s enabled=%v forced=%v err=%v", table, rls, forced, err)
		}
	}

	// quote_revision_items grants: SELECT, INSERT only (immutable)
	privileges := map[string]bool{}
	rows, err := pool.Query(ctx, `
		SELECT privilege_type FROM information_schema.table_privileges
		WHERE table_name='quote_revision_items' AND grantee='granete_app'`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			t.Fatal(err)
		}
		privileges[p] = true
	}
	rows.Close()
	if !privileges["SELECT"] || !privileges["INSERT"] || privileges["UPDATE"] || privileges["DELETE"] {
		t.Fatalf("quote_revision_items grants must be SELECT,INSERT only: %v", privileges)
	}
}

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

	var designRevID, quoteRevID string
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

		// 3. Create immutable QuoteRevision Q1
		qRev, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Notes:     "Revision Q1",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID:   fi1,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					MaterialChoices:       map[string]string{"BODY": "70000000-0000-0000-0000-000000000001"},
					LifecycleStatus:       "active",
				},
				{
					FurnitureInstanceID:   fi2,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					MaterialChoices:       map[string]string{"BODY": "70000000-0000-0000-0000-000000000001"},
					LifecycleStatus:       "active",
				},
			},
		})
		if err != nil {
			return err
		}
		quoteRevID = qRev.ID

		// 4. Update working copy and publish DesignRevision R1:
		// fi1 has identical dimensions and material (synced)
		// fi2 has modified width (from 600 to 650) (modified)
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
					Parameters:          map[string]any{"widthMm": 650.0, "heightMm": 720.0, "depthMm": 560.0},
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

	// 5. Run reconciliation
	var res *domain.ReconciliationResult
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		res, err = fx.store.ReconcileProject(ctx, fiSharedProject, quoteRevID, designRevID)
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

	var designRevID, quoteRevID string
	var quotedFI, modeledFI string

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Proof E Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		// Create two distinct physical units with the same catalog module
		fiQ, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}
		quotedFI = fiQ.ID

		fiM, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginManual,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}
		modeledFI = fiM.ID

		// QuoteRevision contains quotedFI
		qRev, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID:   quotedFI,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					LifecycleStatus:       "active",
				},
			},
		})
		if err != nil {
			return err
		}
		quoteRevID = qRev.ID

		// DesignRevision contains modeledFI with the EXACT SAME dimensions and module
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
		res, err = fx.store.ReconcileProject(ctx, fiSharedProject, quoteRevID, designRevID)
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

	var designRevID, quoteRevID string
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

		// Create 3 instances
		i1, _ := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID: fiSharedProject, FurnitureDefinitionID: fiModuleA, Origin: domain.FurnitureInstanceOriginQuote, ActorUserID: rlsUserA,
		})
		i2, _ := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID: fiSharedProject, FurnitureDefinitionID: fiModuleA, Origin: domain.FurnitureInstanceOriginQuote, ActorUserID: rlsUserA,
		})
		i3, _ := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID: fiSharedProject, FurnitureDefinitionID: fiModuleA, Origin: domain.FurnitureInstanceOriginQuote, ActorUserID: rlsUserA,
		})
		fi1 = i1.ID
		fi2 = i2.ID
		fi3 = i3.ID

		// Quote contains all 3
		qRev, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: fi1, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, LifecycleStatus: "active"},
				{FurnitureInstanceID: fi2, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, LifecycleStatus: "active"},
				{FurnitureInstanceID: fi3, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, LifecycleStatus: "active"},
			},
		})
		if err != nil {
			return err
		}
		quoteRevID = qRev.ID

		// Design only places fi1 and fi2 (fi3 is unplaced)
		_, err = fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fi1, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}},
				{FurnitureInstanceID: fi2, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}},
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
		res, err = fx.store.ReconcileProject(ctx, fiSharedProject, quoteRevID, designRevID)
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

	var designRevB, quoteRevA string

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

		qRev, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
		})
		if err != nil {
			return err
		}
		quoteRevA = qRev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	// Attempt to reconcile fiSharedProject with design revision belonging to fiProjectAOnly
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ReconcileProject(ctx, fiSharedProject, quoteRevA, designRevB)
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

	var designRevID, quoteRevID string
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Immutability Test Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		fi, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}

		qRev, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID:   fi.ID,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					LifecycleStatus:       "active",
				},
			},
		})
		if err != nil {
			return err
		}
		quoteRevID = qRev.ID

		_, err = fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID: fi.ID,
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
	countQuery := func() (int, int, int, int, int) {
		var qrCount, qriCount, fiCount, drCount, driCount int
		if err := fx.admin.QueryRow(ctx, "SELECT count(*) FROM quote_revisions").Scan(&qrCount); err != nil {
			t.Fatal(err)
		}
		if err := fx.admin.QueryRow(ctx, "SELECT count(*) FROM quote_revision_items").Scan(&qriCount); err != nil {
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
		return qrCount, qriCount, fiCount, drCount, driCount
	}

	qrBefore, qriBefore, fiBefore, drBefore, driBefore := countQuery()

	// Execute reconciliation multiple times
	for i := 0; i < 3; i++ {
		err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
			_, err := fx.store.ReconcileProject(ctx, fiSharedProject, quoteRevID, designRevID)
			return err
		})
		if err != nil {
			t.Fatalf("reconciliation run %d failed: %v", i, err)
		}
	}

	// Snapshot row counts after reconciliation: must remain exactly unchanged!
	qrAfter, qriAfter, fiAfter, drAfter, driAfter := countQuery()

	if qrBefore != qrAfter {
		t.Errorf("IMMUTABILITY VIOLATION: quote_revisions count changed from %d to %d", qrBefore, qrAfter)
	}
	if qriBefore != qriAfter {
		t.Errorf("IMMUTABILITY VIOLATION: quote_revision_items count changed from %d to %d", qriBefore, qriAfter)
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

	var designRevID, quoteRevID string
	// Org A creates design, revision, and quote revision on fiProjectAOnly (private to Org A)
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

		qRev, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiProjectAOnly,
		})
		if err != nil {
			return err
		}
		quoteRevID = qRev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	// Org B attempts to reconcile Org A's private project -> must fail (not found under RLS)
	err = fiTx(t, fx.store, actorB, func(ctx context.Context) error {
		_, err := fx.store.ReconcileProject(ctx, fiProjectAOnly, quoteRevID, designRevID)
		return err
	})

	if err == nil {
		t.Fatalf("RLS VIOLATION: Org B was able to access or reconcile Org A's private project!")
	}
}

// Requirement 4: Negative proof mandatory — old quote revision stays old
func TestReconciliation_HistoricalQuote_OldQuoteRevisionStaysOld(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	var fiID string
	var q1ID, q2ID, r1ID string

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		// 1. Create a physical instance FI-001
		fi, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}
		fiID = fi.ID

		// 2. Q1: FI-001 width = 600
		q1, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Notes:     "Quote Q1 - width 600",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID:   fiID,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					LifecycleStatus:       "active",
				},
			},
		})
		if err != nil {
			return err
		}
		q1ID = q1.ID

		// 3. Q2: FI-001 width = 800
		q2, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Notes:     "Quote Q2 - width 800",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID:   fiID,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 800.0, "heightMm": 720.0, "depthMm": 560.0},
					LifecycleStatus:       "active",
				},
			},
		})
		if err != nil {
			return err
		}
		q2ID = q2.ID

		// 4. Design R1: FI-001 width = 600
		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Design for Historical Quote Test",
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
					FurnitureInstanceID: fiID,
					Parameters:          map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
				},
			},
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		r1, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		r1ID = r1.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	// 5. Reconcile(Q1, R1) MUST remain synced
	var resQ1R1 *domain.ReconciliationResult
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		resQ1R1, err = fx.store.ReconcileProject(ctx, fiSharedProject, q1ID, r1ID)
		return err
	})
	if err != nil {
		t.Fatalf("reconcile Q1 ↔ R1: %v", err)
	}
	if resQ1R1.Summary.Synced != 1 || resQ1R1.Summary.Modified != 0 {
		t.Fatalf("expected Q1 ↔ R1 to be synced, got %+v", resQ1R1.Summary)
	}

	// 6. Reconcile(Q2, R1) MUST be modified
	var resQ2R1 *domain.ReconciliationResult
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		resQ2R1, err = fx.store.ReconcileProject(ctx, fiSharedProject, q2ID, r1ID)
		return err
	})
	if err != nil {
		t.Fatalf("reconcile Q2 ↔ R1: %v", err)
	}
	if resQ2R1.Summary.Modified != 1 || resQ2R1.Summary.Synced != 0 {
		t.Fatalf("expected Q2 ↔ R1 to be modified, got %+v", resQ2R1.Summary)
	}
	if len(resQ2R1.Items[0].Differences) != 1 || resQ2R1.Items[0].Differences[0].Path != "parameters.widthMm" {
		t.Fatalf("expected difference on parameters.widthMm, got %+v", resQ2R1.Items[0].Differences)
	}

	// 7. Mutate current draft / create Q3 with width = 999
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Notes:     "Quote Q3 - current edits",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID:   fiID,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 999.0, "heightMm": 720.0, "depthMm": 560.0},
					LifecycleStatus:       "active",
				},
			},
		})
		return err
	})
	if err != nil {
		t.Fatalf("create Q3 edits: %v", err)
	}

	// 8. Re-run Reconcile(Q1, R1): Result MUST BE IDENTICAL to step 5!
	var resQ1R1After *domain.ReconciliationResult
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		resQ1R1After, err = fx.store.ReconcileProject(ctx, fiSharedProject, q1ID, r1ID)
		return err
	})
	if err != nil {
		t.Fatalf("re-run reconcile Q1 ↔ R1: %v", err)
	}

	if resQ1R1After.Summary.Synced != 1 || resQ1R1After.Summary.Modified != 0 {
		t.Fatalf("HISTORICAL ISOLATION VIOLATION: Q1 ↔ R1 changed after Q3 edits! Summary: %+v", resQ1R1After.Summary)
	}
	if resQ1R1After.Items[0].Status != domain.ReconciliationStatusSynced {
		t.Fatalf("expected status synced, got %s", resQ1R1After.Items[0].Status)
	}
}

// Requirement 5: `removed` semantics must also be historical
func TestReconciliation_HistoricalRemoval_LaterCancellationDoesNotRewriteOld(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	ctx := context.Background()

	var fiID string
	var q1ID, qRemovedID, r1ID string

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		fi, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}
		fiID = fi.ID

		// Q1 contains active FI-001
		q1, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID:   fiID,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					LifecycleStatus:       "active",
				},
			},
		})
		if err != nil {
			return err
		}
		q1ID = q1.ID

		// Q_removed explicitly records FI-001 as cancelled
		qRem, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID:   fiID,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					LifecycleStatus:       "cancelled",
				},
			},
		})
		if err != nil {
			return err
		}
		qRemovedID = qRem.ID

		// Design R1 contains FI-001
		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Design for Historical Removal Test",
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
					FurnitureInstanceID: fiID,
					Parameters:          map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
				},
			},
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		r1, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		r1ID = r1.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	// Now cancel FI-001 in current furniture_instances table
	if _, err := fx.admin.Exec(ctx, `
		UPDATE furniture_instances SET lifecycle_status = 'cancelled' WHERE id = $1
	`, fiID); err != nil {
		t.Fatalf("cancel current FI: %v", err)
	}

	// Reconcile Q1 ↔ R1: FI was active in Q1, so reconciliation MUST NOT be rewritten to removed!
	var resQ1 *domain.ReconciliationResult
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		resQ1, err = fx.store.ReconcileProject(ctx, fiSharedProject, q1ID, r1ID)
		return err
	})
	if err != nil {
		t.Fatalf("reconcile Q1 ↔ R1: %v", err)
	}

	if resQ1.Summary.Removed != 0 || resQ1.Summary.Synced != 1 {
		t.Fatalf("HISTORICAL REMOVAL VIOLATION: current table cancellation retrospectively rewritten Q1! Summary: %+v", resQ1.Summary)
	}

	// Reconcile Q_removed ↔ R1: FI was cancelled in Q_removed, so it MUST be removed!
	var resQRem *domain.ReconciliationResult
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		resQRem, err = fx.store.ReconcileProject(ctx, fiSharedProject, qRemovedID, r1ID)
		return err
	})
	if err != nil {
		t.Fatalf("reconcile Q_removed ↔ R1: %v", err)
	}

	if resQRem.Summary.Removed != 1 || resQRem.Items[0].Status != domain.ReconciliationStatusRemoved {
		t.Fatalf("expected Q_removed to produce removed status, got %+v", resQRem.Items[0])
	}
}

// Requirement 6: Definition version comparison
func TestReconciliation_DefinitionVersion(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	var fiID string
	var qID, rID string
	qVersion := 4
	dVersion := 5

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		fi, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}
		fiID = fi.ID

		// Quote with definition version 4
		q, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID:   fiID,
					FurnitureDefinitionID: fiModuleA,
					DefinitionVersion:     &qVersion,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					LifecycleStatus:       "active",
				},
			},
		})
		if err != nil {
			return err
		}
		qID = q.ID

		// Design with definition version 5
		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Design for Definition Version Test",
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
					FurnitureInstanceID: fiID,
					DefinitionVersion:   &dVersion,
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
		rID = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	var res *domain.ReconciliationResult
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		res, err = fx.store.ReconcileProject(ctx, fiSharedProject, qID, rID)
		return err
	})
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	if res.Summary.Modified != 1 {
		t.Fatalf("expected 1 modified item for definition version difference, got %+v", res.Summary)
	}
	if len(res.Items[0].Differences) != 1 {
		t.Fatalf("expected 1 difference, got %+v", res.Items[0].Differences)
	}
	diff := res.Items[0].Differences[0]
	if diff.Path != "definitionVersion" || diff.QuoteValue != 4 || diff.DesignValue != 5 {
		t.Fatalf("expected definitionVersion 4 -> 5, got %+v", diff)
	}
}

// Requirement 7: Snapshot parsing must FAIL CLOSED on corrupt JSON
func TestReconciliation_CorruptSnapshot_FailsClosed(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	ctx := context.Background()

	var qID, rID string
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		fi, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}

		q, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID:   fi.ID,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0},
					LifecycleStatus:       "active",
				},
			},
		})
		if err != nil {
			return err
		}
		qID = q.ID

		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Corrupt Snapshot Test",
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
					FurnitureInstanceID: fi.ID,
					Parameters:          map[string]any{"widthMm": 600.0},
				},
			},
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		r, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		rID = r.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	// 1. Corrupt quote_revision_items.parameters with a non-object JSON structure (valid in jsonb, invalid for parameters map)
	if _, err := fx.admin.Exec(ctx, `
		UPDATE quote_revision_items SET parameters = '[1, 2, 3]'::jsonb
		WHERE quote_revision_id = $1
	`, qID); err != nil {
		t.Fatalf("corrupt parameters: %v", err)
	}

	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ReconcileProject(ctx, fiSharedProject, qID, rID)
		return err
	})
	if !errors.Is(err, domain.ErrInvalidRevisionSnapshot) {
		t.Fatalf("expected ErrInvalidRevisionSnapshot for corrupt parameters, got %v", err)
	}

	// 2. Corrupt design_revision_items.material_choices with non-string-map JSON
	if _, err := fx.admin.Exec(ctx, `UPDATE quote_revision_items SET parameters = '{}'::jsonb WHERE quote_revision_id = $1`, qID); err != nil {
		t.Fatalf("restore quote parameters: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `ALTER TABLE design_revision_items DISABLE TRIGGER ALL`); err != nil {
		t.Fatalf("disable triggers: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `UPDATE design_revision_items SET material_choices = '[true, false]'::jsonb WHERE design_revision_id = $1`, rID); err != nil {
		t.Fatalf("corrupt design materials: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `ALTER TABLE design_revision_items ENABLE TRIGGER ALL`); err != nil {
		t.Fatalf("enable triggers: %v", err)
	}

	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ReconcileProject(ctx, fiSharedProject, qID, rID)
		return err
	})
	if !errors.Is(err, domain.ErrInvalidRevisionSnapshot) {
		t.Fatalf("expected ErrInvalidRevisionSnapshot for corrupt design materials, got %v", err)
	}

	// 3. Verify that if quote_revisions does not exist, it returns ErrQuoteRevisionNotFound
	errNotFound := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ReconcileProject(ctx, fiSharedProject, "99999999-0000-0000-0000-000000000099", rID)
		return err
	})
	if !errors.Is(errNotFound, domain.ErrQuoteRevisionNotFound) {
		t.Fatalf("expected ErrQuoteRevisionNotFound, got %v", errNotFound)
	}
}
