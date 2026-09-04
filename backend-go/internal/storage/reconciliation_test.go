package storage_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
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

	// Verify triggers are present
	var qrTrigExists, qriTrigExists bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='protect_quote_revisions_immutable')
	`).Scan(&qrTrigExists); err != nil || !qrTrigExists {
		t.Fatalf("protect_quote_revisions_immutable trigger exists=%v err=%v", qrTrigExists, err)
	}
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='protect_quote_revision_items_immutable')
	`).Scan(&qriTrigExists); err != nil || !qriTrigExists {
		t.Fatalf("protect_quote_revision_items_immutable trigger exists=%v err=%v", qriTrigExists, err)
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

		// 3. Q2: FI-001 width = 800 (based on the exact current latest Q1)
		q2, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID:      fiSharedProject,
			BaseRevisionID: q1ID,
			Notes:          "Quote Q2 - width 800",
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

	// 7. Mutate current draft / create Q3 with width = 999 (based on the exact current latest Q2)
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID:      fiSharedProject,
			BaseRevisionID: q2ID,
			Notes:          "Quote Q3 - current edits",
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

		// Q_removed explicitly records FI-001 as cancelled (based on the exact current latest Q1)
		qRem, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID:      fiSharedProject,
			BaseRevisionID: q1ID,
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
	if _, err := fx.admin.Exec(ctx, `ALTER TABLE quote_revision_items DISABLE TRIGGER ALL`); err != nil {
		t.Fatalf("disable triggers: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `
		UPDATE quote_revision_items SET parameters = '[1, 2, 3]'::jsonb
		WHERE quote_revision_id = $1
	`, qID); err != nil {
		t.Fatalf("corrupt parameters: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `ALTER TABLE quote_revision_items ENABLE TRIGGER ALL`); err != nil {
		t.Fatalf("enable triggers: %v", err)
	}

	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ReconcileProject(ctx, fiSharedProject, qID, rID)
		return err
	})
	if !errors.Is(err, domain.ErrInvalidRevisionSnapshot) {
		t.Fatalf("expected ErrInvalidRevisionSnapshot for corrupt parameters, got %v", err)
	}

	// 2. Corrupt design_revision_items.material_choices with non-string-map JSON
	if _, err := fx.admin.Exec(ctx, `ALTER TABLE quote_revision_items DISABLE TRIGGER ALL`); err != nil {
		t.Fatalf("disable triggers: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `UPDATE quote_revision_items SET parameters = '{}'::jsonb WHERE quote_revision_id = $1`, qID); err != nil {
		t.Fatalf("restore quote parameters: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `ALTER TABLE quote_revision_items ENABLE TRIGGER ALL`); err != nil {
		t.Fatalf("enable triggers: %v", err)
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

// Hardening Gap 1: CreateQuoteRevision must be atomic.
// Negative proof: 5 items, item 3 fails -> zero QuoteRevision, zero QuoteRevisionItems.
func TestQuoteRevision_Atomicity_RollbackOnFailedItem(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	ctx := context.Background()

	// Seed 5 physical furniture instances
	instances := make([]string, 5)
	for i := 0; i < 5; i++ {
		fiID := fmt.Sprintf("50000000-0000-0000-0000-0000000000a%d", i+1)
		instances[i] = fiID
		if _, err := fx.admin.Exec(ctx, `
			INSERT INTO furniture_instances (id, organization_id, project_id, origin, lifecycle_status)
			VALUES ($1, $2, $3, 'manual', 'active')
		`, fiID, rlsOrgA, fiSharedProject); err != nil {
			t.Fatalf("seed FI %d: %v", i+1, err)
		}
	}

	// Prepare 5 items where item 3 has an invalid/non-existent furniture_instance_id that triggers a DB foreign key failure
	items := make([]storage.CreateQuoteRevisionItemCommand, 5)
	for i := 0; i < 5; i++ {
		items[i] = storage.CreateQuoteRevisionItemCommand{
			FurnitureInstanceID: instances[i],
			LifecycleStatus:     "active",
		}
	}
	// Sabotage item 3 with a non-existent UUID
	items[2].FurnitureInstanceID = "99999999-0000-0000-0000-000000000099"

	quoteRevID := "70000000-0000-0000-0000-000000000077"
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ID:        quoteRevID,
			ProjectID: fiSharedProject,
			Notes:     "Atomic rollback test",
			CreatedBy: rlsUserA,
			Items:     items,
		})
		return err
	})
	if err == nil {
		t.Fatal("expected CreateQuoteRevision to fail on invalid item 3, got nil")
	}

	// Negative proof verification: NO quote_revisions header must exist
	var revCount int
	if err := fx.admin.QueryRow(ctx, `
		SELECT count(*) FROM quote_revisions WHERE id = $1
	`, quoteRevID).Scan(&revCount); err != nil {
		t.Fatalf("query quote_revisions count: %v", err)
	}
	if revCount != 0 {
		t.Fatalf("atomicity violation: found %d quote_revisions after failed item, want 0", revCount)
	}

	// Negative proof verification: NO quote_revision_items must exist
	var itemCount int
	if err := fx.admin.QueryRow(ctx, `
		SELECT count(*) FROM quote_revision_items WHERE quote_revision_id = $1
	`, quoteRevID).Scan(&itemCount); err != nil {
		t.Fatalf("query quote_revision_items count: %v", err)
	}
	if itemCount != 0 {
		t.Fatalf("atomicity violation: found %d quote_revision_items after failed item, want 0", itemCount)
	}
}

// Hardening Gap 2: Revision numbering must be concurrency-safe.
// Two concurrent creates on latest Q7 must never result in an accidental race or unique constraint violation.
func TestQuoteRevision_Concurrency_SafeRevisionNumbering(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	ctx := context.Background()

	// Seed one physical instance
	fiID := "50000000-0000-0000-0000-0000000000b1"
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO furniture_instances (id, organization_id, project_id, origin, lifecycle_status)
		VALUES ($1, $2, $3, 'manual', 'active')
	`, fiID, rlsOrgA, fiSharedProject); err != nil {
		t.Fatalf("seed FI: %v", err)
	}

	// Create Q1 first as baseline
	var q1 *domain.QuoteRevision
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		q1, err = fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Notes:     "Base Q1",
			CreatedBy: rlsUserA,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: fiID, LifecycleStatus: "active"},
			},
		})
		return err
	})
	if err != nil {
		t.Fatalf("create Q1: %v", err)
	}
	if q1.RevisionNumber != 1 {
		t.Fatalf("q1 revision number = %d, want 1", q1.RevisionNumber)
	}

	// 1. Concurrent creates based on the SAME latest revision (Q1): the project row
	// lock serializes revision numbering and the mandatory BaseRevisionID check makes
	// optimistic concurrency fail-closed — exactly ONE worker wins (Q2) while the
	// other receives a typed ErrQuoteRevisionConflict. No skipped numbers, no Q3.
	type result struct {
		rev *domain.QuoteRevision
		err error
	}
	ch := make(chan result, 2)
	start := make(chan struct{})

	for i := 0; i < 2; i++ {
		workerID := i
		go func() {
			<-start
			var r *domain.QuoteRevision
			err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
				var err error
				r, err = fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
					ProjectID:      fiSharedProject,
					BaseRevisionID: q1.ID, // Both workers author from the same Q1.
					Notes:          fmt.Sprintf("Concurrent worker %d", workerID),
					CreatedBy:      rlsUserA,
					Items: []storage.CreateQuoteRevisionItemCommand{
						{FurnitureInstanceID: fiID, LifecycleStatus: "active"},
					},
				})
				return err
			})
			ch <- result{rev: r, err: err}
		}()
	}

	close(start)

	res1 := <-ch
	res2 := <-ch

	var winner *domain.QuoteRevision
	var loserErr error
	switch {
	case res1.err == nil && res2.err == nil:
		t.Fatal("both concurrent same-base creates succeeded; expected exactly one conflict")
	case res1.err == nil:
		winner, loserErr = res1.rev, res2.err
	case res2.err == nil:
		winner, loserErr = res2.rev, res1.err
	default:
		t.Fatalf("both concurrent same-base creates failed: %v / %v", res1.err, res2.err)
	}
	if winner.RevisionNumber != 2 {
		t.Fatalf("winner revision number = %d, want 2", winner.RevisionNumber)
	}
	if !errors.Is(loserErr, domain.ErrQuoteRevisionConflict) {
		t.Fatalf("expected loser to receive ErrQuoteRevisionConflict, got %v", loserErr)
	}
	if count, latest := quoteRevisionState(t, fx.admin, fiSharedProject); count != 2 || latest != 2 {
		t.Fatalf("after concurrent same-base race: count=%d latest=Q%d, want count=2 latest=Q2", count, latest)
	}

	// 2. Concurrent creates with Stale BaseRevisionID: must return clean typed domain.ErrQuoteRevisionConflict.
	chConflict := make(chan result, 2)
	startConflict := make(chan struct{})
	for i := 0; i < 2; i++ {
		workerID := i
		go func() {
			<-startConflict
			var r *domain.QuoteRevision
			err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
				var err error
				r, err = fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
					ProjectID:      fiSharedProject,
					BaseRevisionID: q1.ID, // Stale! Latest is already Q2.
					Notes:          fmt.Sprintf("Conflict worker %d", workerID),
					CreatedBy:      rlsUserA,
					Items: []storage.CreateQuoteRevisionItemCommand{
						{FurnitureInstanceID: fiID, LifecycleStatus: "active"},
					},
				})
				return err
			})
			chConflict <- result{rev: r, err: err}
		}()
	}
	close(startConflict)

	cRes1 := <-chConflict
	cRes2 := <-chConflict
	if !errors.Is(cRes1.err, domain.ErrQuoteRevisionConflict) {
		t.Fatalf("expected ErrQuoteRevisionConflict on stale base revision, got %v", cRes1.err)
	}
	if !errors.Is(cRes2.err, domain.ErrQuoteRevisionConflict) {
		t.Fatalf("expected ErrQuoteRevisionConflict on stale base revision, got %v", cRes2.err)
	}
	if count, latest := quoteRevisionState(t, fx.admin, fiSharedProject); count != 2 || latest != 2 {
		t.Fatalf("after stale-base attempts: count=%d latest=Q%d, want count=2 latest=Q2", count, latest)
	}

	// 3. The losing client reloads and bases the new revision on the exact current
	// latest (Q2): the retry succeeds and allocates Q3.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		q3, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID:      fiSharedProject,
			BaseRevisionID: winner.ID,
			Notes:          "Reloaded retry after conflict",
			CreatedBy:      rlsUserA,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: fiID, LifecycleStatus: "active"},
			},
		})
		if err != nil {
			return err
		}
		if q3.RevisionNumber != 3 {
			t.Fatalf("retry revision number = %d, want 3", q3.RevisionNumber)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("reload-and-retry create failed: %v", err)
	}
	if count, latest := quoteRevisionState(t, fx.admin, fiSharedProject); count != 3 || latest != 3 {
		t.Fatalf("after retry: count=%d latest=Q%d, want count=3 latest=Q3", count, latest)
	}
}

