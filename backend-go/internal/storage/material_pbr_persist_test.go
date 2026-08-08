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

func ptrFloat64(v float64) *float64 { return &v }

// Integration: requires local Postgres. Verifies per-material PBR nullable
// *float64 columns round-trip through Create/Update/Get:
//   - nil pointer stays nil (NULL survives as "undefined", never coerced to 0.0);
//   - an explicit 0.0 (dielectric metalness) is preserved on INSERT and UPDATE;
//   - all three scalars round-trip together.
//
// Mirrors material_tile_persist_test.go: same DATABASE_URL/fallback + skip guard.
func TestMaterialBoard_PersistsPBR(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Skipf("no db: %v", err)
	}
	// Register pool close FIRST so it runs LAST (t.Cleanup is LIFO); the
	// row-deletion cleanups registered below must execute before the pool closes.
	t.Cleanup(func() { pool.Close() })
	store := &storage.PostgresStore{Pool: pool}

	// Case 1: create with NO PBR fields -> all stay nil (NULL = undefined).
	noPBR := newPBRTestBoard()
	if err := store.CreateMaterialBoard(ctx, noPBR); err != nil {
		t.Fatalf("create (no pbr): %v", err)
	}
	registerPBRCleanup(t, ctx, store, noPBR)

	got, err := store.GetMaterialBoardByID(ctx, noPBR.ID)
	if err != nil {
		t.Fatalf("get (no pbr): %v", err)
	}
	if got.PreviewRoughness != nil || got.PreviewMetalness != nil || got.PreviewClearcoat != nil {
		t.Fatalf("nil PBR not preserved as nil: rough=%v met=%v clear=%v", got.PreviewRoughness, got.PreviewMetalness, got.PreviewClearcoat)
	}

	// Case 2: create WITH metalness=0.0 -> survives as 0.0 (critical dielectric
	// case: 0.0 is a valid PBR value and must NOT be erased to NULL).
	zeroMetal := newPBRTestBoard()
	zeroMetal.PreviewMetalness = ptrFloat64(0.0)
	if err := store.CreateMaterialBoard(ctx, zeroMetal); err != nil {
		t.Fatalf("create (metalness 0): %v", err)
	}
	registerPBRCleanup(t, ctx, store, zeroMetal)

	got, err = store.GetMaterialBoardByID(ctx, zeroMetal.ID)
	if err != nil {
		t.Fatalf("get (metalness 0): %v", err)
	}
	if got.PreviewMetalness == nil || *got.PreviewMetalness != 0.0 {
		t.Fatalf("metalness 0.0 not preserved on create: got %v", got.PreviewMetalness)
	}
	if got.PreviewRoughness != nil || got.PreviewClearcoat != nil {
		t.Fatalf("unset PBR leaked: rough=%v clear=%v", got.PreviewRoughness, got.PreviewClearcoat)
	}

	// Case 3: update with all three set -> all three round-trip via UPDATE.
	noPBR.PreviewRoughness = ptrFloat64(0.9)
	noPBR.PreviewMetalness = ptrFloat64(1.0)
	noPBR.PreviewClearcoat = ptrFloat64(0.7)
	if err := store.UpdateMaterialBoard(ctx, noPBR.ID, noPBR); err != nil {
		t.Fatalf("update (all pbr): %v", err)
	}
	got, err = store.GetMaterialBoardByID(ctx, noPBR.ID)
	if err != nil {
		t.Fatalf("get (all pbr): %v", err)
	}
	if got.PreviewRoughness == nil || *got.PreviewRoughness != 0.9 {
		t.Fatalf("roughness not persisted: %v", got.PreviewRoughness)
	}
	if got.PreviewMetalness == nil || *got.PreviewMetalness != 1.0 {
		t.Fatalf("metalness not persisted: %v", got.PreviewMetalness)
	}
	if got.PreviewClearcoat == nil || *got.PreviewClearcoat != 0.7 {
		t.Fatalf("clearcoat not persisted: %v", got.PreviewClearcoat)
	}
}

// newPBRTestBoard builds a minimal, uniquely-coded active MaterialBoard with no
// PBR fields. Empty ID lets Postgres generate one via uuid_generate_v4().
func newPBRTestBoard() *domain.MaterialBoard {
	return &domain.MaterialBoard{
		Code:         fmt.Sprintf("ZZ-PBRTEST-%d", time.Now().UnixNano()),
		Name:         "PBR Round-Trip Test",
		WidthMm:      2440,
		LengthMm:     1220,
		ThicknessMm:  18,
		GrainDefault: false,
		BoardPrice:   100,
		WastePercent: 10,
		Active:       true,
	}
}

// registerPBRCleanup hard-deletes the row this test created (Postgres generated
// its id via uuid_generate_v4). The store exposes no material hard-delete API,
// so we delete via the pool to avoid leaving residue rows in the catalog between
// runs (unlike material_tile_persist_test, which mutates an existing row and
// restores it — this test creates its own and must clean it fully).
func registerPBRCleanup(t *testing.T, ctx context.Context, store *storage.PostgresStore, b *domain.MaterialBoard) {
	t.Cleanup(func() {
		_, _ = store.Pool.Exec(ctx, "DELETE FROM material_boards WHERE id = $1", b.ID)
	})
}
