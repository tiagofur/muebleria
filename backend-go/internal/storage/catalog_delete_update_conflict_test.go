package storage_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Integration: requires isolated test Postgres. Closes the two acceptance
// crosses of #443 that the per-family contract (#1089/#1091/#1097) left
// implicit, under the owner's 2026-10-19 decision (option A): catalog writes
// are `PUT/DELETE /{id}` guarded by If-Match and that is the idempotency
// contract — no Idempotency-Key middleware on catalog routes.
//
//  1. Edit after delete never resurrects nor applies: a hard-deleted row makes
//     the stale write a "not found" (handler → 404); a soft-deleted row keeps
//     its bumped version so the stale write is a VERSION_CONFLICT (→ 412) and
//     the row stays inactive.
//  2. A retry that re-sends the ORIGINAL If-Match after a write that did land
//     (lost ack, offline replay) fails with ErrVersionConflict and mutates
//     nothing — no double apply, no double bump; the client reconciles by
//     re-reading and re-sending against the current version.

func TestCatalog_UpdateAfterHardDeleteDoesNotResurrect(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	unique := fmt.Sprintf("ZZ-443-%d", time.Now().UnixNano())

	var id string
	withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
		c := &domain.ModuleCategory{Name: unique + " cat", SortOrder: 1}
		if err := store.CreateCategory(ctx, c); err != nil {
			return err
		}
		id = c.ID
		cleanupConnectStoreFixture(t, "DELETE FROM module_categories WHERE id = $1", id)
		return nil
	})

	// Client A reads v1; client B hard-deletes against v1.
	v := withinConnectStoreTenantValue(t, store, actor, func(ctx context.Context) (int64, error) {
		c, err := store.GetCategoryByID(ctx, id)
		if err != nil {
			return 0, err
		}
		return c.Version, nil
	})
	if v != 1 {
		t.Fatalf("versión inicial = %d, want 1", v)
	}
	withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
		return store.DeleteCategory(ctx, id, 1)
	})

	// Client A, still on v1, edits: the write must NOT re-create the row.
	staleErr := withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
		return store.UpdateCategory(ctx, id, 1, &domain.ModuleCategory{Name: unique + " editada", SortOrder: 2})
	})
	if staleErr == nil {
		t.Fatalf("update after hard delete succeeded: the stale write resurrected the row")
	}
	if errors.Is(staleErr, storage.ErrVersionConflict) {
		t.Fatalf("update after hard delete = ErrVersionConflict, want an explicit not-found (the row is gone, not stale)")
	}
	if !strings.Contains(staleErr.Error(), "not found") {
		t.Fatalf("update after hard delete err = %v, want a not-found error", staleErr)
	}
	readErr := withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
		_, err := store.GetCategoryByID(ctx, id)
		return err
	})
	if readErr == nil {
		t.Fatalf("category %s still readable after delete + stale update", id)
	}
}

func TestCatalog_UpdateAfterSoftDeleteIsAConflictAndStaysInactive(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	unique := fmt.Sprintf("ZZ-443S-%d", time.Now().UnixNano())

	var id string
	withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
		m := &domain.MaterialBoard{Code: unique + "MB", Name: "Tablero original", WidthMm: 100, LengthMm: 200, ThicknessMm: 15, Active: true}
		if err := store.CreateMaterialBoard(ctx, m); err != nil {
			return err
		}
		id = m.ID
		cleanupConnectStoreFixture(t, "DELETE FROM material_boards WHERE id = $1", id)
		return nil
	})

	// Client B deactivates against v1 (the DELETE route for materials is a soft delete).
	withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
		return store.DeactivateMaterialBoard(ctx, id, 1)
	})

	// Client A, still on v1, edits (and would re-activate): must be a conflict.
	staleErr := withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
		m := &domain.MaterialBoard{Code: unique + "MB", Name: "Tablero editado a ciegas", WidthMm: 100, LengthMm: 200, ThicknessMm: 15, Active: true}
		return store.UpdateMaterialBoard(ctx, id, 1, m)
	})
	if !errors.Is(staleErr, storage.ErrVersionConflict) {
		t.Fatalf("update after soft delete err = %v, want ErrVersionConflict", staleErr)
	}

	cur := withinConnectStoreTenantValue(t, store, actor, func(ctx context.Context) (*domain.MaterialBoard, error) {
		return store.GetMaterialBoardByID(ctx, id)
	})
	if cur.Active {
		t.Fatalf("the stale update re-activated the material")
	}
	if cur.Name != "Tablero original" {
		t.Fatalf("the stale update changed the name: %q", cur.Name)
	}
	if cur.Version != 2 {
		t.Fatalf("version after deactivate + stale update = %d, want 2", cur.Version)
	}
}

func TestCatalog_RetryWithOriginalIfMatchIsIdempotent(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	unique := fmt.Sprintf("ZZ-443R-%d", time.Now().UnixNano())

	var id string
	withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
		m := &domain.MaterialBoard{Code: unique + "MB", Name: "Tablero A", WidthMm: 100, LengthMm: 200, ThicknessMm: 15, Active: true}
		if err := store.CreateMaterialBoard(ctx, m); err != nil {
			return err
		}
		id = m.ID
		cleanupConnectStoreFixture(t, "DELETE FROM material_boards WHERE id = $1", id)
		return nil
	})

	write := func(expected int64, name string) error {
		return withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
			m := &domain.MaterialBoard{Code: unique + "MB", Name: name, WidthMm: 100, LengthMm: 200, ThicknessMm: 15, Active: true}
			return store.UpdateMaterialBoard(ctx, id, expected, m)
		})
	}
	read := func() *domain.MaterialBoard {
		return withinConnectStoreTenantValue(t, store, actor, func(ctx context.Context) (*domain.MaterialBoard, error) {
			return store.GetMaterialBoardByID(ctx, id)
		})
	}

	// First attempt lands, but the client never sees the ack.
	if err := write(1, "Tablero B"); err != nil {
		t.Fatalf("first write: %v", err)
	}
	// Blind retry of the SAME request with the ORIGINAL If-Match.
	retryErr := write(1, "Tablero B")
	if !errors.Is(retryErr, storage.ErrVersionConflict) {
		t.Fatalf("retry with original If-Match err = %v, want ErrVersionConflict", retryErr)
	}
	after := read()
	if after.Version != 2 {
		t.Fatalf("retry bumped the version: %d, want 2 (single apply)", after.Version)
	}
	if after.Name != "Tablero B" {
		t.Fatalf("state after retry = %q, want the single applied write", after.Name)
	}

	// Reconcile: re-read the current version and write against it.
	if err := write(after.Version, "Tablero C"); err != nil {
		t.Fatalf("reconciled write: %v", err)
	}
	final := read()
	if final.Version != 3 || final.Name != "Tablero C" {
		t.Fatalf("reconciled state = v%d %q, want v3 \"Tablero C\"", final.Version, final.Name)
	}
}
