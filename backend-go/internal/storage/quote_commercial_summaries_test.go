package storage_test

import (
	"context"
	"errors"
	"testing"
	"time"

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

// findSummary is the test-local lookup of one project's summary in the batch.
func findSummary(t *testing.T, summaries []domain.ProjectCommercialSummary, projectID string) *domain.ProjectCommercialSummary {
	t.Helper()
	for i := range summaries {
		if summaries[i].ProjectID == projectID {
			return &summaries[i]
		}
	}
	t.Fatalf("project %s not found in summaries", projectID)
	return nil
}

// listSummaries runs the batch read model under one tenant transaction.
func listSummaries(t *testing.T, fx *rlsFixture, actor storage.TenantActor) []domain.ProjectCommercialSummary {
	t.Helper()
	var summaries []domain.ProjectCommercialSummary
	err := fiTx(t, fx.store, actor, func(txCtx context.Context) error {
		var txErr error
		summaries, txErr = fx.store.ListProjectCommercialSummaries(txCtx)
		return txErr
	})
	if err != nil {
		t.Fatalf("ListProjectCommercialSummaries: %v", err)
	}
	return summaries
}

// 2A BLOCKER 2: a valid snapshot v1 owns the commercial identity. Mutable
// Project/customer rows mutated AFTER the revision never re-label history.
func TestListProjectCommercialSummaries_FrozenIdentityFromSnapshot(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	var instanceID string
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		created, txErr := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
			RequestID:             "cs-identity-inst-1",
		})
		if txErr != nil {
			return txErr
		}
		instanceID = created.ID
		_, txErr = createFixtureQuoteRevision(txCtx, fx.store, storage.CreateQuoteRevisionCommand{
			OrganizationID: rlsOrgA,
			ProjectID:      fiSharedProject,
			Status:         "accepted",
			SourceType:     "manual",
			CreatedBy:      rlsUserA,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: instanceID, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600}, MaterialChoices: map[string]string{"carcass": "mat-blanco"}, LifecycleStatus: "active"},
			},
		})
		return txErr
	}); err != nil {
		t.Fatalf("create accepted Q1: %v", err)
	}

	// Deliberately mutate the mutable identity after the revision froze.
	if _, err := fx.admin.Exec(context.Background(),
		`UPDATE projects SET name = 'Proyecto MUTADO', currency = 'ARS' WHERE id = $1`, fiSharedProject); err != nil {
		t.Fatalf("mutate project: %v", err)
	}
	if _, err := fx.admin.Exec(context.Background(),
		`UPDATE customers SET name = 'Cliente MUTADO' WHERE id = '30000000-0000-0000-0000-00000000000a'`); err != nil {
		t.Fatalf("mutate customer: %v", err)
	}

	found := findSummary(t, listSummaries(t, fx, fiActorA()), fiSharedProject)
	if found.ProjectName != "Fixture project" {
		t.Fatalf("projectName = %q, want frozen snapshot identity", found.ProjectName)
	}
	if found.CustomerID == nil || *found.CustomerID != fiSharedProject {
		t.Fatalf("customerId = %v, want frozen snapshot customer identity", found.CustomerID)
	}
	if found.CustomerName == nil || *found.CustomerName != "Fixture customer" {
		t.Fatalf("customerName = %v, want frozen snapshot customer identity", found.CustomerName)
	}
	if found.Currency != "MXN" {
		t.Fatalf("currency = %q, want frozen snapshot currency MXN", found.Currency)
	}
	if found.SaleTotal == nil {
		t.Fatal("saleTotal should stay visible for the owner organization")
	}
}

// 2A BLOCKER 3 / §11: a valid snapshot whose line quantity dropped to 0 (all
// units removed) answers furnitureQuantity = 0. Terminal units stay history;
// they never revive active demand — and no unit/item-count fallback exists.
func TestListProjectCommercialSummaries_TerminalUnitsAreNotDemand(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	var instanceID string
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		created, txErr := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiProjectAOnly,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
			RequestID:             "cs-terminal-inst-1",
		})
		if txErr != nil {
			return txErr
		}
		instanceID = created.ID
		_, txErr = createFixtureQuoteRevision(txCtx, fx.store, storage.CreateQuoteRevisionCommand{
			OrganizationID: rlsOrgA,
			ProjectID:      fiProjectAOnly,
			Status:         "published",
			SourceType:     "manual",
			CreatedBy:      rlsUserA,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: instanceID, FurnitureDefinitionID: fiModuleA, LifecycleStatus: "removed"},
			},
		})
		return txErr
	}); err != nil {
		t.Fatalf("create published Q1 with removed unit: %v", err)
	}

	found := findSummary(t, listSummaries(t, fx, fiActorA()), fiProjectAOnly)
	if found.IsLegacy {
		t.Fatal("snapshot revision is modern, not legacy")
	}
	if found.FurnitureQuantity != 0 {
		t.Fatalf("furnitureQuantity = %d, want 0 (removed unit is not demand)", found.FurnitureQuantity)
	}
}

