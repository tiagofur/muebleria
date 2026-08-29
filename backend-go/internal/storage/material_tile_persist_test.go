package storage_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Integration: requires local Postgres. Verifies texture tile mm columns
// survive UpdateMaterialBoard + GetMaterialBoardByID.
func TestMaterialBoard_PersistsTextureTileMm(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	}
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Skipf("no db: %v", err)
	}
	defer pool.Close()
	store := &storage.PostgresStore{Pool: pool}

	list, err := store.ListMaterialBoards(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) == 0 {
		t.Skip("no materials")
	}
	m := list[0]
	origW, origL := m.PreviewTextureTileWidthMm, m.PreviewTextureTileLengthMm
	m.PreviewTextureTileWidthMm = 333
	m.PreviewTextureTileLengthMm = 444
	if err := store.UpdateMaterialBoard(ctx, m.ID, &m); err != nil {
		t.Fatalf("update: %v", err)
	}
	t.Cleanup(func() {
		m.PreviewTextureTileWidthMm = origW
		m.PreviewTextureTileLengthMm = origL
		_ = store.UpdateMaterialBoard(ctx, m.ID, &m)
	})

	got, err := store.GetMaterialBoardByID(ctx, m.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.PreviewTextureTileWidthMm != 333 || got.PreviewTextureTileLengthMm != 444 {
		t.Fatalf("tiles not persisted: got %.0f x %.0f", got.PreviewTextureTileWidthMm, got.PreviewTextureTileLengthMm)
	}
}
