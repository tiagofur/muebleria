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

// Integration: requires local Postgres. Verifies the F080 part_finishes JSONB
// column round-trips through Create/Update/Get:
//   - nil map stays NULL (legacy rows: every part uses the global finish);
//   - a body/base/grip map round-trips exactly;
//   - updating to nil clears the overrides.
func TestHardware_PersistsPartFinishes(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	}
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Skipf("no db: %v", err)
	}
	t.Cleanup(func() { pool.Close() })
	store := &storage.PostgresStore{Pool: pool}

	// Case 1: create without part finishes → nil (NULL column).
	legacy := newHardwarePartFinishesTestRow()
	legacy.PreviewShape = strPtr("bar-pull")
	if err := store.CreateHardware(ctx, legacy); err != nil {
		t.Fatalf("create (legacy): %v", err)
	}
	registerHardwarePartFinishesCleanup(t, ctx, store, legacy.ID)
	got, err := store.GetHardwareByID(ctx, legacy.ID)
	if err != nil {
		t.Fatalf("get (legacy): %v", err)
	}
	if got.PartFinishes != nil {
		t.Fatalf("legacy row should have no part finishes, got %v", got.PartFinishes)
	}

	// Case 2: per-part overrides round-trip.
	legacy.PartFinishes = map[string]string{"grip": "gold", "base": "black-matte"}
	if err := store.UpdateHardware(ctx, legacy.ID, legacy); err != nil {
		t.Fatalf("update (part finishes): %v", err)
	}
	got, err = store.GetHardwareByID(ctx, legacy.ID)
	if err != nil {
		t.Fatalf("get (part finishes): %v", err)
	}
	if got.PartFinishes["grip"] != "gold" || got.PartFinishes["base"] != "black-matte" {
		t.Fatalf("part finishes did not round-trip: %v", got.PartFinishes)
	}
	if len(got.PartFinishes) != 2 {
		t.Fatalf("expected exactly 2 overrides, got %v", got.PartFinishes)
	}

	// Case 3: clearing back to nil removes the overrides.
	legacy.PartFinishes = nil
	if err := store.UpdateHardware(ctx, legacy.ID, legacy); err != nil {
		t.Fatalf("update (clear): %v", err)
	}
	got, err = store.GetHardwareByID(ctx, legacy.ID)
	if err != nil {
		t.Fatalf("get (clear): %v", err)
	}
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

func registerHardwarePartFinishesCleanup(t *testing.T, ctx context.Context, store *storage.PostgresStore, id string) {
	t.Cleanup(func() {
		_, _ = store.Pool.Exec(ctx, `DELETE FROM hardwares WHERE id = $1`, id)
	})
}