// 2A BLOCKER 4: commercialActivityAt is a REAL revision lifecycle event, or
// explicitly absent when the project has no revision. Project.updated_at never
// substitutes commercial activity.
func TestListProjectCommercialSummaries_CommercialActivityAtIsARealEvent(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	found := findSummary(t, listSummaries(t, fx, fiActorA()), fiProjectAOnly)
	if found.QuoteStatus != domain.ProjectCommercialQuoteStatusNone {
		t.Fatalf("quoteStatus = %s, want none", found.QuoteStatus)
	}
	if found.CommercialActivityAt != nil {
		t.Fatalf("commercialActivityAt = %v, want nil without revisions", *found.CommercialActivityAt)
	}

	var q1 *domain.QuoteRevision
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		created, txErr := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiProjectAOnly,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
			RequestID:             "cs-activity-inst-1",
		})
		if txErr != nil {
			return txErr
		}
		q1, txErr = createFixtureQuoteRevision(txCtx, fx.store, storage.CreateQuoteRevisionCommand{
			OrganizationID: rlsOrgA,
			ProjectID:      fiProjectAOnly,
			Status:         "published",
			SourceType:     "manual",
			CreatedBy:      rlsUserA,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: created.ID, FurnitureDefinitionID: fiModuleA, LifecycleStatus: "active"},
			},
		})
		return txErr
	}); err != nil {
		t.Fatalf("create published Q1: %v", err)
	}

	found = findSummary(t, listSummaries(t, fx, fiActorA()), fiProjectAOnly)
	if q1.PublishedAt == nil {
		t.Fatal("fixture published revision must carry published_at")
	}
	want := q1.PublishedAt.UTC().Format(time.RFC3339)
	if found.CommercialActivityAt == nil || *found.CommercialActivityAt != want {
		t.Fatalf("commercialActivityAt = %v, want published_at %s", found.CommercialActivityAt, want)
	}
}

// 2A: accepted wins over history, and the superseded status stays reachable —
// both when an accept supersedes a previous accepted revision and when a
// published revision transitions straight to superseded without replacement.
func TestListProjectCommercialSummaries_SupersededSelection(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	// Case 1: Q1 accepted → Q2 accepted supersedes Q1; authority is Q2.
	var instanceID string
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		created, txErr := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
			RequestID:             "cs-supersede-inst-1",
		})
		if txErr != nil {
			return txErr
		}
		instanceID = created.ID
		items := []storage.CreateQuoteRevisionItemCommand{
			{FurnitureInstanceID: instanceID, FurnitureDefinitionID: fiModuleA, LifecycleStatus: "active"},
		}
		q1, txErr := createFixtureQuoteRevision(txCtx, fx.store, storage.CreateQuoteRevisionCommand{
			OrganizationID: rlsOrgA, ProjectID: fiSharedProject, Status: "accepted",
			SourceType: "manual", CreatedBy: rlsUserA, Items: items,
		})
		if txErr != nil {
			return txErr
		}
		_, txErr = createFixtureQuoteRevision(txCtx, fx.store, storage.CreateQuoteRevisionCommand{
			OrganizationID: rlsOrgA, ProjectID: fiSharedProject, BaseRevisionID: q1.ID, Status: "accepted",
			SourceType: "manual", CreatedBy: rlsUserA, Items: items,
		})
		return txErr
	}); err != nil {
		t.Fatalf("create accepted Q1+Q2: %v", err)
	}

	found := findSummary(t, listSummaries(t, fx, fiActorA()), fiSharedProject)
	if found.QuoteStatus != domain.ProjectCommercialQuoteStatusAccepted || found.QuoteRevisionNumber == nil || *found.QuoteRevisionNumber != 2 {
		t.Fatalf("quoteStatus/number = %s/%v, want accepted Q2", found.QuoteStatus, found.QuoteRevisionNumber)
	}

	// Case 2: published → superseded is a legal terminal transition; with no
	// accepted revision the newest exact revision is honestly superseded.
	var q1 *domain.QuoteRevision
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		created, txErr := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiProjectAOnly,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
			RequestID:             "cs-supersede-inst-2",
		})
		if txErr != nil {
			return txErr
		}
		q1, txErr = createFixtureQuoteRevision(txCtx, fx.store, storage.CreateQuoteRevisionCommand{
			OrganizationID: rlsOrgA, ProjectID: fiProjectAOnly, Status: "published",
			SourceType: "manual", CreatedBy: rlsUserA,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: created.ID, FurnitureDefinitionID: fiModuleA, LifecycleStatus: "active"},
			},
		})
		return txErr
	}); err != nil {
		t.Fatalf("create published Q1: %v", err)
	}
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		_, txErr := fx.store.UpdateQuoteRevisionStatus(txCtx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: q1.ID,
			Status:          "superseded",
		})
		return txErr
	}); err != nil {
		t.Fatalf("transition published → superseded: %v", err)
	}

	found = findSummary(t, listSummaries(t, fx, fiActorA()), fiProjectAOnly)
	if found.QuoteStatus != domain.ProjectCommercialQuoteStatusSuperseded {
		t.Fatalf("quoteStatus = %s, want superseded (newest exact without accepted)", found.QuoteStatus)
	}
}

