package storage_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #394 / DT-10: explicit requote against real PostgreSQL under the app role.
//
// Key contracts verified:
// - The accepted source revision stays EXACTLY intact: row, status and items
//   are byte-identical after the requote.
// - The new draft revision is created through the single #393 writer with
//   requote provenance (base quote revision + source design revision).
// - Stale base revisions fail closed with ErrQuoteRevisionConflict.
// - Inputs without commercial changes (fully synced, or a pure design-side
//   move) never create a commercial revision.
// - modeled_not_quoted units join the draft with the SAME identity.
// - Only the owning organization can requote (shared-read org cannot).
// - The durable audit event lands in the same transaction.
//
// Conflict blocking is structurally guaranteed at this layer: the DB unique
// constraints (one item per revision+instance, FK-backed identities) make
// duplicate/malformed identities impossible to persist, so the fail-closed
// conflict guard is proven at domain level (requote_test.go).

type requoteFixture struct {
	store        *storage.PostgresStore
	admin        *pgxpool.Pool
	projectID    string
	quoteRevID   string
	designRevID  string
	fiSynced     string
	fiModified   string
	fiModeledNew string
}

// setupRequoteFixture builds the canonical demo against real PostgreSQL:
// Q1 (later accepted) with FI-A/FI-B; published design revision with FI-A
// synced, FI-B width 600→650 and FI-C modeled but never quoted.
func setupRequoteFixture(t *testing.T) *requoteFixture {
	t.Helper()
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	lineID := "60000000-0000-0000-0000-000000000092"
	if _, err := fx.admin.Exec(context.Background(), `
		INSERT INTO project_items (id, project_id, module_id, quantity, custom_dims, organization_id)
		VALUES ($1, $2, $3, 2, '{"widthMm": 600, "heightMm": 720, "depthMm": 560}', '`+rlsOrgA+`')`,
		lineID, fiSharedProject, fiModuleA); err != nil {
		t.Fatalf("seed quote line: %v", err)
	}

	out := &requoteFixture{store: fx.store, admin: fx.admin, projectID: fiSharedProject}
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Requote Demo Design",
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
		out.fiSynced = matRes.Instances[0].FurnitureInstanceID
		out.fiModified = matRes.Instances[1].FurnitureInstanceID

		// #390-style catalog insertion: modeled unit never quoted.
		newFI, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginDesign,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}
		out.fiModeledNew = newFI.ID

		qRev, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Notes:     "Q1",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID:   out.fiSynced,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0},
					MaterialChoices:       map[string]string{"BODY": "70000000-0000-0000-0000-000000000001"},
					LifecycleStatus:       "active",
				},
				{
					FurnitureInstanceID:   out.fiModified,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0},
					MaterialChoices:       map[string]string{"BODY": "70000000-0000-0000-0000-000000000001"},
					LifecycleStatus:       "active",
				},
			},
		})
		if err != nil {
			return err
		}
		out.quoteRevID = qRev.ID

		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: out.fiSynced, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": "70000000-0000-0000-0000-000000000001"}},
				{FurnitureInstanceID: out.fiModified, Parameters: map[string]any{"widthMm": 650.0, "heightMm": 720.0}, MaterialChoices: map[string]string{"BODY": "70000000-0000-0000-0000-000000000001"}},
				{FurnitureInstanceID: out.fiModeledNew, Parameters: map[string]any{"widthMm": 450.0, "heightMm": 1400.0}, MaterialChoices: map[string]string{"BODY": "70000000-0000-0000-0000-000000000001"}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
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
		out.designRevID = rev.ID

		// Canonical demo: the source revision is ACCEPTED before the designer
		// keeps working.
		if _, err := fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: qRev.ID,
			Status:          "accepted",
		}); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		t.Fatalf("setup requote fixture: %v", err)
	}
	return out
}

