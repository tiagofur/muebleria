package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1422 slice 1: the kit↔part link round-trips through the JSONB-free
// column; NULL reads back as nil (herraje independiente).
func TestHardwareKitLinkRoundtrip(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	kitID, partID := uniqueID("hw-kit"), uniqueID("hw-part")
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE id IN ($1, $2)`, kitID, partID)
	})

	kit := &domain.Hardware{ID: kitID, Code: "KIT-LINK", Name: "Kit link", Unit: "set", CostPerUnit: 100, Active: true}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, kit)
	})
	part := &domain.Hardware{ID: partID, Code: "PART-LINK", Name: "Parte link", Unit: "piece", CostPerUnit: 0, Active: true, KitHardwareID: &kitID}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, part)
	})

	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, partID)
	})
	if got.KitHardwareID == nil || *got.KitHardwareID != kitID {
		t.Fatalf("kit link lost on create: %+v", got.KitHardwareID)
	}

	legacy := &domain.Hardware{ID: uniqueID("hw-mono"), Code: "HW-MONO-LINK", Name: "Mono", Unit: "piece", CostPerUnit: 0, Active: true}
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE id = $1`, legacy.ID) })
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, legacy)
	})
	gotLegacy := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, legacy.ID)
	})
	if gotLegacy.KitHardwareID != nil {
		t.Fatalf("legacy hardware must read back without kit link, got %+v", gotLegacy.KitHardwareID)
	}
}
