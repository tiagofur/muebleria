package storage_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #500 / WEB-DT-1: ListQuoteRevisionsByProject against real PostgreSQL under
// the app role.
//
// Key contracts verified:
// - The read model returns every immutable revision with its per-unit items
//   ordered deterministically (revision number, then furniture instance id);
// - Commercial presence derives strictly from the stored snapshot
//   (parameters/material choices/lifecycle survive the round-trip);
// - Shared read follows the project organizations (manufacturing org B may
//   read org A's project revisions), while unrelated org C and org A reading
//   org B's private project answer the uniform ErrQuoteRevisionNotFound;
// - Corrupt snapshot JSON fails closed (ErrInvalidRevisionSnapshot), never a
//   guessed decode;
// - A visible project without revisions returns an empty list, not an error.

func TestListQuoteRevisionsByProject_ContextReadModel(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	// Two physical identities on the shared project (owner org A). Identity is
	// server-minted (#385), so the snapshot items below reuse the minted ids.
	minted := []string{}
	for i := 0; i < 2; i++ {
		err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
			created, txErr := fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
				ProjectID:             fiSharedProject,
				FurnitureDefinitionID: fiModuleA,
				Origin:                domain.FurnitureInstanceOriginQuote,
				ActorUserID:           rlsUserA,
				RequestID:             "qr-list-" + string(rune('a'+i)),
			})
			if txErr != nil {
				return txErr
			}
			minted = append(minted, created.ID)
			return nil
		})
		if err != nil {
			t.Fatalf("create instance %d: %v", i, err)
		}
	}
	if len(minted) != 2 {
		t.Fatalf("minted identities = %d, want 2", len(minted))
	}

	// R1: published then accepted snapshot of both units.
	var revisionOne *domain.QuoteRevision
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var txErr error
		revisionOne, txErr = createFixtureQuoteRevision(txCtx, fx.store, storage.CreateQuoteRevisionCommand{
			OrganizationID: rlsOrgA,
			ProjectID:      fiSharedProject,
			Status:         "published",
			SourceType:     "manual",
			CreatedBy:      rlsUserA,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: minted[0], FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600}, MaterialChoices: map[string]string{"carcass": "mat-blanco"}, LifecycleStatus: "active"},
				{FurnitureInstanceID: minted[1], FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 800}, MaterialChoices: map[string]string{"carcass": "mat-roble"}, LifecycleStatus: "active"},
			},
		})
		return txErr
	}); err != nil {
		t.Fatalf("create revision one: %v", err)
	}
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		_, txErr := fx.store.UpdateQuoteRevisionStatus(txCtx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: revisionOne.ID,
			Status:          "accepted",
		})
		return txErr
	}); err != nil {
		t.Fatalf("accept revision one: %v", err)
	}

	// R2: draft based on R1 with one unit already cancelled. (A "requote"
	// source would additionally require the exact sourceDesignRevisionId —
	// provenance that the #394 writer enforces fail-closed.)
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		_, txErr := createFixtureQuoteRevision(txCtx, fx.store, storage.CreateQuoteRevisionCommand{
			OrganizationID: rlsOrgA,
			ProjectID:      fiSharedProject,
			BaseRevisionID: revisionOne.ID,
			Status:         "draft",
			SourceType:     "manual",
			CreatedBy:      rlsUserA,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: minted[0], FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600}, MaterialChoices: map[string]string{"carcass": "mat-blanco"}, LifecycleStatus: "active"},
				{FurnitureInstanceID: minted[1], FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 800}, MaterialChoices: map[string]string{"carcass": "mat-roble"}, LifecycleStatus: "cancelled"},
			},
		})
		return txErr
	}); err != nil {
		t.Fatalf("create revision two: %v", err)
	}

	list := func(actor storage.TenantActor, projectID string) ([]domain.QuoteRevisionDetail, error) {
		var details []domain.QuoteRevisionDetail
		err := fiTx(t, fx.store, actor, func(txCtx context.Context) error {
			var txErr error
			details, txErr = fx.store.ListQuoteRevisionsByProject(txCtx, projectID)
			return txErr
		})
		return details, err
	}

	// Owner organization reads both revisions with their items.
	details, err := list(fiActorA(), fiSharedProject)
	if err != nil {
		t.Fatalf("owner list: %v", err)
	}
	if len(details) != 2 {
		t.Fatalf("revisions = %d, want 2", len(details))
	}
	if details[0].RevisionNumber != 1 || details[1].RevisionNumber != 2 {
		t.Fatalf("revision order = [%d, %d], want ascending [1, 2]", details[0].RevisionNumber, details[1].RevisionNumber)
	}
	if details[0].Status != "accepted" || details[1].Status != "draft" {
		t.Fatalf("statuses = [%s, %s], want [accepted, draft]", details[0].Status, details[1].Status)
	}
	if details[1].BaseQuoteRevisionID != revisionOne.ID {
		t.Fatalf("requote provenance lost: %+v", details[1].QuoteRevision)
	}
	if details[0].CreatedAt.IsZero() {
		t.Fatal("createdAt must be exposed for the exact-context selector")
	}
	for _, revision := range details {
		if len(revision.Items) != 2 {
			t.Fatalf("revision %d items = %d, want 2", revision.RevisionNumber, len(revision.Items))
		}
		// Deterministic per-unit order (furniture instance id).
		if revision.Items[0].FurnitureInstanceID > revision.Items[1].FurnitureInstanceID {
			t.Fatalf("items not deterministically ordered: %s > %s", revision.Items[0].FurnitureInstanceID, revision.Items[1].FurnitureInstanceID)
		}
		for _, item := range revision.Items {
			if item.FurnitureDefinitionID != fiModuleA {
				t.Fatalf("item definition provenance lost: %+v", item)
			}
			if item.MaterialChoices["carcass"] == "" {
				t.Fatalf("item material snapshot lost: %+v", item)
			}
		}
	}
	// Terminal lifecycle inside a snapshot stays historical, never rewritten.
	cancelledSeen := false
	for _, item := range details[1].Items {
		if item.LifecycleStatus == "cancelled" {
			cancelledSeen = true
		}
	}
	if !cancelledSeen {
		t.Fatalf("R2 must carry the cancelled unit snapshot verbatim: %+v", details[1].Items)
	}

	// Manufacturing organization B shares the read of the project revisions.
	if _, err := list(fiActorB(), fiSharedProject); err != nil {
		t.Fatalf("manufacturing org shared read: %v", err)
	}

	// Unrelated organization C gets the uniform 404 (no existence oracle).
	if _, err := list(storage.TenantActor{OrganizationID: rlsOrgC, UserID: rlsUserA}, fiSharedProject); !errors.Is(err, domain.ErrQuoteRevisionNotFound) {
		t.Fatalf("unrelated org error = %v, want ErrQuoteRevisionNotFound", err)
	}

	// Org A cannot read org B's private project.
	if _, err := list(fiActorA(), fiProjectB); !errors.Is(err, domain.ErrQuoteRevisionNotFound) {
		t.Fatalf("cross-tenant error = %v, want ErrQuoteRevisionNotFound", err)
	}

	// Unknown project ids are rejected before any query.
	if _, err := list(fiActorA(), "42000000-0000-0000-0000-00000000dead"); !errors.Is(err, domain.ErrQuoteRevisionNotFound) {
		t.Fatalf("unknown project error = %v, want ErrQuoteRevisionNotFound", err)
	}

	// A visible project without revisions returns an empty list, not 404.
	empty, err := list(fiActorA(), fiProjectAOnly)
	if err != nil {
		t.Fatalf("empty project list: %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("empty project revisions = %d, want 0", len(empty))
	}
}