// Hardening Gap 3: Make QuoteRevision immutability semantics explicit and enforced.
// QuoteRevisionItems are immutable once created.
// QuoteRevision mutations are restricted strictly to allowed status transitions.
func TestQuoteRevision_Immutability_EnforcedAtDatabaseAndServer(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	ctx := context.Background()

	fiID := "50000000-0000-0000-0000-0000000000c1"
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO furniture_instances (id, organization_id, project_id, origin, lifecycle_status)
		VALUES ($1, $2, $3, 'manual', 'active')
	`, fiID, rlsOrgA, fiSharedProject); err != nil {
		t.Fatalf("seed FI: %v", err)
	}

	var rev *domain.QuoteRevision
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		rev, err = fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Status:    "published",
			Notes:     "Historical published snapshot",
			CreatedBy: rlsUserA,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID: fiID,
					LifecycleStatus:     "active",
					Parameters:          map[string]any{"widthMm": 600.0},
				},
			},
		})
		return err
	})
	if err != nil {
		t.Fatalf("create published quote revision: %v", err)
	}

	// 1. Negative Proof: Direct SQL UPDATE on quote_revision_items must be REJECTED by trigger
	_, err = fx.admin.Exec(ctx, `
		UPDATE quote_revision_items
		SET parameters = '{"widthMm": 999}'::jsonb
		WHERE quote_revision_id = $1
	`, rev.ID)
	if err == nil {
		t.Fatal("direct SQL UPDATE on quote_revision_items succeeded, want error from immutability trigger")
	}

	// 2. Negative Proof: Direct SQL DELETE on quote_revision_items must be REJECTED by trigger
	_, err = fx.admin.Exec(ctx, `
		DELETE FROM quote_revision_items
		WHERE quote_revision_id = $1
	`, rev.ID)
	if err == nil {
		t.Fatal("direct SQL DELETE on quote_revision_items succeeded, want error from immutability trigger")
	}

	// 3. Negative Proof: Direct SQL DELETE on quote_revisions must be REJECTED by trigger
	_, err = fx.admin.Exec(ctx, `
		DELETE FROM quote_revisions
		WHERE id = $1
	`, rev.ID)
	if err == nil {
		t.Fatal("direct SQL DELETE on quote_revisions succeeded, want error from immutability trigger")
	}

	// 4. Negative Proof: Attempt to mutate revision_number on quote_revisions must be REJECTED by trigger
	_, err = fx.admin.Exec(ctx, `
		UPDATE quote_revisions
		SET revision_number = 99
		WHERE id = $1
	`, rev.ID)
	if err == nil {
		t.Fatal("direct SQL UPDATE of revision_number on quote_revisions succeeded, want error from trigger")
	}

	// 5. Negative Proof: Attempt to mutate content/notes of published quote_revisions must be REJECTED by trigger
	_, err = fx.admin.Exec(ctx, `
		UPDATE quote_revisions
		SET notes = 'Tampered notes'
		WHERE id = $1
	`, rev.ID)
	if err == nil {
		t.Fatal("direct SQL UPDATE of notes on published quote_revisions succeeded, want error from trigger")
	}

	// 6. Legitimate status transition: published -> accepted via storage method
	var acceptedRev *domain.QuoteRevision
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		acceptedRev, err = fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: rev.ID,
			Status:          "accepted",
		})
		return err
	})
	if err != nil {
		t.Fatalf("legitimate transition published -> accepted failed: %v", err)
	}
	if acceptedRev.Status != "accepted" {
		t.Fatalf("status = %s, want accepted", acceptedRev.Status)
	}

	// 7. Negative Proof: Attempt to transition accepted -> draft or published must be REJECTED
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: rev.ID,
			Status:          "published",
		})
		return err
	})
	if err == nil {
		t.Fatal("invalid transition accepted -> published succeeded, want error")
	}

	// 8. Legitimate status transition: accepted -> superseded
	var supersededRev *domain.QuoteRevision
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		supersededRev, err = fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: rev.ID,
			Status:          "superseded",
		})
		return err
	})
	if err != nil {
		t.Fatalf("legitimate transition accepted -> superseded failed: %v", err)
	}
	if supersededRev.Status != "superseded" {
		t.Fatalf("status = %s, want superseded", supersededRev.Status)
	}

	// 9. Negative Proof: Attempt to transition superseded -> anything must be REJECTED
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: rev.ID,
			Status:          "accepted",
		})
		return err
	})
	if err == nil {
		t.Fatal("invalid transition superseded -> accepted succeeded, want error")
	}
}

// quoteRevisionState returns (count, latestRevisionNumber) for a project via the
// admin pool, so tests can prove that rejected creates left no rows behind.
func quoteRevisionState(t *testing.T, pool *pgxpool.Pool, projectID string) (int, int) {
	t.Helper()
	var count, latest int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*), COALESCE(MAX(revision_number), 0)
		FROM quote_revisions
		WHERE project_id = $1
	`, projectID).Scan(&count, &latest); err != nil {
		t.Fatalf("read quote revision state: %v", err)
	}
	return count, latest
}