// 2A: a corrupt snapshot in one project fails the whole batch closed (409 at
// the API edge) instead of guessing or silently dropping the project.
func TestListProjectCommercialSummaries_CorruptSnapshotFailsClosed(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	if _, err := fx.admin.Exec(context.Background(), `ALTER TABLE quote_revisions DISABLE TRIGGER protect_quote_revisions_immutable`); err != nil {
		t.Fatalf("disable trigger for corrupt fixture: %v", err)
	}
	_, insertErr := fx.admin.Exec(context.Background(), `
		INSERT INTO quote_revisions (id, organization_id, project_id, revision_number, status, source_type, created_by, commercial_snapshot)
		VALUES ('77000000-0000-0000-0000-00000000000a', $1, $2, 1, 'published', 'manual', $3, '{"schema":"granete.unknown"}'::jsonb)
	`, rlsOrgA, fiProjectAOnly, rlsUserA)
	if _, err := fx.admin.Exec(context.Background(), `ALTER TABLE quote_revisions ENABLE TRIGGER protect_quote_revisions_immutable`); err != nil {
		t.Fatalf("enable trigger: %v", err)
	}
	if insertErr != nil {
		t.Fatalf("insert corrupt revision: %v", insertErr)
	}

	err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		_, txErr := fx.store.ListProjectCommercialSummaries(txCtx)
		return txErr
	})
	if err == nil {
		t.Fatal("corrupt snapshot must fail the batch, got nil error")
	}
	if !errors.Is(err, domain.ErrInvalidRevisionSnapshot) {
		t.Fatalf("error = %v, want ErrInvalidRevisionSnapshot", err)
	}
}

// 2A BLOCKER 6: the manufacturing organization can access the shared project
// summary, but the retail sale total is fail-closed for it (multi-org
// distribution model §14: retail price "not by default" for the factory).
// The owner organization keeps seeing the amount.
func TestListProjectCommercialSummaries_SaleTotalCrossOrgFailClosed(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	var instanceID string
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		created, txErr := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
			RequestID:             "cs-crossorg-inst-1",
		})
		if txErr != nil {
			return txErr
		}
		instanceID = created.ID
		_, txErr = createFixtureQuoteRevision(txCtx, fx.store, storage.CreateQuoteRevisionCommand{
			OrganizationID: rlsOrgA,
			ProjectID:      fiSharedProject,
			Status:         "accepted",
			SourceType:     "manual",
			CreatedBy:      rlsUserA,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: instanceID, FurnitureDefinitionID: fiModuleA, LifecycleStatus: "active"},
			},
		})
		return txErr
	}); err != nil {
		t.Fatalf("create accepted Q1: %v", err)
	}

	owner := findSummary(t, listSummaries(t, fx, fiActorA()), fiSharedProject)
	if owner.SaleTotal == nil {
		t.Fatal("owner organization must see the retail sale total")
	}
	manufacturer := findSummary(t, listSummaries(t, fx, fiActorB()), fiSharedProject)
	if manufacturer.SaleTotal != nil {
		t.Fatalf("manufacturing-only organization saleTotal = %v, want nil (fail-closed)", *manufacturer.SaleTotal)
	}
	if manufacturer.QuoteStatus != domain.ProjectCommercialQuoteStatusAccepted {
		t.Fatalf("manufacturing-only organization quoteStatus = %s, want accepted (summary stays visible)", manufacturer.QuoteStatus)
	}
}

// 2A negative proof (#27): accepting a QuoteRevision through the exact
// lifecycle command does NOT write Project.status='accepted'. The commercial
// authority lives in QuoteRevision.status; Project.status stays operational.
func TestAcceptQuoteRevision_DoesNotWriteProjectStatus(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	var instanceID string
	var q1 *domain.QuoteRevision
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		created, txErr := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiProjectAOnly,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           rlsUserA,
			RequestID:             "cs-negproof-inst-1",
		})
		if txErr != nil {
			return txErr
		}
		instanceID = created.ID
		q1, txErr = createFixtureQuoteRevision(txCtx, fx.store, storage.CreateQuoteRevisionCommand{
			OrganizationID: rlsOrgA,
			ProjectID:      fiProjectAOnly,
			Status:         "published",
			SourceType:     "manual",
			CreatedBy:      rlsUserA,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: instanceID, FurnitureDefinitionID: fiModuleA, LifecycleStatus: "active"},
			},
		})
		return txErr
	}); err != nil {
		t.Fatalf("create published Q1: %v", err)
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

	var projectStatus string
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT status FROM projects WHERE id = $1`, fiProjectAOnly).Scan(&projectStatus); err != nil {
		t.Fatalf("read project status: %v", err)
	}
	if projectStatus != "draft" {
		t.Fatalf("project status = %q after accept, want draft (no second truth written)", projectStatus)
	}

	found := findSummary(t, listSummaries(t, fx, fiActorA()), fiProjectAOnly)
	if found.QuoteStatus != domain.ProjectCommercialQuoteStatusAccepted {
		t.Fatalf("quoteStatus = %s after accept, want accepted", found.QuoteStatus)
	}
}
