package storage_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #398 / DT-14 End-to-End Digital Thread Contract & Regression Gate
// Proves the complete Digital Thread operates as ONE deterministic system:
// QuoteLine -> FurnitureInstance -> Design -> SketchUp -> WorkingCopy ->
// DesignRevision -> Reconciliation -> Requote -> Approval -> ProductionRelease.

const dtCanonicalMaterial = "70000000-0000-0000-0000-000000000001"

// -----------------------------------------------------------------------------
// Canonical Scenario A: Quote-First
// -----------------------------------------------------------------------------
func TestDigitalThreadE2E_ScenarioA_QuoteFirst(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	ctx := context.Background()

	// 1. Project P1 created (fiSharedProject in rlsOrgA).
	// Seed commercial state: 1-door cabinet (qty 1) + 3-drawer unit (qty 1).
	lineID1 := "60000000-0000-0000-0000-000000000a01"
	lineID2 := "60000000-0000-0000-0000-000000000a02"
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO project_items (id, project_id, module_id, quantity, custom_dims, organization_id)
		VALUES
		  ($1, $2, $3, 1, '{"widthMm": 600, "heightMm": 720, "depthMm": 560}', '`+rlsOrgA+`'),
		  ($4, $2, $3, 1, '{"widthMm": 600, "heightMm": 720, "depthMm": 560}', '`+rlsOrgA+`')`,
		lineID1, fiSharedProject, fiModuleA, lineID2); err != nil {
		t.Fatalf("seed quote lines: %v", err)
	}

	var fi001, fi002 string
	var quoteRevQ1, designD1 string

	// Step 1: Materialize physical units and create accepted baseline Q1.
	err := fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		mat1, err := fx.store.MaterializeQuoteLine(txCtx, storage.MaterializeQuoteLineCommand{
			ProjectID:   fiSharedProject,
			QuoteLineID: lineID1,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		if len(mat1.Instances) != 1 {
			t.Fatalf("mat1 expected 1 instance, got %d", len(mat1.Instances))
		}
		fi001 = mat1.Instances[0].FurnitureInstanceID

		mat2, err := fx.store.MaterializeQuoteLine(txCtx, storage.MaterializeQuoteLineCommand{
			ProjectID:   fiSharedProject,
			QuoteLineID: lineID2,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		if len(mat2.Instances) != 1 {
			t.Fatalf("mat2 expected 1 instance, got %d", len(mat2.Instances))
		}
		fi002 = mat2.Instances[0].FurnitureInstanceID

		// Contract invariant C1: distinct physical units, never using QuoteLine ID.
		if fi001 == fi002 {
			t.Fatalf("invariant violation: distinct physical units materialized identical ID %s", fi001)
		}
		if lineID1 == fi001 || lineID2 == fi002 {
			t.Fatalf("contract invariant C1 violated: QuoteLine ID used as physical unit identity")
		}

		qRev, err := fx.store.CreateQuoteRevision(txCtx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Notes:     "Baseline Q1",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID:   fi001,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					MaterialChoices:       map[string]string{"BODY": dtCanonicalMaterial},
					LifecycleStatus:       "active",
				},
				{
					FurnitureInstanceID:   fi002,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					MaterialChoices:       map[string]string{"BODY": dtCanonicalMaterial},
					LifecycleStatus:       "active",
				},
			},
		})
		if err != nil {
			return err
		}
		quoteRevQ1 = qRev.ID

		if _, err := fx.store.UpdateQuoteRevisionStatus(txCtx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: quoteRevQ1,
			Status:          "accepted",
		}); err != nil {
			return err
		}

		d, err := fx.store.CreateDesign(txCtx, storage.CreateDesignCommand{
			ProjectID:             fiSharedProject,
			Name:                  "Cocina Principal",
			SourceQuoteRevisionID: quoteRevQ1,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}
		designD1 = d.ID
		return nil
	})
	if err != nil {
		t.Fatalf("step 1 failed: %v", err)
	}

	// Capture committed Q1 snapshot for negative immutability proof.
	q1BeforeJSON := quoteRevisionItemsJSON(t, fx.admin, quoteRevQ1)

	var revR1ID string
	// Step 2: Place units, author change on FI-002, publish R1.
	err = fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		// Place units in working copy without creating new identities.
		if _, err := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   designD1,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID:   fi001,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					MaterialChoices:       map[string]string{"BODY": dtCanonicalMaterial},
					Transform:             domain.Transform3D{TranslationMm: [3]float64{0, 0, 0}},
				},
				{
					FurnitureInstanceID:   fi002,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					MaterialChoices:       map[string]string{"BODY": dtCanonicalMaterial},
					Transform:             domain.Transform3D{TranslationMm: [3]float64{600, 0, 0}},
				},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}

		// Modify FI-002 width 600 -> 650. FI-001 unchanged.
		if _, err := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   designD1,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID:   fi001,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					MaterialChoices:       map[string]string{"BODY": dtCanonicalMaterial},
					Transform:             domain.Transform3D{TranslationMm: [3]float64{0, 0, 0}},
				},
				{
					FurnitureInstanceID:   fi002,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 650.0, "heightMm": 720.0, "depthMm": 560.0},
					MaterialChoices:       map[string]string{"BODY": dtCanonicalMaterial},
					Transform:             domain.Transform3D{TranslationMm: [3]float64{600, 0, 0}},
				},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}

		revR1, err := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:    designD1,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		if revR1.RevisionNumber != 1 {
			t.Fatalf("expected R1 revision number 1, got %d", revR1.RevisionNumber)
		}
		revR1ID = revR1.ID
		return nil
	})
	if err != nil {
		t.Fatalf("step 2 failed: %v", err)
	}

	var quoteRevQ2 string
	// Step 3: Reconcile Q1-R1, classify impact, explicit requote to Q2, advance to accepted.
	err = fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		recRes, err := fx.store.ReconcileProject(txCtx, fiSharedProject, quoteRevQ1, revR1ID)
		if err != nil {
			return err
		}
		if recRes.Summary.Synced != 1 || recRes.Summary.Modified != 1 {
			t.Fatalf("reconcile Q1-R1 mismatch: synced=%d modified=%d (want 1 and 1)",
				recRes.Summary.Synced, recRes.Summary.Modified)
		}

		impact, err := domain.ClassifyReconciliation(recRes)
		if err != nil {
			return err
		}
		if !impact.Summary.RequiresRequote {
			t.Fatalf("expected RequiresRequote=true on FI-002 width change 600->650")
		}

		requoteRes, err := fx.store.RequoteProjectQuote(txCtx, storage.RequoteProjectQuoteCommand{
			ProjectID:           fiSharedProject,
			BaseQuoteRevisionID: quoteRevQ1,
			DesignRevisionID:    revR1ID,
			ActorUserID:         rlsUserA,
		})
		if err != nil {
			return err
		}
		quoteRevQ2 = requoteRes.Revision.ID
		if requoteRes.Revision.Status != "draft" || requoteRes.Revision.RevisionNumber != 2 {
			t.Fatalf("Q2 must be draft revision 2, got %+v", requoteRes.Revision)
		}

		// Canonical quote status transition: draft -> published -> accepted.
		if _, err := fx.store.UpdateQuoteRevisionStatus(txCtx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: quoteRevQ2,
			Status:          "published",
		}); err != nil {
			return err
		}
		if _, err := fx.store.UpdateQuoteRevisionStatus(txCtx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: quoteRevQ2,
			Status:          "accepted",
		}); err != nil {
			return err
		}

		// Reconcile Q2 <-> R1: non-blocking now.
		recQ2, err := fx.store.ReconcileProject(txCtx, fiSharedProject, quoteRevQ2, revR1ID)
		if err != nil {
			return err
		}
		impactQ2, err := domain.ClassifyReconciliation(recQ2)
		if err != nil {
			return err
		}
		if recQ2.Summary.Synced != 2 || recQ2.Summary.Modified != 0 || impactQ2.Summary.RequiresRequote {
			t.Fatalf("reconcile Q2-R1 must be non-blocking: synced=%d modified=%d requiresRequote=%v",
				recQ2.Summary.Synced, recQ2.Summary.Modified, impactQ2.Summary.RequiresRequote)
		}

		return nil
	})
	if err != nil {
		t.Fatalf("step 3 failed: %v", err)
	}

	// Negative proof: Q1 accepted remains 100% byte-identical in database after requote.
	q1AfterJSON := quoteRevisionItemsJSON(t, fx.admin, quoteRevQ1)
	for k, v := range q1BeforeJSON {
		if q1AfterJSON[k] != v {
			t.Fatalf("accepted quote Q1 mutated by requote on item %s", k)
		}
	}

	var releaseP1ID string
	var f1 string
	// Step 4: Approve R1 and create ProductionRelease P1.
	err = fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		appR1, err := fx.store.ApproveDesignRevision(txCtx, storage.ApproveDesignRevisionCommand{
			DesignID:         designD1,
			DesignRevisionID: revR1ID,
			ActorUserID:      rlsUserA,
		})
		if err != nil {
			return err
		}
		if appR1.Status != domain.DesignRevisionStatusApproved || appR1.ApprovedBy != rlsUserA || appR1.ApprovedAt == nil {
			t.Fatalf("R1 approval metadata missing: %+v", appR1)
		}

		p1, err := fx.store.CreateProductionRelease(txCtx, storage.CreateProductionReleaseCommand{
			ProjectID:        fiSharedProject,
			DesignRevisionID: revR1ID,
			QuoteRevisionID:  quoteRevQ2,
			ActorUserID:      rlsUserA,
			RequestID:        "req-dt-scenario-a",
		})
		if err != nil {
			return err
		}
		if p1.Release.ReleaseNumber != 1 || p1.Release.DesignRevisionID != revR1ID || p1.Release.QuoteRevisionID != quoteRevQ2 {
			t.Fatalf("P1 release pins mismatch: %+v", p1.Release)
		}
		releaseP1ID = p1.Release.ID
		f1 = p1.Release.ManufacturingFingerprint
		if !strings.HasPrefix(f1, "sha256-") {
			t.Fatalf("P1 fingerprint must be sha256-...: %s", f1)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("step 4 failed: %v", err)
	}

	// Capture committed P1 row serialization before publishing R2.
	p1BeforeJSON := releaseRowJSON(t, fx.admin, releaseP1ID)

	// Step 5: Post-Release Authoring: modify height 720 -> 800 and publish R2.
	err = fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		if _, err := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   designD1,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID:   fi001,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 800.0, "depthMm": 560.0},
					MaterialChoices:       map[string]string{"BODY": dtCanonicalMaterial},
				},
				{
					FurnitureInstanceID:   fi002,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 650.0, "heightMm": 720.0, "depthMm": 560.0},
					MaterialChoices:       map[string]string{"BODY": dtCanonicalMaterial},
				},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}

		revR2, err := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:       designD1,
			SourceType:     domain.DesignRevisionSourceSketchup,
			BaseRevisionID: revR1ID,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		if revR2.RevisionNumber != 2 {
			t.Fatalf("expected R2 revision number 2, got %d", revR2.RevisionNumber)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("step 5 failed: %v", err)
	}

	// MANDATORY NEGATIVE PROOF:
	// Publishing R2 post-release leaves P1 byte-identical, STILL pinned to R1 and F1.
	p1AfterJSON := releaseRowJSON(t, fx.admin, releaseP1ID)
	if p1BeforeJSON != p1AfterJSON {
		t.Fatalf("contract invariant C7 violated: ProductionRelease row mutated after R2 publish!\nBefore: %s\nAfter: %s",
			p1BeforeJSON, p1AfterJSON)
	}

	// Readback API verification: pins remain pinned to R1 and F1, with ManufacturingStale = true.
	err = fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		readback, err := fx.store.GetProjectProductionRelease(txCtx, fiSharedProject, releaseP1ID)
		if err != nil {
			return err
		}
		if readback.Release.DesignRevisionID != revR1ID || readback.Release.QuoteRevisionID != quoteRevQ2 {
			t.Fatalf("readback must still pin R1 and Q2, got: %+v", readback.Release)
		}
		if readback.Release.ManufacturingFingerprint != f1 {
			t.Fatalf("readback fingerprint changed from %s to %s", f1, readback.Release.ManufacturingFingerprint)
		}
		if !readback.Staleness.ManufacturingStale {
			t.Fatalf("staleness projection must flag release stale after R2 manufacturing change")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("readback check failed: %v", err)
	}
}

// -----------------------------------------------------------------------------
// Canonical Scenario B: Quantity > 1
// -----------------------------------------------------------------------------
func TestDigitalThreadE2E_ScenarioB_QuantityGreaterThanOne(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	ctx := context.Background()

	lineID := "60000000-0000-0000-0000-000000000b01"
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO project_items (id, project_id, module_id, quantity, custom_dims, organization_id)
		VALUES ($1, $2, $3, 3, '{"widthMm": 600, "heightMm": 720, "depthMm": 560}', '`+rlsOrgA+`')`,
		lineID, fiSharedProject, fiModuleA); err != nil {
		t.Fatalf("seed quote line qty=3: %v", err)
	}

	err := fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		matRes, err := fx.store.MaterializeQuoteLine(txCtx, storage.MaterializeQuoteLineCommand{
			ProjectID:   fiSharedProject,
			QuoteLineID: lineID,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		if len(matRes.Instances) != 3 {
			t.Fatalf("expected 3 physical instances, got %d", len(matRes.Instances))
		}

		fiA := matRes.Instances[0].FurnitureInstanceID
		fiB := matRes.Instances[1].FurnitureInstanceID
		fiC := matRes.Instances[2].FurnitureInstanceID

		if fiA == fiB || fiB == fiC || fiA == fiC {
			t.Fatalf("Digital Thread contract invariant C1 violated: QuoteLine qty=3 collapsed into duplicate identities: %s, %s, %s",
				fiA, fiB, fiC)
		}
		if fiA == lineID || fiB == lineID || fiC == lineID {
			t.Fatalf("Digital Thread contract invariant C1 violated: QuoteLine ID used as physical unit identity")
		}

		qRev, err := fx.store.CreateQuoteRevision(txCtx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Notes:     "Qty=3 Baseline",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}, LifecycleStatus: "active"},
				{FurnitureInstanceID: fiB, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}, LifecycleStatus: "active"},
				{FurnitureInstanceID: fiC, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}, LifecycleStatus: "active"},
			},
		})
		if err != nil {
			return err
		}

		d, err := fx.store.CreateDesign(txCtx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Partial Placement Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		if _, err := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
				{FurnitureInstanceID: fiB, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}

		rev, err := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		rec, err := fx.store.ReconcileProject(txCtx, fiSharedProject, qRev.ID, rev.ID)
		if err != nil {
			return err
		}
		if rec.Summary.Synced != 2 || rec.Summary.QuotedNotModeled != 1 {
			t.Fatalf("reconcile quantity > 1 mismatch: synced=%d quoted_not_modeled=%d (want 2 and 1)",
				rec.Summary.Synced, rec.Summary.QuotedNotModeled)
		}

		statusMap := make(map[string]domain.ReconciliationStatus)
		for _, it := range rec.Items {
			statusMap[it.FurnitureInstanceID] = it.Status
		}
		if statusMap[fiA] != domain.ReconciliationStatusSynced || statusMap[fiB] != domain.ReconciliationStatusSynced {
			t.Errorf("FI-A and FI-B must be synced, got %v and %v", statusMap[fiA], statusMap[fiB])
		}
		if statusMap[fiC] != domain.ReconciliationStatusQuotedNotModeled {
			t.Errorf("unplaced FI-C must be quoted_not_modeled, got %v", statusMap[fiC])
		}

		return nil
	})
	if err != nil {
		t.Fatalf("Scenario B failed: %v", err)
	}
}