// Final optimistic-concurrency hardening: BaseRevisionID is MANDATORY once any
// revision exists (fail-closed, digital-thread §18). Required negative proof:
//
//	Client A reads Q7 → Client B creates Q8 from Q7 →
//	Client A attempts create without base or with Q7 →
//	conflict and NO Q9 — unless Client A explicitly reloads and
//	bases the new revision on Q8.
func TestQuoteRevision_BaseRevision_FailClosed(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	fiID := "50000000-0000-0000-0000-0000000000c2"
	if _, err := fx.admin.Exec(context.Background(), `
		INSERT INTO furniture_instances (id, organization_id, project_id, origin, lifecycle_status)
		VALUES ($1, $2, $3, 'manual', 'active')
	`, fiID, rlsOrgA, fiSharedProject); err != nil {
		t.Fatalf("seed FI: %v", err)
	}

	items := func() []storage.CreateQuoteRevisionItemCommand {
		return []storage.CreateQuoteRevisionItemCommand{
			{FurnitureInstanceID: fiID, LifecycleStatus: "active"},
		}
	}

	// 0. No previous revision + base specified → conflict: the FIRST revision must be baseless.
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID:      fiSharedProject,
			BaseRevisionID: "51000000-0000-0000-0000-0000000000e1",
			Items:          items(),
		})
		return err
	})
	if !errors.Is(err, domain.ErrQuoteRevisionConflict) {
		t.Fatalf("expected ErrQuoteRevisionConflict when base is specified but no previous revision exists, got %v", err)
	}
	if count, latest := quoteRevisionState(t, fx.admin, fiSharedProject); count != 0 || latest != 0 {
		t.Fatalf("after rejected first create: count=%d latest=Q%d, want 0/0", count, latest)
	}

	// 1. First revision with empty base → Q1 allowed.
	var q1 *domain.QuoteRevision
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		q1, err = fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Notes:     "Q1",
			Items:     items(),
		})
		return err
	})
	if err != nil {
		t.Fatalf("create Q1 without base: %v", err)
	}
	if q1.RevisionNumber != 1 {
		t.Fatalf("Q1 revision number = %d, want 1", q1.RevisionNumber)
	}

	// 2. Client B authors from the current latest Q1 → Q2 allowed.
	var q2 *domain.QuoteRevision
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		q2, err = fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID:      fiSharedProject,
			BaseRevisionID: q1.ID,
			Notes:          "Q2 by client B",
			Items:          items(),
		})
		return err
	})
	if err != nil {
		t.Fatalf("create Q2 from Q1: %v", err)
	}
	if q2.RevisionNumber != 2 {
		t.Fatalf("Q2 revision number = %d, want 2", q2.RevisionNumber)
	}

	// 3. Client A still holds Q1 (stale): create WITHOUT base → conflict, no Q3.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Notes:     "Q3 attempted without base",
			Items:     items(),
		})
		return err
	})
	if !errors.Is(err, domain.ErrQuoteRevisionConflict) {
		t.Fatalf("expected ErrQuoteRevisionConflict when base omitted with existing revisions, got %v", err)
	}
	if count, latest := quoteRevisionState(t, fx.admin, fiSharedProject); count != 2 || latest != 2 {
		t.Fatalf("after base-omitted attempt: count=%d latest=Q%d, want 2/Q2 (no Q3)", count, latest)
	}

	// 4. Client A creates WITH stale base Q1 → conflict, still no Q3.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID:      fiSharedProject,
			BaseRevisionID: q1.ID,
			Notes:          "Q3 attempted from stale Q1",
			Items:          items(),
		})
		return err
	})
	if !errors.Is(err, domain.ErrQuoteRevisionConflict) {
		t.Fatalf("expected ErrQuoteRevisionConflict on stale base, got %v", err)
	}
	if count, latest := quoteRevisionState(t, fx.admin, fiSharedProject); count != 2 || latest != 2 {
		t.Fatalf("after stale-base attempt: count=%d latest=Q%d, want 2/Q2 (no Q3)", count, latest)
	}

	// 5. Client A explicitly reloads and bases the new revision on Q2 → Q3 allowed.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		q3, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID:      fiSharedProject,
			BaseRevisionID: q2.ID,
			Notes:          "Q3 after explicit reload",
			Items:          items(),
		})
		if err != nil {
			return err
		}
		if q3.RevisionNumber != 3 {
			t.Fatalf("Q3 revision number = %d, want 3", q3.RevisionNumber)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("create Q3 from reloaded Q2: %v", err)
	}
	if count, latest := quoteRevisionState(t, fx.admin, fiSharedProject); count != 3 || latest != 3 {
		t.Fatalf("after reload-based create: count=%d latest=Q%d, want 3/Q3", count, latest)
	}
}