func TestListQuoteRevisionsByProject_FailsClosedOnCorruptSnapshot(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	ctx := context.Background()

	var instance *domain.FurnitureInstance
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var txErr error
		instance, txErr = fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:   fiSharedProject,
			Origin:      domain.FurnitureInstanceOriginManual,
			ActorUserID: rlsUserA,
			RequestID:   "qr-corrupt-instance",
		})
		return txErr
	}); err != nil {
		t.Fatalf("create instance: %v", err)
	}

	item := storage.CreateQuoteRevisionItemCommand{
		FurnitureInstanceID: instance.ID,
		QuoteLineID:         "3c100000-0000-0000-0000-000000000001",
		LifecycleStatus:     "active",
	}
	snapshotJSON, err := json.Marshal(fixtureCommercialSnapshot(fiSharedProject, []storage.CreateQuoteRevisionItemCommand{item}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO quote_revisions (id, organization_id, project_id, revision_number, status, source_type, commercial_snapshot)
		VALUES ('3c000000-0000-0000-0000-000000000001', $1, $2, 1, 'draft', 'manual', $3::jsonb)
	`, rlsOrgA, fiSharedProject, snapshotJSON); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO quote_revision_items (organization_id, project_id, quote_revision_id, furniture_instance_id, parameters, material_choices, lifecycle_status)
		VALUES ('`+rlsOrgA+`', '`+fiSharedProject+`', '3c000000-0000-0000-0000-000000000001', '`+instance.ID+`',
			'"corrupt-not-an-object"'::jsonb, '{}'::jsonb, 'active')
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, `
		UPDATE quote_revisions SET status='published', published_at=NOW()
		WHERE id='3c000000-0000-0000-0000-000000000001'
	`); err != nil {
		t.Fatal(err)
	}

	var readErr error
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		_, readErr = fx.store.ListQuoteRevisionsByProject(txCtx, fiSharedProject)
		return readErr
	}); err == nil {
		t.Fatal("corrupt snapshot JSON must fail closed")
	} else if !errors.Is(readErr, domain.ErrInvalidRevisionSnapshot) && !strings.Contains(err.Error(), "invalid revision snapshot") {
		t.Fatalf("error = %v, want ErrInvalidRevisionSnapshot", err)
	}
}
