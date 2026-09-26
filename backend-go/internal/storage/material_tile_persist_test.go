package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Integration: requires isolated test Postgres. Verifies texture tile mm columns
// survive UpdateMaterialBoard + GetMaterialBoardByID.
func TestMaterialBoard_PersistsTextureTileMm(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	board := &domain.MaterialBoard{
		Code:        uniqueID("TILE"),
		Name:        "Texture tile persistence",
		WidthMm:     1830,
		LengthMm:    2440,
		ThicknessMm: 18,
		BoardPrice:  1000,
		Active:      true,
	}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateMaterialBoard(txCtx, board)
	})
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM material_boards WHERE id = $1`, board.ID)
	})

	board.PreviewTextureTileWidthMm = 333
	board.PreviewTextureTileLengthMm = 444
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateMaterialBoard(txCtx, board.ID, board)
	})

	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.MaterialBoard, error) {
		return store.GetMaterialBoardByID(txCtx, board.ID)
	})
	if got.PreviewTextureTileWidthMm != 333 || got.PreviewTextureTileLengthMm != 444 {
		t.Fatalf("tiles not persisted: got %.0f x %.0f", got.PreviewTextureTileWidthMm, got.PreviewTextureTileLengthMm)
	}
}