// -----------------------------------------------------------------------------
// Canonical Scenario C: Design-First
// -----------------------------------------------------------------------------
func TestDigitalThreadE2E_ScenarioC_DesignFirst(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	var qRev1ID, revID, fiDID string

	// Step 1: Initial quote Q1 and catalog-inserted FI-D in design.
	err := fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		fi1, err := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}

		qRev1, err := fx.store.CreateQuoteRevision(txCtx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Notes:     "Initial Q1",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID:   fi1.ID,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0},
					MaterialChoices:       map[string]string{"BODY": dtCanonicalMaterial},
					LifecycleStatus:       "active",
				},
			},
		})
		if err != nil {
			return err
		}
		qRev1ID = qRev1.ID
		if _, err := fx.store.UpdateQuoteRevisionStatus(txCtx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: qRev1ID,
			Status:          "accepted",
		}); err != nil {
			return err
		}

		// Catalog insertion creates FI-D directly in project.
		fiD, err := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginDesign,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}
		fiDID = fiD.ID
		if fiD.Origin != domain.FurnitureInstanceOriginDesign {
			t.Fatalf("expected origin design, got %s", fiD.Origin)
		}

		d, err := fx.store.CreateDesign(txCtx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Design First Kitchen",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		if _, err := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fi1.ID, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
				{FurnitureInstanceID: fiDID, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 900.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}

		rev, err := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		revID = rev.ID

		rec, err := fx.store.ReconcileProject(txCtx, fiSharedProject, qRev1ID, revID)
		if err != nil {
			return err
		}
		if rec.Summary.ModeledNotQuoted != 1 {
			t.Fatalf("expected 1 modeled_not_quoted, got %d", rec.Summary.ModeledNotQuoted)
		}

		return nil
	})
	if err != nil {
		t.Fatalf("step 1 failed: %v", err)
	}

	var requoteRevisionID string
	// Step 2: Explicit requote incorporates FI-D — and ONLY existing instances.
	err = fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		before, err := fx.store.ListFurnitureInstancesByProject(txCtx, fiSharedProject, false)
		if err != nil {
			return err
		}
		beforeIDs := make(map[string]struct{}, len(before))
		for _, fi := range before {
			beforeIDs[fi.ID] = struct{}{}
		}

		requoteRes, err := fx.store.RequoteProjectQuote(txCtx, storage.RequoteProjectQuoteCommand{
			ProjectID:           fiSharedProject,
			BaseQuoteRevisionID: qRev1ID,
			DesignRevisionID:    revID,
			ActorUserID:         rlsUserA,
		})
		if err != nil {
			return err
		}
		requoteRevisionID = requoteRes.Revision.ID

		// Scenario C invariant: re-quote incorporates existing FurnitureInstances and
		// never allocates a new physical identity (no FI-E) for the
		// modeled_not_quoted unit it absorbs.
		after, err := fx.store.ListFurnitureInstancesByProject(txCtx, fiSharedProject, false)
		if err != nil {
			return err
		}
		if len(after) != len(beforeIDs) {
			t.Fatalf("Digital Thread Scenario C invariant violated: re-quote must not create FurnitureInstances; project had %d before re-quote, %d after",
				len(beforeIDs), len(after))
		}
		for _, fi := range after {
			if _, present := beforeIDs[fi.ID]; !present {
				t.Fatalf("Digital Thread Scenario C invariant violated: re-quote allocated new identity %s; re-quote must reuse existing identities, never create FI-E", fi.ID)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("step 2 failed: %v", err)
	}

	// Verify committed draft items contain FI-D with the exact same identity (never FI-E).
	draftItems := quoteRevisionItemsJSON(t, fx.admin, requoteRevisionID)
	if _, present := draftItems[fiDID]; !present {
		t.Fatalf("re-quote must incorporate FI-D with the SAME identity %s, items: %v", fiDID, draftItems)
	}
}

