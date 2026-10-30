package storage_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1422 slice 1: the kit↔part link round-trips through the JSONB-free
// column; NULL reads back as nil (herraje independiente).
func TestHardwareKitLinkRoundtrip(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	// SIN ids explícitos: hardwares.id es UUID (server genera) — un id no-
	// UUID es rechazado por CI (DB fresca; el drift local engaña).
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE code LIKE $1`, "KIT-LINK-%")
		cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE code LIKE $1`, "PART-LINK-%")
	})

	kit := &domain.Hardware{Code: "KIT-LINK-" + suffix, Name: "Kit link", Unit: "set", CostPerUnit: 100, Active: true}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, kit)
	})
	part := &domain.Hardware{Code: "PART-LINK-" + suffix, Name: "Parte link", Unit: "piece", CostPerUnit: 0, Active: true, KitHardwareID: &kit.ID}
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

// #1422 slice 1 review: a kit with linked parts must NOT deactivate — the
// parts' kit link would dangle. Unlinking first unblocks it.
func TestDeactivateHardware_KitWithLinkedPartsBlocked(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE code LIKE $1`, "KIT-GUARD-%")
		cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE code LIKE $1`, "PART-GUARD-%")
	})

	kit := &domain.Hardware{Code: "KIT-GUARD-" + suffix, Name: "Kit guard", Unit: "set", CostPerUnit: 100, Active: true}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, kit)
	})
	part := &domain.Hardware{Code: "PART-GUARD-" + suffix, Name: "Parte guard", Unit: "piece", CostPerUnit: 0, Active: true, KitHardwareID: &kit.ID}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, part)
	})

	err := store.WithinTenantTx(storage.WithOrgCtx(context.Background(), actor.OrganizationID), actor, func(txCtx context.Context) error {
		return store.DeactivateHardware(txCtx, kit.ID, kit.Version)
	})
	if err == nil || !errors.Is(err, storage.ErrHardwareKitHasParts) {
		t.Fatalf("expected ErrHardwareKitHasParts, got %v", err)
	}

	// Desvincular la parte desbloquea.
	part.Version = 1
	part.KitHardwareID = nil
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, part.ID, part.Version, part)
	})
	if err := store.WithinTenantTx(storage.WithOrgCtx(context.Background(), actor.OrganizationID), actor, func(txCtx context.Context) error {
		return store.DeactivateHardware(txCtx, kit.ID, kit.Version)
	}); err != nil {
		t.Fatalf("desvinculada la parte, el kit debe desactivarse: %v", err)
	}
}

// #1422 perfección (review B1): the PUT is the ONLY deactivation path the
// product uses — UpdateHardware active→false must refuse a kit with linked
// parts exactly like DeactivateHardware does.
func TestUpdateHardware_KitWithLinkedPartsBlocked(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE code LIKE $1`, "KIT-UPD-%")
		cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE code LIKE $1`, "PART-UPD-%")
	})

	kit := &domain.Hardware{Code: "KIT-UPD-" + suffix, Name: "Kit upd", Unit: "set", CostPerUnit: 100, Active: true}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, kit)
	})
	part := &domain.Hardware{Code: "PART-UPD-" + suffix, Name: "Parte upd", Unit: "piece", CostPerUnit: 0, Active: true, KitHardwareID: &kit.ID}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, part)
	})

	// PUT con active=false sobre el kit → rechazado.
	deactivated := *kit
	deactivated.Active = false
	err := store.WithinTenantTx(storage.WithOrgCtx(context.Background(), actor.OrganizationID), actor, func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, kit.ID, kit.Version, &deactivated)
	})
	if err == nil || !errors.Is(err, storage.ErrHardwareKitHasParts) {
		t.Fatalf("expected ErrHardwareKitHasParts on PUT, got %v", err)
	}

	// Desvincular la parte desbloquea el PUT.
	part.Version = 1
	part.KitHardwareID = nil
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, part.ID, part.Version, part)
	})
	deactivated.Version = kit.Version
	if err := store.WithinTenantTx(storage.WithOrgCtx(context.Background(), actor.OrganizationID), actor, func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, kit.ID, kit.Version, &deactivated)
	}); err != nil {
		t.Fatalf("desvinculada la parte, el PUT debe desactivar: %v", err)
	}
}
