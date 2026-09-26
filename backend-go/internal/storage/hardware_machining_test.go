package storage_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Integration: requires isolated test Postgres. Verifies the machining JSONB column
// (F127) round-trips through Create/Update/Get:
//   - nil profile stays nil (NULL = cost-only hardware, legacy rows);
//   - a two-part profile (minifix-style cam + bolt) survives with every
//     nullable scalar (depth) intact;
//   - updating back to nil clears the footprint (UPDATE writes NULL).
func TestHardware_PersistsMachiningProfile(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor

	// Case 1: create with NO machining -> stays nil (cost-only).
	plain := newHardwareMachiningTestRow()
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateHardware(txCtx, plain) })
	registerHardwareMachiningCleanup(t, plain)
	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) { return store.GetHardwareByID(txCtx, plain.ID) })
	if got.Machining != nil {
		t.Fatalf("nil machining not preserved as nil: %+v", got.Machining)
	}

	// Case 2: create WITH a two-part profile -> full round-trip.
	minifix := newHardwareMachiningTestRow()
	minifix.Unit = domain.HardwareUnit("set")
	minifix.Machining = &domain.HardwareMachiningProfile{
		Parts: []domain.HardwareMachiningPart{
			{
				ID: "cam", Role: "cam",
				Operations: []domain.MachiningOperation{
					{ID: "cam-15", Kind: "blind_hole", DiameterMm: 15, DepthMm: ptrFloat64(13), XMm: 0, YMm: 0, Face: "anchor", Label: "Cazuela minifix"},
				},
			},
			{
				ID: "bolt", Role: "bolt",
				Operations: []domain.MachiningOperation{
					{ID: "bolt-pilot", Kind: "screw_pilot", DiameterMm: 5, DepthMm: ptrFloat64(12), XMm: 0, YMm: 0, Face: "anchor"},
				},
			},
		},
	}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateHardware(txCtx, minifix) })
	registerHardwareMachiningCleanup(t, minifix)
	got = withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) { return store.GetHardwareByID(txCtx, minifix.ID) })
	if got.Machining == nil || len(got.Machining.Parts) != 2 {
		t.Fatalf("machining parts not persisted: %+v", got.Machining)
	}
	cam := got.Machining.Parts[0]
	if cam.Role != "cam" || len(cam.Operations) != 1 {
		t.Fatalf("cam part not persisted: %+v", cam)
	}
	op := cam.Operations[0]
	if op.Kind != "blind_hole" || op.DiameterMm != 15 || op.DepthMm == nil || *op.DepthMm != 13 || op.Label != "Cazuela minifix" {
		t.Fatalf("cam operation not round-tripped: %+v", op)
	}
	if got.Machining.Parts[1].Operations[0].DepthMm == nil || *got.Machining.Parts[1].Operations[0].DepthMm != 12 {
		t.Fatalf("bolt depth not round-tripped: %+v", got.Machining.Parts[1])
	}

	// Case 3: update back to nil -> UPDATE clears the footprint.
	minifix.Machining = nil
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.UpdateHardware(txCtx, minifix.ID, minifix) })
	got = withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) { return store.GetHardwareByID(txCtx, minifix.ID) })
	if got.Machining != nil {
		t.Fatalf("machining not cleared on update: %+v", got.Machining)
	}
}

func newHardwareMachiningTestRow() *domain.Hardware {
	return &domain.Hardware{
		Code:        fmt.Sprintf("ZZ-HWMACH-%d", time.Now().UnixNano()),
		Name:        "Hardware Machining Round-Trip Test",
		Unit:        domain.HardwareUnit("piece"),
		CostPerUnit: 1,
		Active:      true,
	}
}

func registerHardwareMachiningCleanup(t *testing.T, h *domain.Hardware) {
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, "DELETE FROM hardwares WHERE id = $1", h.ID)
	})
}