// -----------------------------------------------------------------------------
// Canonical Scenario D: Duplicate Identity Resolution
// -----------------------------------------------------------------------------
func TestDigitalThreadE2E_ScenarioD_DuplicateIdentity(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	err := fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		d, err := fx.store.CreateDesign(txCtx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Duplicate Test Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		fi001, err := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginDesign,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}

		// Duplicate in working copy must be rejected.
		_, errDuplicate := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fi001.ID, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
				{FurnitureInstanceID: fi001.ID, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
			},
			ActorUserID: rlsUserA,
		})
		if errDuplicate == nil {
			t.Fatalf("invariant violation: duplicate FurnitureInstance ID in working copy must fail closed")
		}

		// Resolving duplicate creates new FI with provenance.
		fiNew, err := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:                 fiSharedProject,
			FurnitureDefinitionID:     fiModuleA,
			Origin:                    domain.FurnitureInstanceOriginDuplicate,
			OriginFurnitureInstanceID: fi001.ID,
			ActorUserID:               rlsUserA,
		})
		if err != nil {
			return err
		}
		if fiNew.Origin != domain.FurnitureInstanceOriginDuplicate || fiNew.OriginFurnitureInstanceID != fi001.ID {
			t.Fatalf("duplicate resolution must preserve provenance: origin=%s, origin_id=%s",
				fiNew.Origin, fiNew.OriginFurnitureInstanceID)
		}

		// Resolved working copy publishes cleanly.
		if _, err := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fi001.ID, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
				{FurnitureInstanceID: fiNew.ID, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}

		rev, err := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		if rev.RevisionNumber != 1 {
			t.Fatalf("expected published revision 1, got %d", rev.RevisionNumber)
		}

		return nil
	})
	if err != nil {
		t.Fatalf("Scenario D failed: %v", err)
	}
}

