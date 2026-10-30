package storage_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1417: design parts round-trip through the JSONB column; NULL (legacy
// monolithic hardware) reads back as nil.
//
// SIN id explícito: hardwares.id es UUID y el server lo genera; un id no-
// UUID en el fixture es rechazado por CI (DB fresca) aunque una DB local
// con drift lo acepte.
func TestHardwareDesignPartsRoundtrip(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	code := fmt.Sprintf("HW-PARTS-%d", time.Now().UnixNano())
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE code = $1`, code) })

	in := &domain.Hardware{
		Code: code, Name: "Corredera con partes",
		Unit: "piece", CostPerUnit: 0, Active: true,
		DesignParts: []domain.HardwareDesignPart{
			{ComponentName: "riel_fijo", ActorMembership: "body", Label: "Riel fijo"},
			{ComponentName: "riel_movil", ActorMembership: "actor:drawer", FinishKey: "body"},
		},
	}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, in)
	})
	if in.ID == "" {
		t.Fatal("server must assign the hardware id on create")
	}

	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, in.ID)
	})
	if len(got.DesignParts) != 2 {
		t.Fatalf("expected 2 design parts after roundtrip, got %+v", got.DesignParts)
	}
	if got.DesignParts[0] != (domain.HardwareDesignPart{ComponentName: "riel_fijo", ActorMembership: "body", Label: "Riel fijo"}) {
		t.Fatalf("part 0 mismatch: %+v", got.DesignParts[0])
	}
	if got.DesignParts[1].FinishKey != "body" || got.DesignParts[1].ActorMembership != "actor:drawer" {
		t.Fatalf("part 1 mismatch: %+v", got.DesignParts[1])
	}

	// Update replaces the parts; empty slice clears to NULL/nil.
	in.Version = got.Version
	in.DesignParts = []domain.HardwareDesignPart{
		{ComponentName: "unico", ActorMembership: "actor:cajon"},
	}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, in.ID, got.Version, in)
	})
	updated := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, in.ID)
	})
	if len(updated.DesignParts) != 1 || updated.DesignParts[0].ComponentName != "unico" {
		t.Fatalf("update did not replace parts: %+v", updated.DesignParts)
	}
}

func TestHardwareDesignPartsLegacyNull(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	code := fmt.Sprintf("HW-MONO-LINK-%d", time.Now().UnixNano())
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM hardwares WHERE code = $1`, code) })

	in := &domain.Hardware{Code: code, Name: "Monolítica", Unit: "piece", CostPerUnit: 0, Active: true}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, in)
	})
	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, in.ID)
	})
	if got.DesignParts != nil {
		t.Fatalf("legacy hardware must read back with nil parts, got %+v", got.DesignParts)
	}
}
