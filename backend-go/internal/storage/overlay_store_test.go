package storage_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #775 [P1][LIB-4]: Storage layer & Multi-tenant RLS isolation tests for
// organization manufacturing-library overlays and 3-way rebase conflict records.

func TestOverlayStore_CreateAndGetOverlay(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	adminStore := &storage.PostgresStore{Pool: fx.admin}

	orgA := uuid.MustParse(rlsOrgA)
	standardLibID := uuid.MustParse(domain.GraneteStandardLibraryID)
	standardDraftID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)

	customRes1 := uuid.New()
	customRes2 := uuid.New()

	overlay := &domain.LibraryOverlay{
		OrganizationID:    orgA,
		LibraryID:         standardLibID,
		BaseReleaseID:     standardDraftID,
		Status:            "active",
		Overrides:         json.RawMessage(`{"parameters.panelThickness": 19, "joint.depth": 14}`),
		CustomResourceIDs: []uuid.UUID{customRes1, customRes2},
	}

	created, err := adminStore.CreateOverlay(ctx, overlay)
	if err != nil {
		t.Fatalf("CreateOverlay failed: %v", err)
	}

	if created.ID == uuid.Nil {
		t.Fatal("expected non-nil created overlay ID")
	}
	if created.OrganizationID != orgA {
		t.Fatalf("expected org %s, got %s", orgA, created.OrganizationID)
	}
	if created.LibraryID != standardLibID {
		t.Fatalf("expected lib %s, got %s", standardLibID, created.LibraryID)
	}
	if created.BaseReleaseID != standardDraftID {
		t.Fatalf("expected base release %s, got %s", standardDraftID, created.BaseReleaseID)
	}
	if created.Status != "active" {
		t.Fatalf("expected status 'active', got %s", created.Status)
	}
	if len(created.CustomResourceIDs) != 2 {
		t.Fatalf("expected 2 custom resources, got %d", len(created.CustomResourceIDs))
	}

	// Fetch by ID
	fetched, err := adminStore.GetOverlayByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetOverlayByID failed: %v", err)
	}
	if fetched.ID != created.ID {
		t.Fatalf("expected ID %s, got %s", created.ID, fetched.ID)
	}

	// Fetch active overlay by library
	active, err := adminStore.GetActiveOverlayByLibrary(ctx, orgA, standardLibID)
	if err != nil {
		t.Fatalf("GetActiveOverlayByLibrary failed: %v", err)
	}
	if active.ID != created.ID {
		t.Fatalf("expected active overlay ID %s, got %s", created.ID, active.ID)
	}
}

func TestOverlayStore_UpdateOverridesAndBaseRelease(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	adminStore := &storage.PostgresStore{Pool: fx.admin}

	orgA := uuid.MustParse(rlsOrgA)
	standardLibID := uuid.MustParse(domain.GraneteStandardLibraryID)
	standardDraftID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)

	overlay, err := adminStore.CreateOverlay(ctx, &domain.LibraryOverlay{
		OrganizationID: orgA,
		LibraryID:      standardLibID,
		BaseReleaseID:  standardDraftID,
		Status:         "active",
		Overrides:      json.RawMessage(`{"parameters.toeKickHeight": 120}`),
	})
	if err != nil {
		t.Fatalf("CreateOverlay failed: %v", err)
	}

	// Update overrides and custom resources
	newRes := uuid.New()
	newOverrides := json.RawMessage(`{"parameters.toeKickHeight": 150}`)
	err = adminStore.UpdateOverlayOverrides(ctx, overlay.ID, newOverrides, []uuid.UUID{newRes})
	if err != nil {
		t.Fatalf("UpdateOverlayOverrides failed: %v", err)
	}

	fetched, err := adminStore.GetOverlayByID(ctx, overlay.ID)
	if err != nil {
		t.Fatalf("GetOverlayByID failed: %v", err)
	}
	if string(fetched.Overrides) != string(newOverrides) {
		t.Fatalf("expected updated overrides %s, got %s", newOverrides, fetched.Overrides)
	}
	if len(fetched.CustomResourceIDs) != 1 || fetched.CustomResourceIDs[0] != newRes {
		t.Fatalf("expected custom resources [%s], got %v", newRes, fetched.CustomResourceIDs)
	}

	// Update base release and status
	err = adminStore.UpdateOverlayBaseRelease(ctx, overlay.ID, standardDraftID, newOverrides, "rebase_conflict")
	if err != nil {
		t.Fatalf("UpdateOverlayBaseRelease failed: %v", err)
	}

	fetched, err = adminStore.GetOverlayByID(ctx, overlay.ID)
	if err != nil {
		t.Fatalf("GetOverlayByID failed: %v", err)
	}
	if fetched.Status != "rebase_conflict" {
		t.Fatalf("expected status 'rebase_conflict', got %s", fetched.Status)
	}
}

