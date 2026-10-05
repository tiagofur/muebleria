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

// Integration: requires isolated test Postgres. Covers #1084 (#443 slice 1):
// catalog hardware writes are If-Match guarded with a server-owned version.
//   - create starts at version 1 (POST carries no version);
//   - a fresh-version update succeeds and bumps the version;
//   - two clients holding the same version: the first write wins, the second
//     gets ErrVersionConflict and neither change is silently lost;
//   - retrying after a refresh of the expected version succeeds;
//   - deactivate is guarded the same way;
//   - a missing row reports "not found", not a conflict.
func TestHardware_OptimisticConcurrencyGuardsWrites(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor

	// withinTenant runs a tenant-scoped unit of work and hands the error back
	// so expected failures (stale version, missing row) can be asserted.
	actorOrg := actor.OrganizationID
	withinTenant := func(run func(context.Context) error) error {
		ctx := storage.WithOrgCtx(context.Background(), actorOrg)
		return store.WithinTenantTx(ctx, actor, run)
	}

	hw := &domain.Hardware{
		Code:        fmt.Sprintf("ZZ-HWCONC-%d", time.Now().UnixNano()),
		Name:        "Hardware Optimistic Concurrency Test",
		Unit:        domain.HardwareUnit("piece"),
		CostPerUnit: 2,
		Active:      true,
	}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateHardware(txCtx, hw) })
	registerHardwareMachiningCleanup(t, hw)

	if hw.Version != 1 {
		t.Fatalf("created hardware version = %d, want 1", hw.Version)
	}

	// Two clients read the same version (1). Client A writes first.
	clientA := fmt.Sprintf("Tirador A-%d", time.Now().UnixNano())
	hw.Name = clientA
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, hw.ID, 1, hw)
	})
	if hw.Version != 2 {
		t.Fatalf("after client A write version = %d, want 2", hw.Version)
	}

	// Client B still holds version 1: the stale write must be rejected and
	// the row must keep client A's change.
	clientB := "Tirador B concurrente"
	stale := *hw
	stale.Version = 1
	stale.Name = clientB
	err := withinTenant(func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, hw.ID, 1, &stale)
	})
	if !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale write err = %v, want ErrVersionConflict", err)
	}
	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, hw.ID)
	})
	if got.Name != clientA {
		t.Fatalf("stale writer reverted client A's change: name = %q", got.Name)
	}
	if got.Version != 2 {
		t.Fatalf("row version moved on stale write: %d, want 2", got.Version)
	}

	// Client B reconciles (re-reads version 2) and retries successfully.
	hw.Version = got.Version
	hw.Name = clientB
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, hw.ID, hw.Version, hw)
	})
	if hw.Version != 3 {
		t.Fatalf("after reconciled retry version = %d, want 3", hw.Version)
	}

	// Deactivate is guarded too: stale expected version rejected.
	if err := withinTenant(func(txCtx context.Context) error {
		return store.DeactivateHardware(txCtx, hw.ID, 1)
	}); !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale deactivate err = %v, want ErrVersionConflict", err)
	}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.DeactivateHardware(txCtx, hw.ID, hw.Version)
	})
	got = withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, hw.ID)
	})
	if got.Active {
		t.Fatal("hardware not deactivated")
	}
	if got.Version != 4 {
		t.Fatalf("deactivate did not bump version: %d, want 4", got.Version)
	}

	// A missing row is "not found", never a conflict.
	missingErr := withinTenant(func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, "00000000-0000-0000-0000-00000000d34d", 1, hw)
	})
	if missingErr == nil || !strings.Contains(missingErr.Error(), "not found") {
		t.Fatalf("missing-row update err = %v, want not found", missingErr)
	}
}