// Exact canonical commercial lifecycle enforcement (server + DB backstop):
//
//	draft → published
//	published → accepted | superseded
//	accepted → superseded
//	superseded → terminal
//
// draft previously had no explicit guard and could transition arbitrarily.
func TestQuoteRevision_StatusTransitions_ExactLifecycle(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	ctx := context.Background()

	fiID := "50000000-0000-0000-0000-0000000000c3"
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO furniture_instances (id, organization_id, project_id, origin, lifecycle_status)
		VALUES ($1, $2, $3, 'manual', 'active')
	`, fiID, rlsOrgA, fiSharedProject); err != nil {
		t.Fatalf("seed FI: %v", err)
	}

	// Q1 born as draft.
	var draftRev *domain.QuoteRevision
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		draftRev, err = fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Status:    "draft",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: fiID, LifecycleStatus: "active"},
			},
		})
		return err
	})
	if err != nil {
		t.Fatalf("create draft quote revision: %v", err)
	}
	if draftRev.Status != "draft" {
		t.Fatalf("status = %s, want draft", draftRev.Status)
	}

	updateStatus := func(status string) error {
		return fiTx(t, fx.store, actorA, func(ctx context.Context) error {
			_, err := fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
				QuoteRevisionID: draftRev.ID,
				Status:          status,
			})
			return err
		})
	}

	// 1. Negative Proof: invalid target status strings are rejected before any transition.
	if err := updateStatus("bogus"); !errors.Is(err, domain.ErrInvalidRevisionSnapshot) {
		t.Fatalf("expected ErrInvalidRevisionSnapshot for bogus target status, got %v", err)
	}

	// 2. Negative Proof: draft cannot transition arbitrarily. Same-status no-op,
	// draft → accepted and draft → superseded are NOT canonical.
	for _, target := range []string{"draft", "accepted", "superseded"} {
		if err := updateStatus(target); !errors.Is(err, domain.ErrQuoteRevisionConflict) {
			t.Fatalf("expected ErrQuoteRevisionConflict for draft -> %s, got %v", target, err)
		}
	}
	var statusAfter string
	if err := fx.admin.QueryRow(ctx, `SELECT status FROM quote_revisions WHERE id = $1`, draftRev.ID).Scan(&statusAfter); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if statusAfter != "draft" {
		t.Fatalf("status after rejected transitions = %s, want draft (unchanged)", statusAfter)
	}

	// 3. Legitimate transition: draft -> published.
	publishedRev, err := func() (*domain.QuoteRevision, error) {
		var rev *domain.QuoteRevision
		err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
			var err error
			rev, err = fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
				QuoteRevisionID: draftRev.ID,
				Status:          "published",
			})
			return err
		})
		return rev, err
	}()
	if err != nil {
		t.Fatalf("legitimate transition draft -> published failed: %v", err)
	}
	if publishedRev.Status != "published" {
		t.Fatalf("status = %s, want published", publishedRev.Status)
	}

	// 4. Same-status no-op is not a transition: published -> published rejected.
	if err := updateStatus("published"); !errors.Is(err, domain.ErrQuoteRevisionConflict) {
		t.Fatalf("expected ErrQuoteRevisionConflict for published -> published no-op, got %v", err)
	}

	// 5. Direct SQL Negative Proof (DB trigger backstop): a fresh draft revision
	// cannot skip publication even bypassing the storage layer.
	var draft2 *domain.QuoteRevision
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		draft2, err = fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID:      fiSharedProject,
			BaseRevisionID: draftRev.ID,
			Status:         "draft",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: fiID, LifecycleStatus: "active"},
			},
		})
		return err
	})
	if err != nil {
		t.Fatalf("create second draft revision: %v", err)
	}
	for _, target := range []string{"accepted", "superseded"} {
		if _, err := fx.admin.Exec(ctx, `
			UPDATE quote_revisions SET status = $2 WHERE id = $1
		`, draft2.ID, target); err == nil {
			t.Fatalf("direct SQL draft -> %s succeeded, want trigger rejection", target)
		}
	}
	if _, err := fx.admin.Exec(ctx, `
		UPDATE quote_revisions SET status = 'published' WHERE id = $1
	`, draft2.ID); err != nil {
		t.Fatalf("direct SQL draft -> published failed, want success: %v", err)
	}
}

// Migration 000116 hardens the DB trigger with the exact draft guard on both
// fresh databases and upgrades from the 000115 schema.
func TestQuoteRevision_LifecycleMigration_FreshAndUpgrade(t *testing.T) {
	ctx := context.Background()

	lifecycleMigrationSQL := func(t *testing.T) string {
		t.Helper()
		contents, err := os.ReadFile("../../db/migration/000116_quote_revision_lifecycle.up.sql")
		if err != nil {
			t.Fatal(err)
		}
		return string(contents)
	}

	assertLifecycleTrigger := func(t *testing.T, pool *pgxpool.Pool) {
		t.Helper()

		// Minimal org + customer + project seed (mirrors the RLS fixture; the
		// organization stays in provisioning — the lifecycle CHECK requires an
		// active admin membership to activate, which this seed does not need).
		for _, statement := range []string{
			`INSERT INTO organizations (id, name, slug, status) VALUES
			 ('` + rlsOrgA + `', 'RLS A', 'rls-a-lifecycle', 'provisioning')`,
			`INSERT INTO customers (id, name, organization_id) VALUES
			 ('30000000-0000-0000-0000-0000000000aa', 'Customer Lifecycle', '` + rlsOrgA + `')`,
			`INSERT INTO projects (
			 id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id
			) VALUES (
			 '40000000-0000-0000-0000-0000000000aa', 'Lifecycle migration test',
			 '30000000-0000-0000-0000-0000000000aa', 'draft',
			 '` + rlsOrgA + `', '` + rlsOrgA + `', '` + rlsOrgA + `'
			)`,
		} {
			if _, err := pool.Exec(ctx, statement); err != nil {
				t.Fatalf("seed lifecycle migration db: %v\n%s", err, statement)
			}
		}

		revID := "52000000-0000-0000-0000-0000000000aa"
		if _, err := pool.Exec(ctx, `
			INSERT INTO quote_revisions (id, organization_id, project_id, revision_number, status)
			VALUES ($1, $2, '40000000-0000-0000-0000-0000000000aa', 1, 'draft')
		`, revID, rlsOrgA); err != nil {
			t.Fatalf("seed draft revision: %v", err)
		}

		// draft → accepted / superseded rejected by the hardened trigger.
		for _, target := range []string{"accepted", "superseded"} {
			if _, err := pool.Exec(ctx, `UPDATE quote_revisions SET status=$2 WHERE id=$1`, revID, target); err == nil {
				t.Fatalf("draft -> %s succeeded, want trigger rejection", target)
			}
		}
		// draft → published is the only canonical draft transition.
		if _, err := pool.Exec(ctx, `UPDATE quote_revisions SET status='published' WHERE id=$1`, revID); err != nil {
			t.Fatalf("draft -> published failed, want success: %v", err)
		}

		// The installed function body carries the draft guard.
		var prosrc string
		if err := pool.QueryRow(ctx,
			`SELECT prosrc FROM pg_proc WHERE proname='protect_quote_revision_immutability'`,
		).Scan(&prosrc); err != nil {
			t.Fatalf("read trigger function: %v", err)
		}
		if !strings.Contains(prosrc, "draft quote_revision can only transition to published") {
			t.Fatal("protect_quote_revision_immutability body lacks the draft transition guard")
		}
	}

	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 116)
	assertLifecycleTrigger(t, fresh)

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 115)
	if _, err := upgrade.Exec(ctx, lifecycleMigrationSQL(t)); err != nil {
		t.Fatalf("upgrade apply 00116: %v", err)
	}
	assertLifecycleTrigger(t, upgrade)
}

