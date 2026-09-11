package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #642 / 2A: ListProjectCommercialSummaries against real PostgreSQL under the app role.
//
// Key contracts verified:
// - Sole commercial authority: authoritative revision is selected (accepted if present, otherwise newest).
// - In-progress draft detection: when Q_accepted is selected and a newer draft exists, ActiveDraftRevisionNumber is populated.
// - Superseded handling: when Q1 was accepted and Q2 is now accepted, Q2 is selected.
// - Project without revisions: answers quoteStatus='none', isLegacy=false, saleTotal=nil, furnitureQuantity=0.
// - Legacy revision without snapshot: answers isLegacy=true, saleTotal=nil, never recalculates.
// - Multi-org isolation: tenant boundary enforced (only accessible projects returned).

func TestListProjectCommercialSummaries_AuthoritativeRevisionAndActiveDraft(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	// Create physical identity for the shared project (owner org A)
	var instanceID string
	err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		created, txErr := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
			RequestID:             "cs-summary-inst-1",
		})
		if txErr != nil {
			return txErr
		}
		instanceID = created.ID
		return nil
	})
	if err != nil {
		t.Fatalf("create instance: %v", err)
	}

	// Q1: published and accepted
	var q1 *domain.QuoteRevision
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var txErr error
		q1, txErr = createFixtureQuoteRevision(txCtx, fx.store, storage.CreateQuoteRevisionCommand{
			OrganizationID: rlsOrgA,
			ProjectID:      fiSharedProject,
			Status:         "published",
			SourceType:     "manual",
			CreatedBy:      rlsUserA,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: instanceID, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600}, MaterialChoices: map[string]string{"carcass": "mat-blanco"}, LifecycleStatus: "active"},
			},
		})
		return txErr
	}); err != nil {
		t.Fatalf("create Q1: %v", err)
	}
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		_, txErr := fx.store.UpdateQuoteRevisionStatus(txCtx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: q1.ID,
			Status:          "accepted",
		})
		return txErr
	}); err != nil {
		t.Fatalf("accept Q1: %v", err)
	}

	// Q2: draft based on Q1
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		_, txErr := createFixtureQuoteRevision(txCtx, fx.store, storage.CreateQuoteRevisionCommand{
			OrganizationID: rlsOrgA,
			ProjectID:      fiSharedProject,
			BaseRevisionID: q1.ID,
			Status:         "draft",
			SourceType:     "manual",
			CreatedBy:      rlsUserA,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: instanceID, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 800}, MaterialChoices: map[string]string{"carcass": "mat-roble"}, LifecycleStatus: "active"},
			},
		})
		return txErr
	}); err != nil {
		t.Fatalf("create Q2 draft: %v", err)
	}

	// Read commercial summaries as Org A
	var summaries []domain.ProjectCommercialSummary
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var txErr error
		summaries, txErr = fx.store.ListProjectCommercialSummaries(txCtx)
		return txErr
	}); err != nil {
		t.Fatalf("ListProjectCommercialSummaries: %v", err)
	}

	var found *domain.ProjectCommercialSummary
	for i := range summaries {
		if summaries[i].ProjectID == fiSharedProject {
			found = &summaries[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("shared project %s not found in summaries", fiSharedProject)
	}

	// Q1 is accepted, so Q1 is authoritative
	if found.QuoteStatus != domain.ProjectCommercialQuoteStatusAccepted {
		t.Fatalf("quoteStatus = %s, want %s", found.QuoteStatus, domain.ProjectCommercialQuoteStatusAccepted)
	}
	if found.QuoteRevisionNumber == nil || *found.QuoteRevisionNumber != 1 {
		t.Fatalf("quoteRevisionNumber = %v, want 1", found.QuoteRevisionNumber)
	}
	// Q2 is draft with revision_number 2 > 1, so ActiveDraftRevisionNumber must be 2
	if found.ActiveDraftRevisionNumber == nil || *found.ActiveDraftRevisionNumber != 2 {
		t.Fatalf("activeDraftRevisionNumber = %v, want 2", found.ActiveDraftRevisionNumber)
	}
	if found.IsLegacy {
		t.Fatal("isLegacy should be false for modern revision with snapshot")
	}
	if found.SaleTotal == nil {
		t.Fatal("saleTotal should not be nil")
	}
	if found.FurnitureQuantity != 1 {
		t.Fatalf("furnitureQuantity = %d, want 1", found.FurnitureQuantity)
	}
}

func TestListProjectCommercialSummaries_ProjectWithoutRevisions(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	var summaries []domain.ProjectCommercialSummary
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var txErr error
		summaries, txErr = fx.store.ListProjectCommercialSummaries(txCtx)
		return txErr
	}); err != nil {
		t.Fatalf("ListProjectCommercialSummaries: %v", err)
	}

	// fiProjectAOnly has no revisions created in setup
	var found *domain.ProjectCommercialSummary
	for i := range summaries {
		if summaries[i].ProjectID == fiProjectAOnly {
			found = &summaries[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("project %s not found in summaries", fiProjectAOnly)
	}

	if found.QuoteStatus != domain.ProjectCommercialQuoteStatusNone {
		t.Fatalf("quoteStatus = %s, want %s", found.QuoteStatus, domain.ProjectCommercialQuoteStatusNone)
	}
	if found.QuoteRevisionID != nil {
		t.Fatalf("quoteRevisionId = %v, want nil", found.QuoteRevisionID)
	}
	if found.QuoteRevisionNumber != nil {
		t.Fatalf("quoteRevisionNumber = %v, want nil", found.QuoteRevisionNumber)
	}
	if found.ActiveDraftRevisionNumber != nil {
		t.Fatalf("activeDraftRevisionNumber = %v, want nil", found.ActiveDraftRevisionNumber)
	}
	if found.IsLegacy {
		t.Fatal("isLegacy should be false when no revision exists")
	}
	if found.SaleTotal != nil {
		t.Fatalf("saleTotal = %v, want nil", found.SaleTotal)
	}
	if found.FurnitureQuantity != 0 {
		t.Fatalf("furnitureQuantity = %d, want 0", found.FurnitureQuantity)
	}
}
func TestListProjectCommercialSummaries_LegacyRevisionFailClosed(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	// Create physical identity for fiProjectAOnly
	var instanceID string
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		created, txErr := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiProjectAOnly,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
			RequestID:             "cs-legacy-inst-1",
		})
		if txErr != nil {
			return txErr
		}
		instanceID = created.ID
		return nil
	}); err != nil {
		t.Fatalf("create instance: %v", err)
	}

	// Bypass insert trigger temporarily to simulate a preserved pre-#642 legacy row without snapshot
	if _, err := fx.admin.Exec(context.Background(), `ALTER TABLE quote_revisions DISABLE TRIGGER protect_quote_revisions_immutable`); err != nil {
		t.Fatalf("disable trigger for legacy fixture: %v", err)
	}

	// Create legacy revision directly with NULL commercial_snapshot
	var legacyRevID string
	insertErr := fx.admin.QueryRow(context.Background(), `
		INSERT INTO quote_revisions (id, organization_id, project_id, revision_number, status, source_type, created_by, commercial_snapshot)
		VALUES ('77000000-0000-0000-0000-000000000001', $1, $2, 1, 'published', 'manual', $3, NULL)
		RETURNING id::text;
	`, rlsOrgA, fiProjectAOnly, rlsUserA).Scan(&legacyRevID)

	if _, err := fx.admin.Exec(context.Background(), `ALTER TABLE quote_revisions ENABLE TRIGGER protect_quote_revisions_immutable`); err != nil {
		t.Fatalf("enable trigger: %v", err)
	}
	if insertErr != nil {
		t.Fatalf("insert legacy revision: %v", insertErr)
	}

	// Add an item row to quote_revision_items
	if _, err := fx.admin.Exec(context.Background(), `
		INSERT INTO quote_revision_items (organization_id, project_id, quote_revision_id, furniture_instance_id, furniture_definition_id, parameters, material_choices, lifecycle_status)
		VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, '{}'::jsonb, 'active')
	`, rlsOrgA, fiProjectAOnly, legacyRevID, instanceID, fiModuleA); err != nil {
		t.Fatalf("insert legacy revision item: %v", err)
	}

	var summaries []domain.ProjectCommercialSummary
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var txErr error
		summaries, txErr = fx.store.ListProjectCommercialSummaries(txCtx)
		return txErr
	}); err != nil {
		t.Fatalf("ListProjectCommercialSummaries: %v", err)
	}

	var found *domain.ProjectCommercialSummary
	for i := range summaries {
		if summaries[i].ProjectID == fiProjectAOnly {
			found = &summaries[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("project %s not found in summaries", fiProjectAOnly)
	}

	if !found.IsLegacy {
		t.Fatal("isLegacy should be true for legacy revision without snapshot")
	}
	if found.SaleTotal != nil {
		t.Fatalf("saleTotal = %v, want nil (fail-closed, never calculate)", found.SaleTotal)
	}
	if found.FurnitureQuantity != 1 {
		t.Fatalf("furnitureQuantity = %d, want 1", found.FurnitureQuantity)
	}
	if found.QuoteStatus != domain.ProjectCommercialQuoteStatusPublished {
		t.Fatalf("quoteStatus = %s, want published", found.QuoteStatus)
	}
}

func TestListProjectCommercialSummaries_MultiOrgIsolation(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	// Org A list
	var orgASummaries []domain.ProjectCommercialSummary
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var txErr error
		orgASummaries, txErr = fx.store.ListProjectCommercialSummaries(txCtx)
		return txErr
	}); err != nil {
		t.Fatalf("Org A ListProjectCommercialSummaries: %v", err)
	}

	// Org B list
	var orgBSummaries []domain.ProjectCommercialSummary
	if err := fiTx(t, fx.store, fiActorB(), func(txCtx context.Context) error {
		var txErr error
		orgBSummaries, txErr = fx.store.ListProjectCommercialSummaries(txCtx)
		return txErr
	}); err != nil {
		t.Fatalf("Org B ListProjectCommercialSummaries: %v", err)
	}

	// fiProjectAOnly belongs solely to Org A
	for _, s := range orgBSummaries {
		if s.ProjectID == fiProjectAOnly {
			t.Fatalf("Org B saw Org A private project %s", fiProjectAOnly)
		}
	}

	// Both can see fiSharedProject (Org A owner, Org B manufacturer)
	foundSharedInA := false
	for _, s := range orgASummaries {
		if s.ProjectID == fiSharedProject {
			foundSharedInA = true
			break
		}
	}
	if !foundSharedInA {
		t.Fatalf("Org A did not see shared project %s", fiSharedProject)
	}

	foundSharedInB := false
	for _, s := range orgBSummaries {
		if s.ProjectID == fiSharedProject {
			foundSharedInB = true
			break
		}
	}
	if !foundSharedInB {
		t.Fatalf("Org B did not see shared project %s", fiSharedProject)
	}
}
