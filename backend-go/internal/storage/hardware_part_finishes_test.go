package storage_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Integration: requires isolated test Postgres. Verifies the F080 part_finishes JSONB
// column round-trips through Create/Update/Get:
//   - nil map stays NULL (legacy rows: every part uses the global finish);
//   - a body/base/grip map round-trips exactly;
//   - updating to nil clears the overrides.
func TestHardware_PersistsPartFinishes(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor

	// Case 1: create without part finishes → nil (NULL column).
	legacy := newHardwarePartFinishesTestRow()
	legacy.PreviewShape = strPtr("bar-pull")
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, legacy)
	})
	registerHardwarePartFinishesCleanup(t, legacy.ID)
	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, legacy.ID)
	})
	if got.PartFinishes != nil {
		t.Fatalf("legacy row should have no part finishes, got %v", got.PartFinishes)
	}

	// Case 2: per-part overrides round-trip.
	legacy.PartFinishes = map[string]string{"grip": "gold", "base": "black-matte"}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, legacy.ID, legacy)
	})
	got = withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, legacy.ID)
	})
	if got.PartFinishes["grip"] != "gold" || got.PartFinishes["base"] != "black-matte" {
		t.Fatalf("part finishes did not round-trip: %v", got.PartFinishes)
	}
	if len(got.PartFinishes) != 2 {
		t.Fatalf("expected exactly 2 overrides, got %v", got.PartFinishes)
	}

	// Case 3: clearing back to nil removes the overrides.
	legacy.PartFinishes = nil
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, legacy.ID, legacy)
	})
	got = withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, legacy.ID)
	})
	if got.PartFinishes != nil {
		t.Fatalf("cleared row should have no part finishes, got %v", got.PartFinishes)
	}
}

func newHardwarePartFinishesTestRow() *domain.Hardware {
	return &domain.Hardware{
		Code:        fmt.Sprintf("ZZ-HWPARTFIN-%d", time.Now().UnixNano()),
		Name:        "Hardware Part Finishes Round-Trip Test",
		Unit:        domain.HardwareUnit("piece"),
		CostPerUnit: 1,
		Active:      true,
	}
}

func registerHardwarePartFinishesCleanup(t *testing.T, id string) {
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE id = $1`, id)
	})
}