func quoteRevisionItemsJSON(t *testing.T, pool *pgxpool.Pool, quoteRevisionID string) map[string]string {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT furniture_instance_id::text, parameters::text, material_choices::text, lifecycle_status
		FROM quote_revision_items
		WHERE quote_revision_id = $1
		ORDER BY furniture_instance_id
	`, quoteRevisionID)
	if err != nil {
		t.Fatalf("read quote revision items: %v", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var fiID, params, mats, lifecycle string
		if err := rows.Scan(&fiID, &params, &mats, &lifecycle); err != nil {
			t.Fatalf("scan quote revision item: %v", err)
		}
		out[fiID] = params + "|" + mats + "|" + lifecycle
	}
	return out
}

func TestRequote_AcceptedQuoteStaysIntact(t *testing.T) {
	fx := setupRequoteFixture(t)
	ctx := context.Background()

	beforeItems := quoteRevisionItemsJSON(t, fx.admin, fx.quoteRevID)

	var result *storage.RequoteProjectQuoteResult
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		result, err = fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:           fx.projectID,
			BaseQuoteRevisionID: fx.quoteRevID,
			DesignRevisionID:    fx.designRevID,
			ActorUserID:         rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("RequoteProjectQuote: %v", err)
	}

	// The new revision is a DRAFT requote with exact provenance.
	rev := result.Revision
	if rev.Status != "draft" {
		t.Errorf("new revision status = %s, want draft", rev.Status)
	}
	if rev.SourceType != "requote" {
		t.Errorf("new revision source_type = %s, want requote", rev.SourceType)
	}
	if rev.RevisionNumber != 2 {
		t.Errorf("new revision number = %d, want 2", rev.RevisionNumber)
	}
	if rev.BaseQuoteRevisionID != fx.quoteRevID {
		t.Errorf("provenance base_quote_revision_id = %s, want %s", rev.BaseQuoteRevisionID, fx.quoteRevID)
	}
	if rev.SourceDesignRevisionID != fx.designRevID {
		t.Errorf("provenance source_design_revision_id = %s, want %s", rev.SourceDesignRevisionID, fx.designRevID)
	}

	// The accepted source revision is EXACTLY intact (status + items).
	var status string
	if err := fx.admin.QueryRow(ctx, `SELECT status FROM quote_revisions WHERE id=$1`, fx.quoteRevID).Scan(&status); err != nil {
		t.Fatalf("read source revision: %v", err)
	}
	if status != "accepted" {
		t.Errorf("source revision status = %s, want accepted (never rewritten)", status)
	}
	afterItems := quoteRevisionItemsJSON(t, fx.admin, fx.quoteRevID)
	if len(afterItems) != len(beforeItems) {
		t.Fatalf("source revision item count changed: %d -> %d", len(beforeItems), len(afterItems))
	}
	for fiID, before := range beforeItems {
		if afterItems[fiID] != before {
			t.Errorf("source revision item %s mutated by the requote", fiID)
		}
	}

	// The draft carries the design truth with the SAME identities.
	draftItems := quoteRevisionItemsJSON(t, fx.admin, rev.ID)
	if len(draftItems) != 3 {
		t.Fatalf("draft revision items = %d, want 3 (synced + modified + newly quoted)", len(draftItems))
	}
	if !strings.Contains(draftItems[fx.fiSynced], `"widthMm": 600`) {
		t.Errorf("synced unit must keep width 600, got %s", draftItems[fx.fiSynced])
	}
	if !strings.Contains(draftItems[fx.fiModified], `"widthMm": 650`) {
		t.Errorf("modified unit must incorporate design width 650, got %s", draftItems[fx.fiModified])
	}
	if _, present := draftItems[fx.fiModeledNew]; !present {
		t.Errorf("modeled_not_quoted unit %s must join the draft with the SAME identity", fx.fiModeledNew)
	}

	// Classification is part of the result (server-authoritative).
	if result.Classification == nil || !result.Classification.Summary.RequiresRequote {
		t.Errorf("result classification must carry requiresRequote=true")
	}

	// Durable audit in the same transaction.
	var auditCount int
	if err := fx.admin.QueryRow(ctx, `
		SELECT COUNT(*) FROM security_audit_events
		WHERE event_type = 'quote_revision_created_from_design'
		  AND details->>'quote_revision_id' = $1
		  AND details->>'source_quote_revision_id' = $2
		  AND details->>'design_revision_id' = $3
	`, rev.ID, fx.quoteRevID, fx.designRevID).Scan(&auditCount); err != nil {
		t.Fatalf("read audit events: %v", err)
	}
	if auditCount != 1 {
		t.Errorf("audit events = %d, want exactly 1", auditCount)
	}
}

func TestRequote_StaleBaseRejected_FailClosed(t *testing.T) {
	fx := setupRequoteFixture(t)

	var q4 *storage.RequoteProjectQuoteResult
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		q4, err = fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:           fx.projectID,
			BaseQuoteRevisionID: fx.quoteRevID,
			DesignRevisionID:    fx.designRevID,
			ActorUserID:         rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("first requote: %v", err)
	}

	// Re-quoting from the now-stale Q3 must fail closed: no silent Q5.
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:           fx.projectID,
			BaseQuoteRevisionID: fx.quoteRevID,
			DesignRevisionID:    fx.designRevID,
			ActorUserID:         rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrQuoteRevisionConflict) {
		t.Fatalf("stale base must fail closed with ErrQuoteRevisionConflict, got %v", err)
	}

	// Reconciling against the new latest (Q4 draft) is the correct next step;
	// it reports the pending decision instead of inventing changes.
	var recon *domain.ReconciliationResult
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		recon, err = fx.store.ReconcileProject(ctx, fx.projectID, q4.Revision.ID, fx.designRevID)
		return err
	})
	if err != nil {
		t.Fatalf("reconcile against Q4: %v", err)
	}
	if recon.Summary.Synced != 3 || recon.Summary.Total != 3 {
		t.Errorf("Q4 draft ↔ design must be fully synced, got %+v", recon.Summary)
	}
}

func TestRequote_NoCommercialChanges_Rejected(t *testing.T) {
	fx := setupRequoteFixture(t)

	// Reconcile-then-requote against a design revision identical to the quote
	// is impossible here (the fixture always carries changes), so prove the
	// fully-synced rejection on a fresh minimal project fixture.
	actorA := fiActorA()
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id)
		VALUES ('40000000-0000-0000-0000-0000000000c1', 'Requote synced', '30000000-0000-0000-0000-00000000000a', 'draft',
			'`+rlsOrgA+`', '`+rlsOrgA+`', '`+rlsOrgA+`')`); err != nil {
		t.Fatal(err)
	}

	var quoteRevID, designRevID, fiID string
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		instance, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             "40000000-0000-0000-0000-0000000000c1",
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginManual,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}
		fiID = instance.ID

		qRev, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: "40000000-0000-0000-0000-0000000000c1",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: fiID, Parameters: map[string]any{"widthMm": 600.0}},
			},
		})
		if err != nil {
			return err
		}
		quoteRevID = qRev.ID

		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   "40000000-0000-0000-0000-0000000000c1",
			Name:        "Synced design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceManual,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fiID, Parameters: map[string]any{"widthMm": 600.0}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceManual,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		designRevID = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup synced fixture: %v", err)
	}

	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:           "40000000-0000-0000-0000-0000000000c1",
			BaseQuoteRevisionID: quoteRevID,
			DesignRevisionID:    designRevID,
			ActorUserID:         rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrRequoteNoCommercialChange) {
		t.Fatalf("fully synced inputs must reject the requote, got %v", err)
	}
}

