package storage_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Integration: requires local Postgres. Verifies the machining JSONB column
// (F127) round-trips through Create/Update/Get:
//   - nil profile stays nil (NULL = cost-only hardware, legacy rows);
//   - a two-part profile (minifix-style cam + bolt) survives with every
//     nullable scalar (depth) intact;
//   - updating back to nil clears the footprint (UPDATE writes NULL).
//
// Mirrors hardware_preview_test.go: same DATABASE_URL/fallback + skip guard,
// hard-delete cleanup before pool close.
func TestHardware_PersistsMachiningProfile(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Skipf("no db: %v", err)
	}
	t.Cleanup(func() { pool.Close() })
	store := &storage.PostgresStore{Pool: pool}
	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	// Case 1: create with NO machining -> stays nil (cost-only).
	plain := newHardwareMachiningTestRow()
	if err := store.CreateHardware(ctx, plain); err != nil {
		t.Fatalf("create (no machining): %v", err)
	}
	registerHardwareMachiningCleanup(t, ctx, store, plain)
	got, err := store.GetHardwareByID(ctx, plain.ID)
	if err != nil {
		t.Fatalf("get (no machining): %v", err)
	}
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
	if err := store.CreateHardware(ctx, minifix); err != nil {
		t.Fatalf("create (minifix machining): %v", err)
	}
	registerHardwareMachiningCleanup(t, ctx, store, minifix)
	got, err = store.GetHardwareByID(ctx, minifix.ID)
	if err != nil {
		t.Fatalf("get (minifix machining): %v", err)
	}
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
	if err := store.UpdateHardware(ctx, minifix.ID, minifix); err != nil {
		t.Fatalf("update (clear machining): %v", err)
	}
	got, err = store.GetHardwareByID(ctx, minifix.ID)
	if err != nil {
		t.Fatalf("get (cleared machining): %v", err)
	}
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

func registerHardwareMachiningCleanup(t *testing.T, ctx context.Context, store *storage.PostgresStore, h *domain.Hardware) {
	t.Cleanup(func() {
		_, _ = store.Pool.Exec(ctx, "DELETE FROM hardwares WHERE id = $1", h.ID)
	})
}
