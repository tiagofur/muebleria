package storage_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Integration: requires isolated test Postgres (#1209 PR1). Verifies the
// available_finishes JSONB column round-trips through Create/Update/Get:
//   - nil list stays NULL (legacy rows offer no finish choice);
//   - a valid preset list round-trips exactly;
//   - updating to nil clears the offer.
func TestHardware_PersistsAvailableFinishes(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor

	// Case 1: create without finishes → nil (NULL column, fail-closed offer).
	hw := newHardwareAvailableFinishesTestRow()
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, hw)
	})
	registerHardwareAvailableFinishesCleanup(t, hw.ID)
	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, hw.ID)
	})
	if got.AvailableFinishes != nil {
		t.Fatalf("legacy row should offer no finishes, got %v", got.AvailableFinishes)
	}

	// Case 2: the offer round-trips exactly and in order.
	hw.AvailableFinishes = []string{"chrome", "black-matte", "bronze"}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, hw.ID, hw.Version, hw)
	})
	got = withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, hw.ID)
	})
	if len(got.AvailableFinishes) != 3 ||
		got.AvailableFinishes[0] != "chrome" ||
		got.AvailableFinishes[1] != "black-matte" ||
		got.AvailableFinishes[2] != "bronze" {
		t.Fatalf("available finishes did not round-trip: %v", got.AvailableFinishes)
	}

	// Case 3: clearing back to nil removes the offer.
	hw.AvailableFinishes = nil
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, hw.ID, hw.Version, hw)
	})
	got = withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, hw.ID)
	})
	if got.AvailableFinishes != nil {
		t.Fatalf("cleared row should offer no finishes, got %v", got.AvailableFinishes)
	}
}

func newHardwareAvailableFinishesTestRow() *domain.Hardware {
	return &domain.Hardware{
		Code:        fmt.Sprintf("ZZ-HWAVAILFIN-%d", time.Now().UnixNano()),
		Name:        "Hardware Available Finishes Round-Trip Test",
		Unit:        domain.HardwareUnit("piece"),
		CostPerUnit: 1,
		Active:      true,
	}
}

func registerHardwareAvailableFinishesCleanup(t *testing.T, id string) {
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE id = $1`, id)
	})
}