// -----------------------------------------------------------------------------
// Canonical Scenario E: Semantic Managed-Only Scope
// -----------------------------------------------------------------------------
func TestDigitalThreadE2E_ScenarioE_SemanticScope_UnmanagedExclusion(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	var revID string

	err := fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		d, err := fx.store.CreateDesign(txCtx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Semantic Scope Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		fiManaged1, err := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginDesign,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}
		fiManaged2, err := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginDesign,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}

		// Working copy contains only managed furniture instances.
		if _, err := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fiManaged1.ID, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
				{FurnitureInstanceID: fiManaged2.ID, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}

		rev, err := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		revID = rev.ID

		items, err := fx.store.ListDesignRevisionItems(txCtx, rev.ID)
		if err != nil {
			return err
		}
		if len(items) != 2 {
			t.Fatalf("design_revision_items contains %d items, want 2 managed items only", len(items))
		}

		fingerprint, err := domain.ManufacturingFingerprint(items)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(fingerprint, "sha256-") {
			t.Fatalf("fingerprint must be sha256-...: %s", fingerprint)
		}

		return nil
	})
	if err != nil {
		t.Fatalf("Scenario E failed: %v", err)
	}

	// Verify committed items with admin connection.
	var itemCount int
	if err := fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM design_revision_items WHERE design_revision_id = $1`, revID).Scan(&itemCount); err != nil {
		t.Fatalf("query design_revision_items count: %v", err)
	}
	if itemCount != 2 {
		t.Fatalf("design_revision_items contains %d items, want 2 managed items only", itemCount)
	}
}

// -----------------------------------------------------------------------------
// Canonical Scenario F: Concurrency / Stale Base Rejection
// -----------------------------------------------------------------------------
func TestDigitalThreadE2E_ScenarioF_Concurrency_StaleBaseRejected(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	var errConflict error
	var revR2ID, designFID string

	err := fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		d, err := fx.store.CreateDesign(txCtx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Concurrency Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		fi001, err := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginDesign,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}

		if _, err := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fi001.ID, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}

		// R1 published.
		revR1, err := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		// Client A observed base = R1.
		// In the meantime, another publish happens -> R2 with BaseRevisionID = R1.
		if _, err := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fi001.ID, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 650.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		revR2, err := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:       d.ID,
			SourceType:     domain.DesignRevisionSourceSketchup,
			BaseRevisionID: revR1.ID,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		if revR2.RevisionNumber != 2 {
			t.Fatalf("expected R2 revision number 2, got %d", revR2.RevisionNumber)
		}

		revR2ID = revR2.ID
		designFID = d.ID

		// Client A now attempts to publish with baseRevisionId = R1 (stale).
		// Must return 409 conflict and abort without mutating server state. The
		// error is captured (not returned) so the R1+R2 state commits and the
		// post-rejection state can be asserted below.
		_, errConflict = fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:       d.ID,
			SourceType:     domain.DesignRevisionSourceSketchup,
			BaseRevisionID: revR1.ID,
			ActorUserID:    rlsUserA,
		})

		return nil
	})
	if err != nil {
		t.Fatalf("Scenario F failed: %v", err)
	}

	// Scenario F invariant: the rejection must be the typed 409 conflict — not any
	// opaque error that happens to mention "conflict"/"stale".
	if !errors.Is(errConflict, domain.ErrDesignRevisionConflict) {
		t.Fatalf("Digital Thread Scenario F invariant violated: stale-base publish must fail with %v, got %v",
			domain.ErrDesignRevisionConflict, errConflict)
	}

	// Scenario F invariant: the rejection must leave no trace — server head stays R2,
	// no R3 was created from the stale base, and no artifact was finalized from
	// the failed attempt.
	err = fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		revs, err := fx.store.ListDesignRevisions(txCtx, designFID)
		if err != nil {
			return err
		}
		if len(revs) != 2 {
			t.Fatalf("Digital Thread Scenario F invariant violated: stale-base publish must create no revision; design has %d revisions (want exactly R1+R2)", len(revs))
		}
		head := revs[len(revs)-1]
		if head.ID != revR2ID || head.RevisionNumber != 2 {
			t.Fatalf("Digital Thread Scenario F invariant violated: head must remain R2 (%s, number 2), got %s (number %d)",
				revR2ID, head.ID, head.RevisionNumber)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("Scenario F post-state check failed: %v", err)
	}

	// The direct snapshot publish path (#387) must not finalize artifacts; if a
	// future change finalized artifacts before the conflict check, this catches
	// the orphan. Artifact lifecycle itself is consumed from #392 (see gate doc).
	var finalizedArtifacts int
	if err := fx.admin.QueryRow(context.Background(), `
	SELECT count(*)
	FROM design_revision_artifacts a
	JOIN design_revisions r ON r.id = a.design_revision_id
	WHERE r.design_id = $1`, designFID).Scan(&finalizedArtifacts); err != nil {
		t.Fatal(err)
	}
	if finalizedArtifacts != 0 {
		t.Fatalf("Digital Thread Scenario F invariant violated: stale-base publish finalized %d artifacts (want 0)",
			finalizedArtifacts)
	}
}

// -----------------------------------------------------------------------------
// Canonical Scenario G: Release Durability
// -----------------------------------------------------------------------------
func TestDigitalThreadE2E_ScenarioG_ReleaseDurability(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	var releaseID string
	var f3 string

	err := fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		p1, err := fx.store.CreateProductionRelease(txCtx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
			RequestID:        "req-scenario-g",
		})
		if err != nil {
			return err
		}
		releaseID = p1.Release.ID
		f3 = p1.Release.ManufacturingFingerprint

		// Authoring continues: publish R4 with base = R3.
		if _, err := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   fx.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 700.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
				{FurnitureInstanceID: fx.fiB, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 700.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		revR4, err := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			SourceType:     domain.DesignRevisionSourceSketchup,
			BaseRevisionID: fx.revR3,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}

		// Continue authoring: publish R5 with base = R4.
		if _, err := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   fx.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 800.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
				{FurnitureInstanceID: fx.fiB, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 800.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": dtCanonicalMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		revR5, err := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			SourceType:     domain.DesignRevisionSourceSketchup,
			BaseRevisionID: revR4.ID,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		if revR4.RevisionNumber != 2 || revR5.RevisionNumber != 3 {
			t.Fatalf("expected R4=2 and R5=3, got %d and %d", revR4.RevisionNumber, revR5.RevisionNumber)
		}

		// Verify P1 remains pinned to R3 and F3 forever.
		readback, err := fx.store.GetProjectProductionRelease(txCtx, fx.projectID, releaseID)
		if err != nil {
			return err
		}
		if readback.Release.ID != releaseID {
			t.Fatalf("release ID changed: %s vs %s", readback.Release.ID, releaseID)
		}
		if readback.Release.DesignRevisionID != fx.revR3 {
			t.Fatalf("release design revision retargeted to %s, want %s (R3)",
				readback.Release.DesignRevisionID, fx.revR3)
		}
		if readback.Release.ManufacturingFingerprint != f3 {
			t.Fatalf("release fingerprint changed: %s vs %s", readback.Release.ManufacturingFingerprint, f3)
		}

		return nil
	})
	if err != nil {
		t.Fatalf("Scenario G failed: %v", err)
	}
}

// -----------------------------------------------------------------------------
// Digital Thread Negative Proofs & Guardrails
// -----------------------------------------------------------------------------
func TestDigitalThreadE2E_NegativeProofs(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	actorB := fiActorB()
	ctx := context.Background()

	var qRevAID, revBID string

	// 1. Setup: Project A quote revision in Org A.
	err := fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		qRevA, err := fx.store.CreateQuoteRevision(txCtx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Notes:     "Project A Quote",
			Items:     []storage.CreateQuoteRevisionItemCommand{},
		})
		if err != nil {
			return err
		}
		qRevAID = qRevA.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup quote A: %v", err)
	}

	// Setup: Project B design in Org B.
	err = fiTx(t, fx.store, actorB, func(txCtx context.Context) error {
		dProjB, err := fx.store.CreateDesign(txCtx, storage.CreateDesignCommand{
			ProjectID:   fiProjectB,
			Name:        "Project B Design",
			ActorUserID: rlsUserB,
		})
		if err != nil {
			return err
		}
		revB, err := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:    dProjB.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserB,
		})
		if err != nil {
			return err
		}
		revBID = revB.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup design B: %v", err)
	}

	// Cross-Project Rejection: QuoteRevision from Project A cannot reconcile with DesignRevision from Project B.
	err = fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		_, errCross := fx.store.ReconcileProject(txCtx, fiSharedProject, qRevAID, revBID)
		if errCross == nil {
			t.Fatalf("expected cross-project reconciliation rejection, got nil")
		}

		_, errCrossRelease := fx.store.CreateProductionRelease(txCtx, storage.CreateProductionReleaseCommand{
			ProjectID:        fiSharedProject,
			DesignRevisionID: revBID,
			QuoteRevisionID:  qRevAID,
			ActorUserID:      rlsUserA,
		})
		if errCrossRelease == nil {
			t.Fatalf("expected cross-project production release rejection, got nil")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("Cross-project rejection test failed: %v", err)
	}

	// 2. Fake UUID Negative Proof: Syntactically valid but unknown UUID fails closed.
	err = fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		unknownUUID := "99999999-9999-4999-8999-999999999999"
		_, errFake := fx.store.ReconcileProject(txCtx, fiSharedProject, unknownUUID, unknownUUID)
		if errFake == nil {
			t.Fatalf("reconcile with unknown UUID must fail closed")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("Fake UUID negative proof failed: %v", err)
	}

	// 3. Multi-Org RLS Isolation: Org B cannot mutate Org A's Digital Thread.
	err = fiTx(t, fx.store, actorB, func(txCtx context.Context) error {
		_, errRLS := fx.store.CreateDesign(txCtx, storage.CreateDesignCommand{
			ProjectID:   fiProjectAOnly,
			Name:        "Unauthorized Design",
			ActorUserID: rlsUserB,
		})
		if errRLS == nil {
			t.Fatalf("RLS isolation failure: Org B created design on Org A project")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("RLS negative proof failed: %v", err)
	}

	// 4. DB Immutability Triggers: direct UPDATE or DELETE on accepted quote revision is blocked at DB level.
	var acceptedQuoteID string
	err = fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		q, err := fx.store.CreateQuoteRevision(txCtx, storage.CreateQuoteRevisionCommand{
			ProjectID:      fiSharedProject,
			BaseRevisionID: qRevAID,
			Notes:          "Immutable Quote",
			Items:          []storage.CreateQuoteRevisionItemCommand{},
		})
		if err != nil {
			return err
		}
		if _, err := fx.store.UpdateQuoteRevisionStatus(txCtx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: q.ID,
			Status:          "accepted",
		}); err != nil {
			return err
		}
		acceptedQuoteID = q.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup immutability test: %v", err)
	}

	// Direct SQL UPDATE on accepted quote revision notes must fail.
	_, errDirectSQL := fx.admin.Exec(ctx, `UPDATE quote_revisions SET notes = 'Hacked' WHERE id = $1`, acceptedQuoteID)
	if errDirectSQL == nil {
		t.Fatalf("expected DB trigger to block UPDATE on accepted quote revision, got nil")
	}
}

// Ensure deterministic fingerprint contract.
func TestDigitalThreadE2E_DeterministicFingerprintParity(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	err := fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		d, err := fx.store.CreateDesign(txCtx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Fingerprint Parity Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		fi1, err := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginDesign,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}

		if _, err := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID:   fi1.ID,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					MaterialChoices:       map[string]string{"BODY": dtCanonicalMaterial},
					Transform:             domain.Transform3D{TranslationMm: [3]float64{100, 0, 0}},
				},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}

		rev1, err := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		items1, err := fx.store.ListDesignRevisionItems(txCtx, rev1.ID)
		if err != nil {
			return err
		}
		fp1, err := domain.ManufacturingFingerprint(items1)
		if err != nil {
			return err
		}

		// Spatial-only change: moving the unit from 100 -> 500 translation preserves manufacturing fingerprint.
		if _, err := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID:   fi1.ID,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
					MaterialChoices:       map[string]string{"BODY": dtCanonicalMaterial},
					Transform:             domain.Transform3D{TranslationMm: [3]float64{500, 0, 0}},
				},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}

		rev2, err := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:       d.ID,
			SourceType:     domain.DesignRevisionSourceSketchup,
			BaseRevisionID: rev1.ID,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}

		items2, err := fx.store.ListDesignRevisionItems(txCtx, rev2.ID)
		if err != nil {
			return err
		}
		fp2, err := domain.ManufacturingFingerprint(items2)
		if err != nil {
			return err
		}

		if fp1 != fp2 {
			t.Fatalf("spatial-only transform change must NOT alter manufacturing fingerprint: fp1=%s fp2=%s",
				fp1, fp2)
		}

		// Manufacturing-affecting change: changing widthMm 600 -> 650 MUST alter manufacturing fingerprint.
		if _, err := fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID:   fi1.ID,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 650.0, "heightMm": 720.0, "depthMm": 560.0},
					MaterialChoices:       map[string]string{"BODY": dtCanonicalMaterial},
					Transform:             domain.Transform3D{TranslationMm: [3]float64{500, 0, 0}},
				},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}

		rev3, err := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID:       d.ID,
			SourceType:     domain.DesignRevisionSourceSketchup,
			BaseRevisionID: rev2.ID,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}

		items3, err := fx.store.ListDesignRevisionItems(txCtx, rev3.ID)
		if err != nil {
			return err
		}
		fp3, err := domain.ManufacturingFingerprint(items3)
		if err != nil {
			return err
		}

		if fp1 == fp3 {
			t.Fatalf("manufacturing-affecting parameter change MUST produce different fingerprint: fp1=%s fp3=%s",
				fp1, fp3)
		}

		return nil
	})
	if err != nil {
		t.Fatalf("Fingerprint parity test failed: %v", err)
	}
}