func TestRequote_PureMove_NeverCreatesCommercialRevision(t *testing.T) {
	// Negative proof (#394 §34) at the persisted layer: the design item is
	// MOVED (transform x 1000 → 2500) while its commercial truth is
	// unchanged. The persisted quote snapshot never carries spatial data, so
	// there is no spatial evidence — and no commercial change either. The
	// requote must be rejected instead of silently minting a new revision.
	fx := setupRequoteFixture(t)
	actorA := fiActorA()
	ctx := context.Background()

	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id)
		VALUES ('40000000-0000-0000-0000-0000000000c2', 'Requote moved', '30000000-0000-0000-0000-00000000000a', 'draft',
			'`+rlsOrgA+`', '`+rlsOrgA+`', '`+rlsOrgA+`')`); err != nil {
		t.Fatal(err)
	}

	var quoteRevID, designRevID, fiID string
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		instance, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             "40000000-0000-0000-0000-0000000000c2",
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginManual,
			ActorUserID:           rlsUserA,
		})
		if err != nil {
			return err
		}
		fiID = instance.ID

		qRev, err := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: "40000000-0000-0000-0000-0000000000c2",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: fiID, Parameters: map[string]any{"widthMm": 600.0}},
			},
		})
		if err != nil {
			return err
		}
		quoteRevID = qRev.ID

		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   "40000000-0000-0000-0000-0000000000c2",
			Name:        "Moved design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   d.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID: fiID,
					Parameters:          map[string]any{"widthMm": 600.0},
					Transform:           domain.Transform3D{TranslationMm: [3]float64{2500, 0, 0}},
				},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
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
		t.Fatalf("setup moved fixture: %v", err)
	}

	// The persisted reconciliation stays synced: one-sided spatial evidence
	// is never invented into a difference (#393 §42 preserved by #394).
	var recon *domain.ReconciliationResult
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		recon, err = fx.store.ReconcileProject(ctx, "40000000-0000-0000-0000-0000000000c2", quoteRevID, designRevID)
		return err
	})
	if err != nil {
		t.Fatalf("reconcile moved fixture: %v", err)
	}
	if recon.Summary.Synced != 1 || recon.Summary.Total != 1 {
		t.Fatalf("pure move must reconcile as synced, got %+v", recon.Summary)
	}

	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:           "40000000-0000-0000-0000-0000000000c2",
			BaseQuoteRevisionID: quoteRevID,
			DesignRevisionID:    designRevID,
			ActorUserID:         rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrRequoteNoCommercialChange) {
		t.Fatalf("moving a unit must never create a commercial revision, got %v", err)
	}
}

func TestRequote_SelectionControlsIncorporation(t *testing.T) {
	fx := setupRequoteFixture(t)

	var result *storage.RequoteProjectQuoteResult
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		result, err = fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:                   fx.projectID,
			BaseQuoteRevisionID:         fx.quoteRevID,
			DesignRevisionID:            fx.designRevID,
			IncludeFurnitureInstanceIDs: []string{fx.fiModified},
			ActorUserID:                 rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("RequoteProjectQuote with selection: %v", err)
	}

	draftItems := quoteRevisionItemsJSON(t, fx.admin, result.Revision.ID)
	if _, included := draftItems[fx.fiModeledNew]; included {
		t.Errorf("unselected modeled_not_quoted unit must stay out of the draft")
	}
	if !strings.Contains(draftItems[fx.fiModified], `"widthMm": 650`) {
		t.Errorf("selected modified unit must incorporate the design width, got %s", draftItems[fx.fiModified])
	}
	if len(draftItems) != 2 {
		t.Errorf("draft items = %d, want 2 (the two originally quoted units)", len(draftItems))
	}
}

func TestRequote_SelectionFailClosed_NoRevisionCreated(t *testing.T) {
	fx := setupRequoteFixture(t)
	ctx := context.Background()

	countRevisions := func() int {
		var n int
		if err := fx.admin.QueryRow(ctx, `SELECT COUNT(*) FROM quote_revisions WHERE project_id=$1`, fx.projectID).Scan(&n); err != nil {
			t.Fatalf("count revisions: %v", err)
		}
		return n
	}
	before := countRevisions()

	// A syntactically valid UUID that is not part of this reconciliation
	// (e.g. a unit of another project) must reject the whole command.
	unknownID := "e0000000-0000-4000-8000-0000000000ff"
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:                   fx.projectID,
			BaseQuoteRevisionID:         fx.quoteRevID,
			DesignRevisionID:            fx.designRevID,
			IncludeFurnitureInstanceIDs: []string{fx.fiModified, unknownID},
			ActorUserID:                 rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrRequoteInvalidSelection) {
		t.Fatalf("unknown identity in selection must fail closed, got %v", err)
	}
	if got := countRevisions(); got != before {
		t.Fatalf("rejected selection must create nothing: revisions %d -> %d", before, got)
	}

	// The synced unit is equally non-actionable.
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:                   fx.projectID,
			BaseQuoteRevisionID:         fx.quoteRevID,
			DesignRevisionID:            fx.designRevID,
			IncludeFurnitureInstanceIDs: []string{fx.fiSynced},
			ActorUserID:                 rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrRequoteInvalidSelection) {
		t.Fatalf("synced identity in selection must fail closed, got %v", err)
	}
	if got := countRevisions(); got != before {
		t.Fatalf("rejected selection must create nothing: revisions %d -> %d", before, got)
	}

	// A VALID selection still works afterwards and incorporates exactly the
	// selected design truth.
	var result *storage.RequoteProjectQuoteResult
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		result, err = fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:                   fx.projectID,
			BaseQuoteRevisionID:         fx.quoteRevID,
			DesignRevisionID:            fx.designRevID,
			IncludeFurnitureInstanceIDs: []string{fx.fiModified},
			ActorUserID:                 rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("valid selection must succeed after the rejections: %v", err)
	}
	if got := countRevisions(); got != before+1 {
		t.Fatalf("valid selection must create exactly one revision: %d -> %d", before, got)
	}
	draftItems := quoteRevisionItemsJSON(t, fx.admin, result.Revision.ID)
	if !strings.Contains(draftItems[fx.fiModified], `"widthMm": 650`) {
		t.Errorf("selected modified unit must incorporate the design width, got %s", draftItems[fx.fiModified])
	}
	if _, present := draftItems[fx.fiModeledNew]; present {
		t.Errorf("unselected modeled_not_quoted unit must remain not quoted")
	}
}

// The contract defines an explicit empty includeFurnitureInstanceIds as
// equivalent to omission: incorporate all eligible design-driven changes.
func TestRequote_EmptySelectionMeansIncorporateAll(t *testing.T) {
	fx := setupRequoteFixture(t)

	var result *storage.RequoteProjectQuoteResult
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		result, err = fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:                   fx.projectID,
			BaseQuoteRevisionID:         fx.quoteRevID,
			DesignRevisionID:            fx.designRevID,
			IncludeFurnitureInstanceIDs: []string{},
			ActorUserID:                 rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("explicit empty selection must behave as omission (incorporate all): %v", err)
	}
	draftItems := quoteRevisionItemsJSON(t, fx.admin, result.Revision.ID)
	if len(draftItems) != 3 {
		t.Fatalf("draft items = %d, want 3 (empty selection incorporates everything eligible)", len(draftItems))
	}
	if _, present := draftItems[fx.fiModeledNew]; !present {
		t.Errorf("empty selection must incorporate the modeled_not_quoted unit")
	}
}

func TestRequote_MultiOrgRLS_OwnerOrganizationOnly(t *testing.T) {
	fx := setupRequoteFixture(t)

	// Org B has shared read access to the project (manufacturing partner)
	// but commercial revisions stay with the owner.
	err := fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:           fx.projectID,
			BaseQuoteRevisionID: fx.quoteRevID,
			DesignRevisionID:    fx.designRevID,
			ActorUserID:         rlsUserB,
		})
		return err
	})
	if !errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable) {
		t.Fatalf("shared-read organization must not requote, got %v", err)
	}
}

func TestRequote_RevisionsWithoutProvenance_StillValid(t *testing.T) {
	fx := setupRequoteFixture(t)
	ctx := context.Background()

	// Manual revisions carry no provenance; the requote child does.
	var result *storage.RequoteProjectQuoteResult
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		result, err = fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:           fx.projectID,
			BaseQuoteRevisionID: fx.quoteRevID,
			DesignRevisionID:    fx.designRevID,
			ActorUserID:         rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("requote: %v", err)
	}

	var base, design string
	if err := fx.admin.QueryRow(ctx, `
		SELECT COALESCE(base_quote_revision_id::text, ''), COALESCE(source_design_revision_id::text, '')
		FROM quote_revisions WHERE id = $1
	`, result.Revision.ID).Scan(&base, &design); err != nil {
		t.Fatalf("read provenance: %v", err)
	}
	if base != fx.quoteRevID || design != fx.designRevID {
		t.Errorf("provenance columns = (%s, %s), want (%s, %s)", base, design, fx.quoteRevID, fx.designRevID)
	}

	// The source revision keeps NULL provenance (manual origin).
	var sourceBase, sourceDesign *string
	if err := fx.admin.QueryRow(ctx, `
		SELECT base_quote_revision_id::text, source_design_revision_id::text
		FROM quote_revisions WHERE id = $1
	`, fx.quoteRevID).Scan(&sourceBase, &sourceDesign); err != nil {
		t.Fatalf("read source provenance: %v", err)
	}
	if sourceBase != nil || sourceDesign != nil {
		t.Errorf("manual revision must carry no provenance, got (%v, %v)", sourceBase, sourceDesign)
	}
}

func requoteProvenanceMigrationSQL(t *testing.T) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000117_quote_revision_requote_provenance.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func assertRequoteProvenanceSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	for _, column := range []string{"base_quote_revision_id", "source_design_revision_id"} {
		var exists bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_name = 'quote_revisions' AND column_name = $1
			)
		`, column).Scan(&exists); err != nil || !exists {
			t.Fatalf("quote_revisions.%s missing after migration (err=%v)", column, err)
		}
	}

	// Minimal seed: org + customer + project + two revisions + a design
	// revision so provenance FKs have real targets.
	for _, statement := range []string{
		`INSERT INTO organizations (id, name, slug, status) VALUES
		 ('` + rlsOrgA + `', 'RLS A', 'rls-a-provenance', 'provisioning')`,
		`INSERT INTO customers (id, name, organization_id) VALUES
		 ('30000000-0000-0000-0000-0000000000ab', 'Customer Provenance', '` + rlsOrgA + `')`,
		`INSERT INTO projects (
		 id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id
		) VALUES (
		 '40000000-0000-0000-0000-0000000000ab', 'Provenance migration test',
		 '30000000-0000-0000-0000-0000000000ab', 'draft',
		 '` + rlsOrgA + `', '` + rlsOrgA + `', '` + rlsOrgA + `'
		)`,
		`INSERT INTO designs (id, project_id, name, organization_id)
		 VALUES ('49000000-0000-0000-0000-0000000000ab', '40000000-0000-0000-0000-0000000000ab', 'D', '` + rlsOrgA + `')`,
		`INSERT INTO design_revisions (id, design_id, project_id, revision_number, source_type, status, organization_id)
		 VALUES ('53000000-0000-0000-0000-0000000000ab', '49000000-0000-0000-0000-0000000000ab',
			'40000000-0000-0000-0000-0000000000ab', 1, 'manual', 'published', '` + rlsOrgA + `')`,
		`INSERT INTO quote_revisions (id, organization_id, project_id, revision_number, status)
		 VALUES ('54000000-0000-0000-0000-0000000000aa', '` + rlsOrgA + `', '40000000-0000-0000-0000-0000000000ab', 1, 'published')`,
		`INSERT INTO quote_revisions (id, organization_id, project_id, revision_number, status,
			base_quote_revision_id, source_design_revision_id)
		 VALUES ('54000000-0000-0000-0000-0000000000bb', '` + rlsOrgA + `', '40000000-0000-0000-0000-0000000000ab', 2, 'draft',
			'54000000-0000-0000-0000-0000000000aa', '53000000-0000-0000-0000-0000000000ab')`,
	} {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("seed provenance migration db: %v\n%s", err, statement)
		}
	}

	// Provenance is immutable once written.
	if _, err := pool.Exec(ctx,
		`UPDATE quote_revisions SET base_quote_revision_id = NULL WHERE id = '54000000-0000-0000-0000-0000000000bb'`); err == nil {
		t.Fatal("base_quote_revision_id mutation succeeded, want trigger rejection")
	}
	// The status lifecycle keeps working alongside the new guards.
	if _, err := pool.Exec(ctx,
		`UPDATE quote_revisions SET status='published' WHERE id = '54000000-0000-0000-0000-0000000000bb'`); err != nil {
		t.Fatalf("draft -> published must still work: %v", err)
	}
	// Cross-project provenance is structurally impossible: the composite FK
	// rejects a base revision that belongs to another project.
	if _, err := pool.Exec(ctx, `
		INSERT INTO projects (
		 id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id
		) VALUES (
		 '40000000-0000-0000-0000-0000000000ac', 'Other project',
		 '30000000-0000-0000-0000-0000000000ab', 'draft',
		 '`+rlsOrgA+`', '`+rlsOrgA+`', '`+rlsOrgA+`'
		)`); err != nil {
		t.Fatalf("seed other project: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO quote_revisions (organization_id, project_id, revision_number, status, base_quote_revision_id)
		VALUES ('`+rlsOrgA+`', '40000000-0000-0000-0000-0000000000ac', 1, 'draft',
			'54000000-0000-0000-0000-0000000000aa'::uuid)`); err == nil {
		t.Fatal("cross-project base provenance accepted, want composite FK rejection")
	}
}

func TestRequote_ProvenanceMigration_FreshAndUpgrade(t *testing.T) {
	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 117)
	assertRequoteProvenanceSchema(t, fresh)

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 116)
	if _, err := upgrade.Exec(context.Background(), requoteProvenanceMigrationSQL(t)); err != nil {
		t.Fatalf("upgrade apply 00117: %v", err)
	}
	assertRequoteProvenanceSchema(t, upgrade)
}
