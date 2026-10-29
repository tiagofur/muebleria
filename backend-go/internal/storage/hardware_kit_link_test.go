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
	// SIN ids explícitos: hardwares.id es UUID (server genera) — un id no-
	// UUID es rechazado por CI (DB fresca; el drift local engaña).
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE code IN ('KIT-LINK', 'PART-LINK')`)
	})

	kit := &domain.Hardware{Code: "KIT-LINK", Name: "Kit link", Unit: "set", CostPerUnit: 100, Active: true}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, kit)
	})
	part := &domain.Hardware{Code: "PART-LINK", Name: "Parte link", Unit: "piece", CostPerUnit: 0, Active: true, KitHardwareID: &kit.ID}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, part)
	})

	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, part.ID)
	})
	if got.KitHardwareID == nil || *got.KitHardwareID != kit.ID {
		t.Fatalf("kit link lost on create: %+v", got.KitHardwareID)
	}

	legacy := &domain.Hardware{Code: "HW-MONO-LINK", Name: "Mono", Unit: "piece", CostPerUnit: 0, Active: true}
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE code = 'HW-MONO-LINK'`) })
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