func TestOverlayStore_MultiTenantRLS_DirectSQL_Isolation(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	adminStore := &storage.PostgresStore{Pool: fx.admin}

	orgA := uuid.MustParse(rlsOrgA)
	orgB := uuid.MustParse(rlsOrgB)
	standardLibID := uuid.MustParse(domain.GraneteStandardLibraryID)
	standardDraftID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)

	// Create overlay for Org A via admin store
	overlayA, err := adminStore.CreateOverlay(ctx, &domain.LibraryOverlay{
		OrganizationID: orgA,
		LibraryID:      standardLibID,
		BaseReleaseID:  standardDraftID,
		Status:         "active",
		Overrides:      json.RawMessage(`{"parameters.panelThickness": 19}`),
	})
	if err != nil {
		t.Fatalf("create Org A overlay: %v", err)
	}

	// 1. Org B under granete_app role attempting to SELECT Org A's overlay -> 0 rows
	withRLSActor(t, fx.app, rlsOrgB, rlsUserB, func(tx pgx.Tx) {
		var count int
		err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM library_overlays WHERE id = $1`, overlayA.ID).Scan(&count)
		if err != nil {
			t.Fatalf("query overlay as Org B: %v", err)
		}
		if count != 0 {
			t.Fatalf("RLS breach: Org B saw Org A's overlay (%d rows)", count)
		}

		// Attempting to UPDATE Org A's overlay -> 0 rows affected
		tag, err := tx.Exec(ctx, `UPDATE library_overlays SET status = 'archived' WHERE id = $1`, overlayA.ID)
		if err != nil {
			t.Fatalf("update overlay as Org B: %v", err)
		}
		if tag.RowsAffected() != 0 {
			t.Fatalf("RLS breach: Org B updated Org A's overlay (%d rows affected)", tag.RowsAffected())
		}

		// Attempting to DELETE Org A's overlay -> 0 rows affected
		tag, err = tx.Exec(ctx, `DELETE FROM library_overlays WHERE id = $1`, overlayA.ID)
		if err != nil {
			t.Fatalf("delete overlay as Org B: %v", err)
		}
		if tag.RowsAffected() != 0 {
			t.Fatalf("RLS breach: Org B deleted Org A's overlay (%d rows affected)", tag.RowsAffected())
		}

		// Attempting to INSERT an overlay with Org A's ID while acting as Org B -> RLS WITH CHECK error
		_, err = tx.Exec(ctx, `
			INSERT INTO library_overlays (id, organization_id, library_id, base_release_id, status)
			VALUES ($1, $2, $3, $4, 'draft')
		`, uuid.New(), orgA, standardLibID, standardDraftID)
		if err == nil {
			t.Fatal("RLS breach: Org B was able to insert an overlay belonging to Org A")
		}
	})

	// Org B CAN insert an overlay for Org B in a fresh transaction
	withRLSActor(t, fx.app, rlsOrgB, rlsUserB, func(tx pgx.Tx) {
		_, err := tx.Exec(ctx, `
			INSERT INTO library_overlays (id, organization_id, library_id, base_release_id, status)
			VALUES ($1, $2, $3, $4, 'draft')
		`, uuid.New(), orgB, standardLibID, standardDraftID)
		if err != nil {
			t.Fatalf("Org B could not insert own overlay: %v", err)
		}
	})

	// 2. Org A under granete_app role CAN see and interact with its own overlay
	withRLSActor(t, fx.app, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
		var count int
		err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM library_overlays WHERE id = $1`, overlayA.ID).Scan(&count)
		if err != nil {
			t.Fatalf("query overlay as Org A: %v", err)
		}
		if count != 1 {
			t.Fatalf("Org A should see its own overlay, got %d rows", count)
		}
	})
}

