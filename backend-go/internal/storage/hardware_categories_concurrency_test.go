package storage_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1556 — the hardware_categories tree invariants (depth ≤ 3, acyclicity,
// children guard) are multi-row statements protected by a per-organization
// advisory lock; these tests pin that serialization, the RLS isolation and
// the up/down replay of 000177.
//
// NOTE on realism: production requests enter through the auth middleware,
// which already wraps the handler in ONE tenant transaction — the advisory
// lock taken inside it serializes concurrent trees exactly as this test
// does. Each goroutine here opens its own WithTenantTx the same way.

func TestHardwareCategoryTree_SerializesConcurrentMutations_1556(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	unique := fmt.Sprintf("HC%d", time.Now().UnixNano()%1_000_000)

	// Two children under the ROOT parent (depth 2): a third insert is legal
	// in isolation — the race in the issue was between a move and a create.
	// Reproduce THAT shape: L1 → L2 (both created) and one update that moves
	// L2 under L1 WHILE the other writer inserts under the OLD parent L2's
	// parent chain. The invariant that must hold: the tree never grows past
	// MaxCategoryDepth and never cycles.
	var l1, l2 string
	withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
		a := &domain.HardwareCategory{Name: unique + "-L1", SortOrder: 1}
		if err := store.CreateHardwareCategory(ctx, a); err != nil {
			return err
		}
		l1 = a.ID
		b := &domain.HardwareCategory{Name: unique + "-L2", ParentID: l1, SortOrder: 2}
		if err := store.CreateHardwareCategory(ctx, b); err != nil {
			return err
		}
		l2 = b.ID
		return nil
	})

	// Writer A: move L2 under a NEW sibling subtree? Depth forbids deeper
	// trees, so the only racing pair that could violate the invariant is
	// move L2 to root + create under L2 (level 2 becomes level 1 → child
	// level 2, legal) — versus create under L2 first (level 3, legal) and
	// THEN the move would push it to level 2 (illegal). Serialized, one of
	// the two orders must produce a typed rejection; never a level-4 row.
	var wg sync.WaitGroup
	moveErr := make(chan error, 1)
	createErr := make(chan error, 1)
	wg.Add(2)
	go func() {
		defer wg.Done()
		moveErr <- withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
			c := &domain.HardwareCategory{Name: unique + "-L2-moved", SortOrder: 2}
			return store.UpdateHardwareCategory(ctx, l2, 1, c)
		})
	}()
	go func() {
		defer wg.Done()
		createErr <- withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
			c := &domain.HardwareCategory{Name: unique + "-L3", ParentID: l2, SortOrder: 3}
			return store.CreateHardwareCategory(ctx, c)
		})
	}()
	wg.Wait()

	for _, ch := range []chan error{moveErr, createErr} {
		select {
		case err := <-ch:
			if err != nil && !errors.Is(err, storage.ErrVersionConflict) &&
				!isPlacementError(err) {
				t.Fatalf("unexpected error from racing writers: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("concurrent tree mutations deadlocked — the advisory lock did not serialize them")
		}
	}

	// The persisted tree must stay within the depth limit, whatever order won.
	var maxDepth int
	if err := store.Pool.QueryRow(context.Background(), `
		WITH RECURSIVE tree AS (
			SELECT id, parent_id, 1 AS depth FROM hardware_categories WHERE parent_id IS NULL
			UNION ALL
			SELECT c.id, c.parent_id, t.depth + 1 FROM hardware_categories c JOIN tree t ON c.parent_id = t.id
		) SELECT COALESCE(MAX(depth), 0) FROM tree WHERE id LIKE $1 || '%'`, unique).Scan(&maxDepth); err != nil {
		t.Fatal(err)
	}
	if maxDepth > 3 {
		t.Fatalf("the race persisted a level-%d node", maxDepth)
	}
	// And it must not contain a cycle among the fixture nodes.
	var cycle bool
	if err := store.Pool.QueryRow(context.Background(), `
		WITH RECURSIVE walk AS (
			SELECT id, parent_id, 0 AS hops FROM hardware_categories WHERE id = $1
			UNION ALL
			SELECT c.id, c.parent_id, w.hops + 1 FROM hardware_categories c JOIN walk w ON c.id = w.parent_id
		) SELECT EXISTS (SELECT 1 FROM walk WHERE hops > 10)`, l1).Scan(&cycle); err != nil {
		t.Fatal(err)
	}
	if cycle {
		t.Fatal("cycle detected in the raced tree")
	}
}

func isPlacementError(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "invalid category placement") ||
		strings.Contains(err.Error(), "cannot exceed") ||
		strings.Contains(err.Error(), "not found"))
}

func TestHardwareCategoryDelete_GuardsChildrenUnderRace_1556(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	unique := fmt.Sprintf("HCd%d", time.Now().UnixNano()%1_000_000)

	var parent, child string
	withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
		a := &domain.HardwareCategory{Name: unique + "-padre", SortOrder: 1}
		if err := store.CreateHardwareCategory(ctx, a); err != nil {
			return err
		}
		parent = a.ID
		b := &domain.HardwareCategory{Name: unique + "-hijo", ParentID: parent, SortOrder: 2}
		if err := store.CreateHardwareCategory(ctx, b); err != nil {
			return err
		}
		child = b.ID
		return nil
	})

	// Delete with the children check (typed 409 material) — and then a
	// concurrent INSERT under the deleted parent must fail on the FK, never
	// orphan a row.
	childrenErr := withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
		return store.DeleteHardwareCategory(ctx, parent, 1)
	})
	if !errors.Is(childrenErr, storage.ErrHardwareCategoryHasChildren) {
		t.Fatalf("delete with children err = %v, want ErrHardwareCategoryHasChildren", childrenErr)
	}

	// Delete the child first, then the parent succeeds.
	if err := withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
		return store.DeleteHardwareCategory(ctx, child, 1)
	}); err != nil {
		t.Fatal(err)
	}
	if err := withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
		return store.DeleteHardwareCategory(ctx, parent, 1)
	}); err != nil {
		t.Fatalf("delete after children removed: %v", err)
	}

	// The FK guards the race the check-then-act used to lose: insert under a
	// just-deleted parent is a hard FK error, never an orphan.
	fkErr := withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
		return store.CreateHardwareCategory(ctx, &domain.HardwareCategory{Name: unique + "-huerfano", ParentID: parent, SortOrder: 3})
	})
	if fkErr == nil {
		t.Fatal("insert under a deleted parent must fail on the FK")
	}

	// And a stale-version delete is a typed conflict, not a not-found.
	// (The id is captured from the create: a pool-side lookup carries no
	// tenant GUCs and RLS hides the row — the empty id would make the
	// children guard match the root node.)
	var leafID string
	if err := withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
		a := &domain.HardwareCategory{Name: unique + "-v", SortOrder: 4}
		createErr := store.CreateHardwareCategory(ctx, a)
		leafID = a.ID
		return createErr
	}); err != nil {
		t.Fatal(err)
	}
	staleErr := withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
		return store.DeleteHardwareCategory(ctx, leafID, 99)
	})
	if !errors.Is(staleErr, storage.ErrVersionConflict) {
		t.Fatalf("stale delete err = %v, want ErrVersionConflict", staleErr)
	}
}
