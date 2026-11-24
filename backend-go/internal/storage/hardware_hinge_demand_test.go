package storage_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1579: the table a hinge declares round-trips through hardwares.hinge_demand
// on every hardware read/write path (create, get, list, update), the surge
// tri-state survives the JSONB column, NULL reads back as nil, and an
// explicit clear through the update path lands.
func TestHardwareHingeDemandRoundtrip(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	// SIN ids explícitos: hardwares.id es UUID (server genera).
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE code LIKE $1`, "BIS-TABLE-%")
	})

	// widthSurgeOverMm 0 = surge disabled: the one value a lossy round-trip
	// would turn into NULL → "inherit the library default".
	disabled := 0.0
	table := &domain.HingeDemandPolicy{
		Bands:            []domain.HingeDemandBand{{UpToHeightMm: 900, Hinges: 2}, {UpToHeightMm: 2400, Hinges: 5}},
		WidthSurgeOverMm: &disabled,
	}
	assertTable := func(t *testing.T, where string, got *domain.HingeDemandPolicy) {
		t.Helper()
		if got == nil || len(got.Bands) != 2 || got.Bands[0].Hinges != 2 || got.Bands[1].UpToHeightMm != 2400 || got.Bands[1].Hinges != 5 {
			t.Fatalf("%s: table lost: %+v", where, got)
		}
		if got.WidthSurgeOverMm == nil || *got.WidthSurgeOverMm != 0 {
			t.Fatalf("%s: a disabled surge must survive the round-trip as 0, got %v", where, got.WidthSurgeOverMm)
		}
	}

	hw := &domain.Hardware{Code: "BIS-TABLE-" + suffix, Name: "Bisagra con tabla", Unit: "piece", CostPerUnit: 68, Active: true, HingeDemand: table}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, hw)
	})

	get := func(t *testing.T) *domain.Hardware {
		return withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
			return store.GetHardwareByID(txCtx, hw.ID)
		})
	}
	assertTable(t, "after create", get(t).HingeDemand)

	list := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) ([]domain.Hardware, error) {
		return store.ListHardwares(txCtx)
	})
	found := false
	for _, item := range list {
		if item.ID == hw.ID {
			found = true
			assertTable(t, "in the list read", item.HingeDemand)
		}
	}
	if !found {
		t.Fatalf("the created hardware is missing from ListHardwares")
	}

	// Explicit clear through the update path.
	cleared := get(t)
	cleared.HingeDemand = nil
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, cleared.ID, cleared.Version, cleared)
	})
	if got := get(t).HingeDemand; got != nil {
		t.Fatalf("an explicit nil must land as NULL, got %+v", got)
	}

	// And declaring it through the update path.
	restored := get(t)
	restored.HingeDemand = table
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, restored.ID, restored.Version, restored)
	})
	assertTable(t, "after update", get(t).HingeDemand)
}