func TestOverlayStore_RebaseConflicts_LifecycleAndRLS(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	adminStore := &storage.PostgresStore{Pool: fx.admin}

	orgA := uuid.MustParse(rlsOrgA)
	standardLibID := uuid.MustParse(domain.GraneteStandardLibraryID)
	standardDraftID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)

	overlayA, err := adminStore.CreateOverlay(ctx, &domain.LibraryOverlay{
		OrganizationID: orgA,
		LibraryID:      standardLibID,
		BaseReleaseID:  standardDraftID,
		Status:         "rebase_conflict",
	})
	if err != nil {
		t.Fatalf("create overlay: %v", err)
	}

	conflict1 := domain.LibraryOverlayConflict{
		ID:               uuid.New(),
		OverlayID:        overlayA.ID,
		OrganizationID:   orgA,
		OldBaseReleaseID: standardDraftID,
		NewBaseReleaseID: standardDraftID,
		ConflictType:     domain.ConflictSameField,
		Path:             "parameters.panelThickness",
		OldBaseValue:     18,
		NewBaseValue:     15,
		CustomValue:      19,
		Status:           "pending",
	}

	conflict2 := domain.LibraryOverlayConflict{
		ID:               uuid.New(),
		OverlayID:        overlayA.ID,
		OrganizationID:   orgA,
		OldBaseReleaseID: standardDraftID,
		NewBaseReleaseID: standardDraftID,
		ConflictType:     domain.ConflictCrossFieldDependency,
		Path:             "joint.depth",
		OldBaseValue:     12,
		NewBaseValue:     14,
		CustomValue:      14,
		Status:           "pending",
	}

	// Save conflicts
	err = adminStore.ReplaceOverlayPendingConflicts(ctx, overlayA.ID, []domain.LibraryOverlayConflict{conflict1, conflict2})
	if err != nil {
		t.Fatalf("ReplaceOverlayPendingConflicts failed: %v", err)
	}

	// Count pending conflicts
	pendingCount, err := adminStore.CountPendingConflicts(ctx, overlayA.ID)
	if err != nil {
		t.Fatalf("CountPendingConflicts failed: %v", err)
	}
	if pendingCount != 2 {
		t.Fatalf("expected 2 pending conflicts, got %d", pendingCount)
	}

	// List conflicts
	list, err := adminStore.ListOverlayConflicts(ctx, overlayA.ID, "")
	if err != nil {
		t.Fatalf("ListOverlayConflicts failed: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 conflicts in list, got %d", len(list))
	}

	// RLS isolation check: Org B under granete_app cannot see or resolve Org A's conflicts
	withRLSActor(t, fx.app, rlsOrgB, rlsUserB, func(tx pgx.Tx) {
		var count int
		err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM library_overlay_conflicts WHERE id = $1`, conflict1.ID).Scan(&count)
		if err != nil {
			t.Fatalf("query conflict as Org B: %v", err)
		}
		if count != 0 {
			t.Fatalf("RLS breach: Org B saw Org A's conflict (%d rows)", count)
		}

		tag, err := tx.Exec(ctx, `
			UPDATE library_overlay_conflicts
			SET status = 'resolved', resolution_action = 'keep_custom'
			WHERE id = $1
		`, conflict1.ID)
		if err != nil {
			t.Fatalf("update conflict as Org B: %v", err)
		}
		if tag.RowsAffected() != 0 {
			t.Fatalf("RLS breach: Org B modified Org A's conflict (%d rows affected)", tag.RowsAffected())
		}
	})

	// Resolve conflict 1
	resolverUser := uuid.MustParse(rlsUserA)
	err = adminStore.ResolveOverlayConflict(ctx, conflict1.ID, domain.ResolutionKeepCustom, 19, &resolverUser)
	if err != nil {
		t.Fatalf("ResolveOverlayConflict failed: %v", err)
	}

	// Fetch resolved conflict
	resolvedC1, err := adminStore.GetOverlayConflictByID(ctx, conflict1.ID)
	if err != nil {
		t.Fatalf("GetOverlayConflictByID failed: %v", err)
	}
	if resolvedC1.Status != "resolved" {
		t.Fatalf("expected status 'resolved', got %s", resolvedC1.Status)
	}
	if resolvedC1.ResolutionAction == nil || *resolvedC1.ResolutionAction != domain.ResolutionKeepCustom {
		t.Fatalf("expected resolution action 'keep_custom', got %v", resolvedC1.ResolutionAction)
	}
	if resolvedC1.ResolvedBy == nil || *resolvedC1.ResolvedBy != resolverUser {
		t.Fatalf("expected resolved_by %s, got %v", resolverUser, resolvedC1.ResolvedBy)
	}

	// Attempt duplicate resolution on already-resolved conflict -> ErrOverlayConflictAlreadyResolved
	err = adminStore.ResolveOverlayConflict(ctx, conflict1.ID, domain.ResolutionAdoptUpstream, 15, &resolverUser)
	if !errors.Is(err, storage.ErrOverlayConflictAlreadyResolved) {
		t.Fatalf("expected ErrOverlayConflictAlreadyResolved, got %v", err)
	}

	// Remaining pending count is 1
	pendingCount, err = adminStore.CountPendingConflicts(ctx, overlayA.ID)
	if err != nil {
		t.Fatalf("CountPendingConflicts failed: %v", err)
	}
	if pendingCount != 1 {
		t.Fatalf("expected 1 pending conflict remaining, got %d", pendingCount)
	}
}
