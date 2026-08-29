package storage_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Integration: requires local Postgres. F116 C3 + C4.
func mustPool(t *testing.T) (*pgxpool.Pool, *storage.PostgresStore) {
	t.Helper()
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
	// Server-start path applies migrations; tests re-apply embedded SQL so the
	// columns under test exist even on a stale dev database.
	store := &storage.PostgresStore{Pool: pool}
	if err := store.RunMigrations(ctx); err != nil {
		t.Skipf("run migrations: %v", err)
	}
	return pool, store
}

// F116 C3: fractional edge thickness (0.4/0.5/0.8 mm) must round-trip — the
// old INT column + CHECK (> 0) rejected the TS default 0.5 and seed value 0.
func TestEdgeBand_FractionalThicknessRoundTrip(t *testing.T) {
	pool, store := mustPool(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)

	cases := []float64{0.5, 0.8, 0, 2}
	for i, thickness := range cases {
		e := &domain.EdgeBand{
			ID:          fmt.Sprintf("30000000-0000-0000-0000-%012d", i),
			Code:        fmt.Sprintf("TEST-EDGE-F116-%d", i),
			Name:        "Test edge F116",
			ThicknessMm: thickness,
			CostPerMl:   1.5,
			Active:      true,
		}
		if err := store.CreateEdgeBand(ctx, e); err != nil {
			t.Fatalf("create edge %.1fmm: %v", thickness, err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(ctx, `DELETE FROM edge_bands WHERE code = $1`, e.Code)
		})

		got, err := store.GetEdgeBandByID(ctx, e.ID)
		if err != nil {
			t.Fatalf("get edge %.1fmm: %v", thickness, err)
		}
		if got.ThicknessMm != thickness {
			t.Fatalf("thickness round-trip: want %v, got %v", thickness, got.ThicknessMm)
		}
	}
}

// F116 C4: deleteAgregado hard-deletes unreferenced rows and refuses rows
// still referenced from a module's agregados JSONB.
func TestAgregado_HardDeleteWithUseGuard(t *testing.T) {
	pool, store := mustPool(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)

	a := domain.Agregado{
		ID:       "10000000-0000-0000-0000-000000000001",
		Code:     "TEST-AGG-F116",
		Name:     "Test agregado F116",
		WidthMm:  600,
		HeightMm: 400,
		DepthMm:  500,
		Active:   true,
	}
	cleanup := func() {
		_, _ = pool.Exec(ctx, `DELETE FROM modules WHERE code = 'TEST-MOD-F116-AGG'`)
		_, _ = pool.Exec(ctx, `DELETE FROM agregados WHERE code = 'TEST-AGG-F116'`)
	}
	cleanup()
	t.Cleanup(cleanup)

	if err := store.CreateAgregado(ctx, &a); err != nil {
		t.Fatalf("create agregado: %v", err)
	}

	// Reference it from a module's agregados JSONB → delete must refuse.
	// organization_id is explicit: 000088 dropped the transitional DEFAULT so
	// unscoped writes fail loudly.
	modID := "20000000-0000-0000-0000-000000000002"
	_, err := pool.Exec(ctx, `
		INSERT INTO modules (id, code, name, agregados, organization_id)
		VALUES ($1, 'TEST-MOD-F116-AGG', 'Test module F116', $2::jsonb, $3)`,
		modID, fmt.Sprintf(`[{"id":"i1","agregado_id":%q,"quantity":1}]`, a.ID), storage.InitialOrganizationID)
	if err != nil {
		t.Fatalf("seed referencing module: %v", err)
	}

	if err := store.DeleteAgregado(ctx, a.ID); err == nil {
		t.Fatal("delete of in-use agregado must fail")
	} else if got := err.Error(); !strings.Contains(got, "in use") {
		t.Fatalf("want in-use error, got: %s", got)
	}

	// Remove the reference → delete succeeds and the row is gone.
	if _, err := pool.Exec(ctx, `DELETE FROM modules WHERE id = $1`, modID); err != nil {
		t.Fatalf("remove module: %v", err)
	}
	if err := store.DeleteAgregado(ctx, a.ID); err != nil {
		t.Fatalf("delete unreferenced agregado: %v", err)
	}
	if _, err := store.GetAgregadoByID(ctx, a.ID); err == nil {
		t.Fatal("agregado should be hard-deleted")
	}
}
